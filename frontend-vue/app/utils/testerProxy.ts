import {
  isJsonValue,
  isNumber,
  isObject,
  isString,
  isStringRecord,
  type JsonValue,
} from './guards'

/** Editable request data; stored session credentials stay on the server. */
export interface TesterRequest {
  method: string
  headers: Record<string, string>
  body?: string
  useSession: boolean
}

/** Raw upstream response, including unsuccessful HTTP statuses. */
export interface TesterResponse {
  status: number
  headers: Record<string, string>
  body: string
}

/**
 * Where the tester's server route answers (`server/tester.ts`, in this
 * module's `dms.server.ts`). Its error bodies hold one generic text per
 * status, so the status, the elapsed time and the checks below are what tell
 * the causes apart.
 */
export const TESTER_ROUTE = '/api/_dms-api/tester'
/** The proxy reads at most this much of the request (the JSON envelope). */
export const PROXY_BODY_LIMIT = 64 * 1024
/**
 * The proxy fails (502) when the API answers more than this, and returns
 * neither the status nor the start of the body: `limitedText()` throws
 * "Backend response too large" past `RESPONSE_LIMIT` (`server/tester.ts`),
 * and `testerRoute()` turns every error into the same 502 "DMS tester request
 * failed", as for an API down. Only the
 * capture of the call tells the two apart. For the DMS: return the status,
 * the headers and the first 64 KiB with a `truncated: true` flag instead of
 * throwing, and give the 502 a `reason` (`too_large`, `timeout`,
 * `unreachable`).
 */
export const PROXY_RESPONSE_LIMIT = 64 * 1024
/** The proxy gives up on the API after this long, with a 502 as well. */
export const PROXY_TIMEOUT_MS = 30_000
/** Our own limit, should the proxy never answer. */
const CLIENT_TIMEOUT_MS = PROXY_TIMEOUT_MS + 5_000
/** A 502 this late is the proxy's timeout. */
const TIMEOUT_MARGIN_MS = 1_000

export const TESTER_ERROR_CODES = [
  'invalid_input',
  'body_too_large',
  'not_authenticated',
  'not_owner',
  'cross_origin',
  'proxy_failed',
  'response_too_large',
  'timeout',
  'aborted',
  'network',
  'unexpected',
] as const

/**
 * Why the tester could not get an answer from the API: the proxy refused the
 * path, a header or the body (`invalid_input`, 400); the request is over the
 * proxy's 64 KiB (`body_too_large`, 413); the console session is gone
 * (`not_authenticated`, 401); the tester is for owners only (`not_owner`,
 * 403); the call did not come from the console's origin (`cross_origin`,
 * 403); the proxy got nothing it could return (`proxy_failed`, 502); seen in
 * the logs after a 502, the API answered more than 64 KiB
 * (`response_too_large`); no answer within 30 s (`timeout`); cancelled
 * before the answer (`aborted`); the console's server could not be reached
 * (`network`); any other answer of the proxy (`unexpected`).
 */
export type TesterErrorCode = (typeof TESTER_ERROR_CODES)[number]

/** Codes after which the API was never called: nothing to find in the logs. */
const NOT_SENT: ReadonlySet<TesterErrorCode> = new Set([
  'invalid_input',
  'body_too_large',
  'not_authenticated',
  'not_owner',
  'cross_origin',
])

export function neverSent(code: TesterErrorCode | undefined): boolean {
  return code !== undefined && NOT_SENT.has(code)
}

export class TesterError extends Error {
  readonly code: TesterErrorCode
  readonly status?: number
  readonly response?: Response
  readonly data?: unknown

  constructor(
    code: TesterErrorCode,
    message: string,
    status?: number,
    failure?: { response: Response; data: unknown },
  ) {
    super(message)
    this.code = code
    this.status = status
    this.response = failure?.response
    this.data = failure?.data
  }
}

function resolvePath(target: string, origin: string): string {
  const url = new URL(target, origin)
  if (
    (!target.startsWith('/') && !/^https?:\/\//.test(target)) ||
    target.startsWith('//') ||
    target.includes('\\') ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new TesterError(
      'invalid_input',
      'API Tester requires a same-origin URL without credentials or fragments',
    )
  }
  return `${url.pathname}${url.search}`
}

function namesReason(payload: JsonValue): payload is { reason: JsonValue } {
  return (
    isObject(payload) &&
    !Array.isArray(payload) &&
    'reason' in payload &&
    !!payload.reason
  )
}

/** The cause of an answer of the proxy that is not the API's. */
export function proxyFailure(
  status: number,
  payload: JsonValue,
  elapsedMs: number,
): TesterErrorCode {
  switch (status) {
    case 400:
      return 'invalid_input'
    case 401:
      return 'not_authenticated'
    case 403:
      return namesReason(payload) ? 'cross_origin' : 'not_owner'
    case 413:
      return 'body_too_large'
    case 502:
      return elapsedMs >= PROXY_TIMEOUT_MS - TIMEOUT_MARGIN_MS
        ? 'timeout'
        : 'proxy_failed'
    default:
      return 'unexpected'
  }
}

async function readPayload(response: Response): Promise<JsonValue> {
  try {
    const payload: unknown = await response.json()
    return isJsonValue(payload) ? payload : null
  } catch {
    return null
  }
}

function isTesterResponse(value: unknown): value is TesterResponse {
  return (
    isObject(value) &&
    'status' in value &&
    isNumber(value.status) &&
    'headers' in value &&
    isStringRecord(value.headers) &&
    'body' in value &&
    isString(value.body)
  )
}

/**
 * Sends a same-origin request through the authenticated owner-only Tester
 * BFF. Fails with a {@link TesterError} naming the cause when the API's
 * answer does not come back: refused by the proxy, cancelled through
 * `signal`, timed out, or unreachable.
 */
export async function sendTesterRequest(
  target: string,
  origin: string,
  request: TesterRequest,
  signal?: AbortSignal,
): Promise<TesterResponse> {
  const path = resolvePath(target, origin)
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, CLIENT_TIMEOUT_MS)
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel)
  const started = Date.now()
  try {
    let response: Response
    try {
      response = await fetch(TESTER_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ...request, path }),
        signal: controller.signal,
      })
    } catch (cause) {
      if (timedOut) throw new TesterError('timeout', 'Timed out')
      if (signal?.aborted) throw new TesterError('aborted', 'Cancelled')
      throw new TesterError(
        'network',
        cause instanceof Error ? cause.message : String(cause),
      )
    }
    if (!response.ok) {
      const payload = await readPayload(response)
      const code = proxyFailure(response.status, payload, Date.now() - started)
      throw new TesterError(
        code,
        `API Tester request failed (${response.status})`,
        response.status,
        { response, data: payload },
      )
    }
    const answer: unknown = await response.json()
    if (!isTesterResponse(answer))
      throw new TesterError('unexpected', 'API Tester answered unreadably')
    return answer
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
