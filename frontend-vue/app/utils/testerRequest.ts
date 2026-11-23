import { prettyBody } from './format'
import { acceptsRequestBody } from './http'
import {
  PROXY_BODY_LIMIT,
  type TesterErrorCode,
  type TesterRequest,
} from './testerProxy'

export {
  neverSent,
  PROXY_BODY_LIMIT,
  PROXY_RESPONSE_LIMIT,
  PROXY_TIMEOUT_MS,
  proxyFailure,
  sendTesterRequest,
  TESTER_ERROR_CODES,
  TESTER_ROUTE,
  TesterError,
  type TesterErrorCode,
  type TesterRequest,
  type TesterResponse,
} from './testerProxy'
export { countRedacted, hasRedacted, redactedFields } from './testerMasks'

/** One header, query parameter or form field of the tester, in order. */
export interface KeyValue {
  name: string
  value: string
}

export const BODY_MODES = ['json', 'text', 'form', 'none'] as const

/** How the body is written, and the content type it implies. */
export type BodyMode = (typeof BODY_MODES)[number]

export const AUTH_MODES = ['session', 'manual', 'none'] as const

/** Who the call is authenticated as, as the DMS proxy sends it. */
export type AuthMode = (typeof AUTH_MODES)[number]

/**
 * Marks of a call sent by the tester, which the module reads to keep it out
 * of the statistics and to find it in the logs: its own request id, and a
 * token the server signs (`GET /api/monitoring/tester/source`), so no client
 * can declare its calls the Tester's. Not `x-dms-*`: the proxy drops those.
 */
export const SOURCE_HEADER = 'x-antelopejs-api-source'
export const REQUEST_ID_HEADER = 'x-request-id'

/** Where the Tester asks for the token its next calls carry. */
export const TESTER_SOURCE_URL = '/api/monitoring/tester/source'

/** A token as the server signs it: `{ header, value, expiresAt }`. */
export interface TesterSourceToken {
  header: string
  value: string
  expiresAt: string
}

/**
 * A stand-in as long as a real token (`tester.<ms>.<base64url SHA-256>`), to
 * size a request before one is asked for.
 */
export const SIZE_PROBE_SOURCE = `tester.${'0'.repeat(13)}.${'0'.repeat(43)}`

/** A token is asked again this long before it expires. */
const SOURCE_RENEW_MARGIN_MS = 60_000

interface SourceTokens {
  get: () => Promise<TesterSourceToken>
}

/**
 * The tokens of the Tester's calls: one asked for, then reused until a
 * minute before it expires.
 */
export function createSourceTokens(
  ask: () => Promise<TesterSourceToken>,
  now: () => number = Date.now,
): SourceTokens {
  let current: TesterSourceToken | null = null
  return {
    async get() {
      if (
        current &&
        Date.parse(current.expiresAt) - SOURCE_RENEW_MARGIN_MS > now()
      )
        return current
      current = await ask()
      return current
    },
  }
}

const CONTENT_TYPES: Record<BodyMode, string | undefined> = {
  json: 'application/json',
  text: 'text/plain',
  form: 'application/x-www-form-urlencoded',
  none: undefined,
}

/** What the tester shows of one call, and keeps in its draft and history. */
export interface TesterResult {
  status: number
  /** Measured in the browser, through the proxy. */
  durationMs: number
  headers: Record<string, string>
  body: string
  /** Size of the whole answer, when `body` was cut to be stored. */
  bodySize?: number
  bodyTruncated?: boolean
  error?: TesterErrorCode
  message?: string
  auth: AuthMode
  /** Credential headers it was sent with, by name: their values are never kept. */
  secrets?: string[]
  /** The `x-request-id` it was sent with: its captured request. */
  requestId?: string
  /** What the module captured of it, once found: kept with the answer. */
  captured?: CapturedSummary
  /** Cancelled because the tester left its route: the API may have it. */
  abandoned?: boolean
  at: number
}

/** The capture of a call, as far as its answer line goes. */
export interface CapturedSummary {
  id: string
  status: number
  responseTimeMs: number | null
  /** Over the slow threshold of the module. */
  slow: boolean
}

export function capturedSummary(log: CapturedRequest): CapturedSummary {
  return {
    id: log._id,
    status: log.statusCode,
    responseTimeMs: log.responseTimeMs,
    slow:
      log.responseTimeMs !== null &&
      log.slowThresholdMs !== undefined &&
      log.responseTimeMs >= log.slowThresholdMs,
  }
}

/** The query of `rows`, every value kept: repeated names, empty values. */
export function queryString(rows: KeyValue[]): string {
  const params = new URLSearchParams()
  for (const { name, value } of rows) if (name) params.append(name, value)
  return params.toString()
}

export function withQueryRows(path: string, rows: KeyValue[]): string {
  const search = queryString(rows)
  return search ? `${path}?${search}` : path
}

export function contentTypeFor(mode: BodyMode): string | undefined {
  return CONTENT_TYPES[mode]
}

/** The mode a captured or typed content type is edited in. */
export function bodyModeFor(contentType: string | undefined): BodyMode {
  const type = (contentType ?? '').toLowerCase()
  if (type.includes('json')) return 'json'
  if (type.includes('x-www-form-urlencoded')) return 'form'
  return 'text'
}

/** The body as sent: nothing for `none` or an empty text. */
export function serializeBody(
  mode: BodyMode,
  text: string,
  form: KeyValue[],
): string | undefined {
  if (mode === 'none') return undefined
  if (mode === 'form') return queryString(form) || undefined
  return text.trim() ? text : undefined
}

/** Why `text` is not JSON, or null. The tester warns, it never blocks. */
export function jsonProblem(text: string): string | null {
  if (!text.trim()) return null
  try {
    JSON.parse(text)
    return null
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}

/** `text` indented, or null when it is not JSON. */
export function formatJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}

export function headerValue(
  record: Record<string, string>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase()
  return Object.entries(record).find(
    ([key]) => key.toLowerCase() === lower,
  )?.[1]
}

/** Header layers merged in order, a later name replacing an earlier one whatever its case. */
export function mergeHeaders(
  ...layers: Array<Record<string, string> | KeyValue[]>
) {
  const merged = new Map<string, [string, string]>()
  for (const layer of layers) {
    const entries = Array.isArray(layer)
      ? layer.map((entry) => [entry.name, entry.value] as const)
      : Object.entries(layer)
    for (const [name, value] of entries) {
      if (!name) continue
      const lower = name.toLowerCase()
      merged.delete(lower)
      merged.set(lower, [name, value])
    }
  }
  return Object.fromEntries(merged.values())
}

/**
 * The credentials the proxy sends: a typed Authorization header wins over
 * the session, which it then leaves out.
 */
export function authModeOf(
  headers: Record<string, string>,
  useSession: boolean,
): AuthMode {
  if (headerValue(headers, 'authorization') !== undefined) return 'manual'
  return useSession ? 'session' : 'none'
}

/** A version 4 UUID, outside secure contexts too. */
export function newRequestId(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10),
  ]
    .map((part) => part.join(''))
    .join('-')
}

/**
 * `headers` with the marks that tell the module this call is the tester's:
 * its request id, and the signed token (`source`).
 */
export function markedHeaders(
  headers: Record<string, string>,
  requestId: string,
  source: string,
): Record<string, string> {
  return mergeHeaders(headers, {
    [REQUEST_ID_HEADER]: requestId,
    [SOURCE_HEADER]: source,
  })
}

const UNSAFE_SEGMENT_CHARS = new Set(['\\', '/', '#'])
const LAST_CONTROL_OR_SPACE = 0x20
const DELETE_CONTROL = 0x7f

/** Whether a decoded path segment holds a character the proxy refuses. */
function hasUnsafeSegmentChar(decoded: string): boolean {
  return Array.from(decoded).some((char) => {
    const code = char.charCodeAt(0)
    return (
      UNSAFE_SEGMENT_CHARS.has(char) ||
      code <= LAST_CONTROL_OR_SPACE ||
      code === DELETE_CONTROL
    )
  })
}

export type TesterInputProblem =
  | { code: 'path_value'; name: string }
  | { code: 'header'; name: string }
  | { code: 'body_too_large'; size: number }

function decodedFully(value: string): string | null {
  let decoded = value
  for (;;) {
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch {
      return null
    }
    if (next === decoded) return decoded
    decoded = next
  }
}

/** Size of what the proxy reads: the request and its path, as JSON. */
export function envelopeSize(path: string, request: TesterRequest): number {
  return new TextEncoder().encode(JSON.stringify({ ...request, path })).length
}

/**
 * The first thing the proxy would refuse in this request: a path value it
 * reads as a separator (`/`, a space…), a header the platform rejects, or a
 * request over 64 KiB. Null when it would forward it.
 */
export function inputProblem(
  pathValues: Record<string, string>,
  path: string,
  request: TesterRequest,
): TesterInputProblem | null {
  for (const [name, value] of Object.entries(pathValues)) {
    if (!value) continue
    const decoded = decodedFully(value)
    if (decoded === null || ['.', '..'].includes(decoded))
      return { code: 'path_value', name }
    if (hasUnsafeSegmentChar(decoded)) return { code: 'path_value', name }
  }
  for (const [name, value] of Object.entries(request.headers)) {
    try {
      new Headers([[name, value]])
    } catch {
      return { code: 'header', name }
    }
  }
  const size = envelopeSize(path, request)
  if (size > PROXY_BODY_LIMIT) return { code: 'body_too_large', size }
  return null
}

/**
 * `text` with its bidirectional controls shown as `⟨U+202E⟩`: invisible, they
 * would turn the text around on screen without saying so.
 */
export function revealBidi(text: string): string {
  return text.replace(
    /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g,
    (char) =>
      `⟨U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}⟩`,
  )
}

/** A request as the logs' detail route returns it. */
export interface CapturedRequest {
  _id: string
  timestamp: string
  method: string
  uri: string
  route: string
  statusCode: number
  responseTimeMs: number | null
  pathParams?: Record<string, string>
  query?: Record<string, string | string[]>
  requestHeaders?: Record<string, string>
  requestBody?: string
  requestBodyTruncated?: boolean
  requestBodyOmitted?: string | null
  error?: { message: string; stack?: string } | null
  slowThresholdMs?: number
  source?: string
}

/** Captured headers a replay leaves to the browser and the proxy. */
const SKIPPED_REPLAY_HEADERS = new Set([
  'host',
  'content-length',
  'user-agent',
  'accept-encoding',
  'origin',
  'referer',
  REQUEST_ID_HEADER,
  SOURCE_HEADER,
])

/** What a replay puts in the tester, and what it could not. */
export interface ReplayedRequest {
  headers: KeyValue[]
  /** Captured headers left out, by name. */
  skippedHeaders: string[]
  query: KeyValue[]
  pathValues: Record<string, string>
  bodyMode: BodyMode
  body: string
  /** No body was stored; `bodyOmitted` says why when the capture told. */
  bodyMissing: boolean
  bodyOmitted: string | null
  bodyTruncated: boolean
}

/** `value` decoded once, or as it is when it does not decode. */
export function decodedValue(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function replayHeaders(captured: CapturedRequest) {
  const headers: KeyValue[] = []
  const skippedHeaders: string[] = []
  for (const [name, value] of Object.entries(captured.requestHeaders ?? {})) {
    if (SKIPPED_REPLAY_HEADERS.has(name.toLowerCase()))
      skippedHeaders.push(name)
    else headers.push({ name, value })
  }
  return { headers, skippedHeaders }
}

function replayQuery(captured: CapturedRequest): KeyValue[] {
  return Object.entries(captured.query ?? {}).flatMap(([name, value]) =>
    (Array.isArray(value) ? value : [value]).map((item) => ({
      name,
      value: String(item ?? ''),
    })),
  )
}

function replayBodyMode(
  captured: CapturedRequest,
  bodyMissing: boolean,
  truncated: boolean,
): BodyMode {
  if (!acceptsRequestBody(captured.method)) return 'none'
  const contentType = headerValue(captured.requestHeaders ?? {}, 'content-type')
  const mode = bodyMissing && !contentType ? 'json' : bodyModeFor(contentType)
  return truncated || mode === 'form' ? 'text' : mode
}

/**
 * The tester's fields for a captured request: every query value (repeated
 * names, empty values), path values decoded (they are encoded again on
 * sending), and its own body or none. A form or a cut body is replayed as
 * text, as it was received.
 */
export function replayFrom(captured: CapturedRequest): ReplayedRequest {
  const { headers, skippedHeaders } = replayHeaders(captured)
  const pathValues = Object.fromEntries(
    Object.entries(captured.pathParams ?? {}).map(([name, value]) => [
      name,
      decodedValue(String(value)),
    ]),
  )
  const stored = captured.requestBody
  const bodyMissing = stored === undefined || stored === null || stored === ''
  const truncated = !bodyMissing && captured.requestBodyTruncated === true
  const bodyMode = replayBodyMode(captured, bodyMissing, truncated)
  return {
    headers,
    skippedHeaders,
    query: replayQuery(captured),
    pathValues,
    bodyMode,
    body:
      bodyMissing || bodyMode === 'none'
        ? ''
        : bodyMode === 'json'
          ? prettyBody(stored).text
          : (stored ?? ''),
    bodyMissing: bodyMissing && bodyMode !== 'none',
    bodyOmitted: bodyMissing ? (captured.requestBodyOmitted ?? null) : null,
    bodyTruncated: truncated,
  }
}
