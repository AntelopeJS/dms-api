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
    throw new Error(
      'API Tester requires a same-origin URL without credentials or fragments',
    )
  }
  return `${url.pathname}${url.search}`
}

/** Sends a same-origin request through the authenticated owner-only Tester BFF. */
export async function sendTesterRequest(
  target: string,
  origin: string,
  request: TesterRequest,
): Promise<TesterResponse> {
  const path = resolvePath(target, origin)
  const response = await fetch('/api/_dms/tester', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ ...request, path }),
  })
  if (!response.ok)
    throw new Error(`API Tester request failed (${response.status})`)
  return response.json()
}
