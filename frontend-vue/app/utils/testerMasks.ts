import { REDACTED } from './snippets'

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A masked value as the capture writes it, raw or URL-encoded. */
const MASK = `${literal(REDACTED)}|${literal(encodeURIComponent(REDACTED))}`
const REDACTED_PATTERN = new RegExp(MASK, 'gi')
const JSON_FIELD = new RegExp(
  `"([^"\\\\]+)"\\s*:\\s*"${literal(REDACTED)}"`,
  'g',
)
const FORM_FIELD = new RegExp(`(?:^|&)([^&=\\s]+)=(?:${MASK})`, 'gi')

/** How many masked values `text` still holds, raw or URL-encoded. */
export function countRedacted(text: string | undefined): number {
  return text ? (text.match(REDACTED_PATTERN) ?? []).length : 0
}

export function hasRedacted(text: string | undefined): boolean {
  return countRedacted(text) > 0
}

/** Names of the masked fields of a JSON or form body, for the warning. */
export function redactedFields(text: string): string[] {
  const names = new Set<string>()
  for (const match of text.matchAll(JSON_FIELD)) names.add(match[1])
  for (const match of text.matchAll(FORM_FIELD)) {
    try {
      names.add(decodeURIComponent(match[1].replace(/\+/g, ' ')))
    } catch {
      names.add(match[1])
    }
  }
  return [...names]
}
