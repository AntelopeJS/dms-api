import { byteLength } from './format'
import {
  isBoolean,
  isList,
  isNumber,
  isObject,
  isOneOf,
  isString,
  isStringList,
  isStringRecord,
} from './guards'
import { startsWithRequestBody } from './http'
import {
  AUTH_MODES,
  type BodyMode,
  BODY_MODES,
  type CapturedSummary,
  decodedValue,
  type KeyValue,
  TESTER_ERROR_CODES,
  type TesterResult,
} from './testerRequest'

/** The editable part of the tester: what is sent. */
export interface DraftRequest {
  bodyMode: BodyMode
  body: string
  form: KeyValue[]
  headers: KeyValue[]
  query: KeyValue[]
  pathValues: Record<string, string>
  useSession: boolean
}

const BODY_ORIGINS = ['example', 'replay', 'history', 'edited'] as const

/** Where the body in the editor comes from, for the line under it. */
export type BodyOrigin = (typeof BODY_ORIGINS)[number]

/** The captured request a draft was replayed from, and what it could not restore. */
export interface ReplayInfo {
  id: string
  at: string
  skippedHeaders: string[]
  bodyMissing: boolean
  bodyOmitted: string | null
  bodyTruncated: boolean
}

/** A route's work in progress, kept across tabs, routes and pages. */
export interface TesterDraft {
  request: DraftRequest
  origin: BodyOrigin
  replay: ReplayInfo | null
  result: TesterResult | null
}

/** What the tester remembers of one call, to restore it from the history. */
export interface HistoryEntry {
  at: number
  method: string
  /** The path as sent, query included. */
  path: string
  request: DraftRequest
  /** Credential headers left out of the entry, by name. */
  secretsRemoved?: string[]
  result: TesterResult
}

/** Calls kept per route. */
export const HISTORY_MAX = 25

/** A stored response is cut here: the history is a reminder, not an archive. */
const STORED_BODY_MAX = 4096

const HISTORY_PREFIX = 'dmsApi.tester.history.'
const DRAFT_PREFIX = 'dmsApi.tester.draft.'
const COMMON_HEADERS_KEY = 'dmsApi.tester.commonHeaders'
const CONFIRMED_WRITES_KEY = 'dmsApi.tester.confirmedWrites'

/** Headers a credential travels in: typed in the tester, never stored. */
const SECRET_HEADERS = new Set(['authorization', 'cookie', 'x-api-key'])

/** The credentials of the drafts and the common headers, until reload. */
const secrets = new Map<string, KeyValue[]>()

type StorageName = 'localStorage' | 'sessionStorage'

type Storable = TesterDraft | HistoryEntry[] | KeyValue[] | string[]

function read<T>(
  storage: StorageName,
  key: string,
  isStored: (stored: unknown) => stored is T,
): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window[storage].getItem(key)
    const stored: unknown = raw ? JSON.parse(raw) : null
    return isStored(stored) ? stored : null
  } catch {
    return null
  }
}

/** Storage full or disabled: the tester's memory is a convenience, never a blocker. */
function write(
  storage: StorageName,
  key: string,
  value: Storable | null,
): void {
  if (typeof window === 'undefined') return
  try {
    if (value === null) window[storage].removeItem(key)
    else window[storage].setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

function isKeyValue(value: unknown): value is KeyValue {
  return (
    isObject(value) &&
    'name' in value &&
    typeof value.name === 'string' &&
    'value' in value &&
    typeof value.value === 'string'
  )
}

function isKeyValues(value: unknown): value is KeyValue[] {
  return Array.isArray(value) && value.every(isKeyValue)
}

function isCapturedSummary(value: unknown): value is CapturedSummary {
  return (
    isObject(value) &&
    'id' in value &&
    typeof value.id === 'string' &&
    'status' in value &&
    typeof value.status === 'number' &&
    'responseTimeMs' in value &&
    (value.responseTimeMs === null ||
      typeof value.responseTimeMs === 'number') &&
    'slow' in value &&
    typeof value.slow === 'boolean'
  )
}

type ResultAnswer = Pick<
  TesterResult,
  'status' | 'durationMs' | 'headers' | 'body' | 'auth' | 'at'
>

function isResultAnswer(value: unknown): value is ResultAnswer {
  return (
    isObject(value) &&
    'status' in value &&
    typeof value.status === 'number' &&
    'durationMs' in value &&
    typeof value.durationMs === 'number' &&
    'headers' in value &&
    isStringRecord(value.headers) &&
    'body' in value &&
    typeof value.body === 'string' &&
    'auth' in value &&
    isOneOf(AUTH_MODES, value.auth) &&
    'at' in value &&
    typeof value.at === 'number'
  )
}

type ResultCounts = Pick<
  TesterResult,
  'bodySize' | 'bodyTruncated' | 'abandoned' | 'requestId'
>

function isResultCounts(value: unknown): value is ResultCounts {
  return (
    isObject(value) &&
    (!('bodySize' in value) ||
      value.bodySize === undefined ||
      isNumber(value.bodySize)) &&
    (!('bodyTruncated' in value) ||
      value.bodyTruncated === undefined ||
      isBoolean(value.bodyTruncated)) &&
    (!('abandoned' in value) ||
      value.abandoned === undefined ||
      isBoolean(value.abandoned)) &&
    (!('requestId' in value) ||
      value.requestId === undefined ||
      isString(value.requestId))
  )
}

type ResultNotes = Pick<
  TesterResult,
  'error' | 'message' | 'secrets' | 'captured'
>

function isResultNotes(value: unknown): value is ResultNotes {
  return (
    isObject(value) &&
    (!('error' in value) ||
      value.error === undefined ||
      isOneOf(TESTER_ERROR_CODES, value.error)) &&
    (!('message' in value) ||
      value.message === undefined ||
      isString(value.message)) &&
    (!('secrets' in value) ||
      value.secrets === undefined ||
      isStringList(value.secrets)) &&
    (!('captured' in value) ||
      value.captured === undefined ||
      isCapturedSummary(value.captured))
  )
}

function isTesterResult(value: unknown): value is TesterResult {
  return isResultAnswer(value) && isResultCounts(value) && isResultNotes(value)
}

function isDraftRequest(value: unknown): value is DraftRequest {
  return (
    isObject(value) &&
    'bodyMode' in value &&
    isOneOf(BODY_MODES, value.bodyMode) &&
    'body' in value &&
    typeof value.body === 'string' &&
    'form' in value &&
    isKeyValues(value.form) &&
    'headers' in value &&
    isKeyValues(value.headers) &&
    'query' in value &&
    isKeyValues(value.query) &&
    'pathValues' in value &&
    isStringRecord(value.pathValues) &&
    'useSession' in value &&
    typeof value.useSession === 'boolean'
  )
}

function isReplayInfo(value: unknown): value is ReplayInfo {
  return (
    isObject(value) &&
    'id' in value &&
    typeof value.id === 'string' &&
    'at' in value &&
    typeof value.at === 'string' &&
    'skippedHeaders' in value &&
    isStringList(value.skippedHeaders) &&
    'bodyMissing' in value &&
    typeof value.bodyMissing === 'boolean' &&
    'bodyOmitted' in value &&
    (value.bodyOmitted === null || typeof value.bodyOmitted === 'string') &&
    'bodyTruncated' in value &&
    typeof value.bodyTruncated === 'boolean'
  )
}

function isTesterDraft(value: unknown): value is TesterDraft {
  return (
    isObject(value) &&
    'request' in value &&
    isDraftRequest(value.request) &&
    'origin' in value &&
    isOneOf(BODY_ORIGINS, value.origin) &&
    'replay' in value &&
    (value.replay === null || isReplayInfo(value.replay)) &&
    'result' in value &&
    (value.result === null || isTesterResult(value.result))
  )
}

function isEntry(value: unknown): value is HistoryEntry {
  return (
    isObject(value) &&
    'at' in value &&
    typeof value.at === 'number' &&
    'method' in value &&
    typeof value.method === 'string' &&
    'path' in value &&
    typeof value.path === 'string' &&
    'request' in value &&
    isDraftRequest(value.request) &&
    (!('secretsRemoved' in value) ||
      value.secretsRemoved === undefined ||
      isStringList(value.secretsRemoved)) &&
    'result' in value &&
    isTesterResult(value.result)
  )
}

export function isSecretHeader(name: string): boolean {
  return SECRET_HEADERS.has(name.toLowerCase())
}

interface SplitHeaders {
  kept: KeyValue[]
  removed: KeyValue[]
}

/** `headers` split into what may be stored and the credentials. */
export function splitSecrets(headers: KeyValue[]): SplitHeaders {
  return {
    kept: headers.filter((entry) => !isSecretHeader(entry.name)),
    removed: headers.filter((entry) => isSecretHeader(entry.name)),
  }
}

/** Names of the credential headers a request sends. */
export function secretNames(headers: Record<string, string>): string[] {
  return Object.keys(headers).filter(isSecretHeader)
}

/**
 * Of the credentials a call was sent with, those `headers` no longer hold:
 * dropped from storage, or from memory by a reload. One per name.
 */
export function lostSecrets(sent: string[], headers: KeyValue[]): string[] {
  const held = new Set(
    headers
      .filter((entry) => entry.value)
      .map((entry) => entry.name.toLowerCase()),
  )
  const lost = new Map<string, string>()
  for (const name of sent) {
    const key = name.toLowerCase()
    if (!held.has(key) && !lost.has(key)) lost.set(key, name)
  }
  return [...lost.values()]
}

/** The calls made to `route` from this browser, newest first. */
export function loadHistory(route: string): HistoryEntry[] {
  const stored = read('localStorage', `${HISTORY_PREFIX}${route}`, isList)
  return stored ? stored.filter(isEntry) : []
}

/** `entries` with the result of the call sent as `requestId` patched. */
export function patchResult(
  entries: HistoryEntry[],
  requestId: string,
  patch: Partial<TesterResult>,
): HistoryEntry[] {
  return entries.map((entry) =>
    entry.result.requestId === requestId
      ? { ...entry, result: { ...entry.result, ...patch } }
      : entry,
  )
}

/**
 * Store the calls made to `route`. A response body is cut short, with its
 * real size kept, and credentials are never part of an entry: `useSession`
 * only says the session was on.
 */
export function saveHistory(route: string, entries: HistoryEntry[]): void {
  const trimmed = entries.slice(0, HISTORY_MAX).map((entry) => {
    const { body } = entry.result
    const cut = body.length > STORED_BODY_MAX
    return {
      ...entry,
      request: {
        ...entry.request,
        headers: splitSecrets(entry.request.headers).kept,
      },
      result: {
        ...entry.result,
        body: cut ? body.slice(0, STORED_BODY_MAX) : body,
        bodySize: entry.result.bodySize ?? byteLength(body),
        bodyTruncated: entry.result.bodyTruncated || cut,
      },
    }
  })
  write(
    'localStorage',
    `${HISTORY_PREFIX}${route}`,
    trimmed.length ? trimmed : null,
  )
}

/** A history entry for a call, without the credentials it was sent with. */
export function historyEntry(
  method: string,
  path: string,
  request: DraftRequest,
  result: TesterResult,
): HistoryEntry {
  const { kept, removed } = splitSecrets(request.headers)
  const entry: HistoryEntry = {
    at: result.at,
    method,
    path,
    request: { ...request, headers: kept },
    result,
  }
  if (removed.length) entry.secretsRemoved = removed.map((item) => item.name)
  return entry
}

/** The path values of the last call that succeeded with all of them set. */
export function lastSuccessfulPathValues(
  entries: HistoryEntry[],
  names: string[],
): Record<string, string> {
  if (names.length === 0) return {}
  const entry = entries.find(
    (item) =>
      item.result.status >= 200 &&
      item.result.status < 300 &&
      names.every((name) => item.request.pathValues[name]),
  )
  return entry
    ? Object.fromEntries(
        names.map((name) => [name, entry.request.pathValues[name]]),
      )
    : {}
}

/** A route's draft, its credentials put back. */
export function loadDraft(route: string): TesterDraft | null {
  const draft = read('sessionStorage', `${DRAFT_PREFIX}${route}`, isTesterDraft)
  if (!draft) return null
  const kept = secrets.get(`${DRAFT_PREFIX}${route}`) ?? []
  return {
    ...draft,
    request: { ...draft.request, headers: [...draft.request.headers, ...kept] },
  }
}

export function saveDraft(route: string, draft: TesterDraft | null): void {
  const key = `${DRAFT_PREFIX}${route}`
  if (!draft) {
    secrets.delete(key)
    write('sessionStorage', key, null)
    return
  }
  const { kept, removed } = splitSecrets(draft.request.headers)
  secrets.set(key, removed)
  write('sessionStorage', key, {
    ...draft,
    request: { ...draft.request, headers: kept },
  })
}

/** Whether two requests send the same thing, empty rows aside. */
export function sameRequest(a: DraftRequest, b: DraftRequest): boolean {
  const rows = (list: KeyValue[]) =>
    list
      .filter((entry) => entry.name || entry.value)
      .map((entry) => [entry.name, entry.value])
  const fingerprint = (request: DraftRequest) =>
    JSON.stringify([
      request.bodyMode,
      request.bodyMode === 'none' ? '' : request.body,
      rows(request.form),
      rows(request.headers),
      rows(request.query),
      Object.entries(request.pathValues).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
      request.useSession,
    ])
  return fingerprint(a) === fingerprint(b)
}

/**
 * A route's starting point: the last body it accepted (none for GET, HEAD
 * and DELETE), the path values of the last call that succeeded from here,
 * else of the last one the route answered with success, and the session
 * only when the route requires it, surely or probably: a public handler (a
 * webhook) does not get the owner's token.
 */
export function exampleRequest(
  route: {
    method: string
    pathParams: string[]
    exampleBody: unknown
    examplePath?: Record<string, string>
    authStatus: 'required' | 'probable' | 'unknown'
  },
  history: HistoryEntry[],
): DraftRequest {
  const withBody = startsWithRequestBody(route.method)
  const own = lastSuccessfulPathValues(history, route.pathParams)
  const last = Object.keys(own).length
    ? own
    : Object.fromEntries(
        Object.entries(route.examplePath ?? {}).map(([name, value]) => [
          name,
          decodedValue(String(value)),
        ]),
      )
  return {
    bodyMode: withBody ? 'json' : 'none',
    body:
      withBody && route.exampleBody !== undefined && route.exampleBody !== null
        ? JSON.stringify(route.exampleBody, null, 2)
        : '',
    form: [],
    headers: [],
    query: [],
    pathValues: Object.fromEntries(
      route.pathParams.map((name) => [name, last[name] ?? '']),
    ),
    useSession: route.authStatus !== 'unknown',
  }
}

export function loadCommonHeaders(): KeyValue[] {
  return [
    ...(read('localStorage', COMMON_HEADERS_KEY, isKeyValues) ?? []),
    ...(secrets.get(COMMON_HEADERS_KEY) ?? []),
  ]
}

export function saveCommonHeaders(headers: KeyValue[]): void {
  const { kept, removed } = splitSecrets(
    headers.filter((entry) => entry.name || entry.value),
  )
  secrets.set(COMMON_HEADERS_KEY, removed)
  write('localStorage', COMMON_HEADERS_KEY, kept.length ? kept : null)
}

export function hasConfirmedWrite(route: string): boolean {
  return (
    read('sessionStorage', CONFIRMED_WRITES_KEY, isStringList)?.includes(
      route,
    ) ?? false
  )
}

export function rememberConfirmedWrite(route: string): void {
  const list = read('sessionStorage', CONFIRMED_WRITES_KEY, isStringList) ?? []
  if (!list.includes(route))
    write('sessionStorage', CONFIRMED_WRITES_KEY, [...list, route])
}
