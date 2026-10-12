/**
 * How a search of the request logs reads: as the start of a request id,
 * looked up on the `_id` index, or as text matched in paths and error
 * messages. Pure, apart from the model that runs the queries.
 */

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Shape of a request id (a UUID), hex digit by hex digit. */
const UUID_SHAPE = "hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh";
/** Shortest id prefix searched as an id: the 8 digits the table shows. */
const MIN_ID_PREFIX = 8;

/**
 * The search, lower-cased, when it reads as a request id or the start of one
 * (`60035cef`, `60035cef-4a`): looked up on the `_id` index, not by scanning
 * every path and message for it.
 */
export function requestIdPrefix(search: string): string | undefined {
  const value = search.trim().toLowerCase();
  if (value.length < MIN_ID_PREFIX || value.length > UUID_SHAPE.length) {
    return undefined;
  }
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const fits =
      UUID_SHAPE[index] === "-" ? char === "-" : /[0-9a-f]/.test(char);
    if (!fits) return undefined;
  }
  return value;
}

/**
 * Upper bound of the ids starting with `prefix`: ids are lower-case hex and
 * dashes, all of which sort below `~`.
 */
export const ID_PREFIX_END = "~";

/**
 * How a typed character appears in a stored path: the URL parser stores a
 * path percent-encoded (`é` as `%C3%A9`), spaces, quotes, `<>`, backticks and
 * braces too.
 */
export function pathEncoded(search: string): string {
  return search.replace(/[^\x21-\x7e]|["<>`{}]/gu, (char) =>
    encodeURIComponent(char),
  );
}

/**
 * The pattern a text search matches paths and error messages with: the
 * search as typed, or as it is stored in an encoded path, case-insensitive.
 */
export function searchPattern(search: string): string {
  const typed = escapeRegex(search);
  const encoded = escapeRegex(pathEncoded(search));
  return encoded === typed ? `(?i)${typed}` : `(?i)(?:${typed}|${encoded})`;
}
