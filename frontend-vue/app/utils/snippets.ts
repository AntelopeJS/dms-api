/** A request the docs and the tester turn into a snippet. */
export interface SnippetRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** The request as a `curl` command, one option per line. */
export function toCurl(request: SnippetRequest): string {
  const lines = [
    `curl -X ${request.method.toUpperCase()} ${shellQuote(request.url)}`,
  ]
  for (const [name, value] of Object.entries(request.headers)) {
    lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`)
  }
  if (request.body) lines.push(`  -d ${shellQuote(request.body)}`)
  return lines.join(' \\\n')
}

/** The request as a `fetch` call. */
export function toFetch(request: SnippetRequest): string {
  const init: string[] = [
    `  method: ${JSON.stringify(request.method.toUpperCase())},`,
  ]
  if (Object.keys(request.headers).length > 0) {
    init.push(
      `  headers: ${JSON.stringify(request.headers, null, 2).replace(/\n/g, '\n  ')},`,
    )
  }
  if (request.body) init.push(`  body: JSON.stringify(${request.body}),`)
  return `await fetch(${JSON.stringify(request.url)}, {\n${init.join('\n')}\n})`
}

/** Put the values of `params` in the `:name` segments of `path`. */
export function fillPath(path: string, params: Record<string, string>): string {
  return path.replace(/:([A-Za-z_][\w]*)/g, (segment, name: string) => {
    const value = params[name]
    return value ? encodeURIComponent(value) : segment
  })
}

/** `path` with the query parameters that hold a value. */
export function withQuery(path: string, query: Record<string, string>): string {
  const search = new URLSearchParams(
    Object.entries(query).filter(([key, value]) => key && value !== ''),
  ).toString()
  return search ? `${path}?${search}` : path
}
