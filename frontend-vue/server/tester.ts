import type { DmsServerEvent, DmsSession } from '#dms/server'

/** What the route reads of the event the frontend server hands it. */
export interface TesterEvent {
  session: Pick<DmsServerEvent['session'], 'read'>
  readJson: DmsServerEvent['readJson']
  backendUrl: DmsServerEvent['backendUrl']
}

const RESPONSE_LIMIT = 64 * 1024
const REQUEST_TIMEOUT_MS = 30_000
const METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
])
const BLOCKED_HEADERS = new Set([
  'host',
  'cookie',
  'cookie2',
  'set-cookie',
  'set-cookie2',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'expect',
  'forwarded',
  'origin',
  'referer',
  'via',
  'authorization',
])
const CONTROL_HEADER =
  /^(?:sec-|proxy-|x-forwarded-|x-dms-|x-inertia|x-http-method|x-method-override|x-original-|x-rewrite-)/i
const UNSAFE_PATH_CHARACTERS = '\\#'
const UNSAFE_SEGMENT_CHARACTERS = '\\/#'
const SPACE = 0x20
const DELETE = 0x7f

interface ValidInput {
  method: string
  headers: Record<string, string>
  body?: string
  useSession: boolean
}

interface TesterInput extends ValidInput {
  path: string
}

interface ValidatedRequest {
  target: URL
  input: ValidInput
}

/**
 * Whether `text` holds a control character, a space, DEL or one of
 * `forbidden`. A path is checked before forwarding, and a decoded segment
 * after every decoding pass.
 */
function hasUnsafeCharacter(text: string, forbidden: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code <= SPACE || code === DELETE || forbidden.includes(character))
      return true
  }
  return false
}

class InvalidInput extends Error {
  readonly status = 400
}

function invalidInput(): never {
  throw new InvalidInput('Invalid tester request')
}

function validatePathSegment(segment: string) {
  let decoded = segment
  for (;;) {
    if (
      ['.', '..'].includes(decoded) ||
      hasUnsafeCharacter(decoded, UNSAFE_SEGMENT_CHARACTERS)
    )
      invalidInput()
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch {
      invalidInput()
    }
    if (next === decoded) break
    decoded = next
  }
}

function targetUrl(event: TesterEvent, path: string): URL {
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    hasUnsafeCharacter(path, UNSAFE_PATH_CHARACTERS)
  )
    invalidInput()
  path.split('?', 1)[0].split('/').forEach(validatePathSegment)
  const target = event.backendUrl(path)
  if (target.hash) invalidInput()
  return target
}

function filteredHeaders(input: HeadersInit, allowAuthorization = false) {
  const source = new Headers(input)
  const connection = new Set(
    (source.get('connection') ?? '')
      .toLowerCase()
      .split(',')
      .map((name) => name.trim()),
  )
  return new Headers(
    [...source].filter(
      ([name]) =>
        !connection.has(name) &&
        !CONTROL_HEADER.test(name) &&
        (!BLOCKED_HEADERS.has(name) ||
          (allowAuthorization && name === 'authorization')),
    ),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry): entry is string => typeof entry === 'string',
    )
  )
}

function isTesterInput(value: unknown): value is TesterInput {
  if (!isRecord(value)) return false
  const { method, useSession, body, path, headers } = value
  return (
    typeof method === 'string' &&
    METHODS.has(method) &&
    typeof useSession === 'boolean' &&
    typeof path === 'string' &&
    isStringRecord(headers) &&
    (body === undefined ||
      (typeof body === 'string' && !['GET', 'HEAD'].includes(method)))
  )
}

function validateInput(
  event: TesterEvent,
  input: TesterInput,
): ValidatedRequest {
  try {
    new Headers(input.headers)
  } catch {
    invalidInput()
  }
  return { target: targetUrl(event, input.path), input }
}

async function limitedText(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > RESPONSE_LIMIT) {
      await reader.cancel()
      throw new Error('Backend response too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function isOwner(
  event: TesterEvent,
  session: DmsSession,
  signal: AbortSignal,
) {
  const response = await fetch(event.backendUrl('/api/auth/me'), {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'x-antelopejs-namespace': 'default',
    },
    redirect: 'manual',
    signal,
  })
  const text = await limitedText(response)
  if (!response.ok) return false
  return JSON.parse(text)?.owner === true
}

function redact(value: string, session: DmsSession): string {
  const secrets = [session.accessToken, session.refreshToken].filter(
    (secret): secret is string => typeof secret === 'string' && !!secret.length,
  )
  return secrets.reduce((result, secret) => {
    const variants = [
      secret,
      encodeURIComponent(secret),
      JSON.stringify(secret).slice(1, -1),
    ]
    return variants.reduce(
      (text, variant) => text.replaceAll(variant, '[REDACTED]'),
      result,
    )
  }, value)
}

async function forward(
  input: ValidInput,
  target: URL,
  session: DmsSession,
  signal: AbortSignal,
) {
  const headers = filteredHeaders(input.headers, true)
  if (input.useSession && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${session.accessToken}`)
    if (!headers.has('x-antelopejs-namespace'))
      headers.set('x-antelopejs-namespace', 'default')
  }
  const upstream = await fetch(target, {
    method: input.method,
    headers,
    redirect: 'manual',
    signal,
    body: input.body,
  })
  const responseHeaders = Object.fromEntries(
    [...filteredHeaders(upstream.headers)].map(([name, value]) => [
      redact(name, session),
      redact(value, session),
    ]),
  )
  return {
    status: upstream.status,
    headers: responseHeaders,
    body: redact(await limitedText(upstream), session),
  }
}

function failure(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

function inputFailureStatus(error: unknown): number | undefined {
  const status = isRecord(error) ? error.status : undefined
  return status === 400 || status === 413 ? status : undefined
}

/**
 * `POST /api/_dms-api/tester`, the API tester's server half: forwards one call
 * the owner composes to the backend, with the session's credential when asked,
 * and returns the answer without the session's tokens. Owner-only: the session
 * must belong to the instance owner, which the backend confirms on every call.
 */
export async function testerRoute(event: TesterEvent): Promise<Response> {
  try {
    const session = event.session.read()
    if (!session?.accessToken) return failure(401, 'Not authenticated')
    const payload = await event.readJson()
    if (!isTesterInput(payload)) invalidInput()
    const { input, target } = validateInput(event, payload)
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    if (!(await isOwner(event, session, signal)))
      return failure(403, 'Forbidden')
    return Response.json(await forward(input, target, session, signal))
  } catch (error) {
    const status = inputFailureStatus(error)
    return status
      ? failure(status, 'Invalid tester request')
      : failure(502, 'DMS tester request failed')
  }
}
