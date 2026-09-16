const REDACTED = "[REDACTED]";
const MAX_REDACTION_DEPTH = 32;
const SENSITIVE_KEY =
  /password|passwd|secret|token|authorization|cookie|apikey|privatekey|credential|otp|recoverycode|backupcode/;

/** Identifies credential-bearing keys independently of case and separators. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/** Copies structured data without retaining values under credential keys. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_REDACTION_DEPTH) return REDACTED;
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redactValue(item, depth + 1),
    ]),
  );
}

/** Redacts query parameters while retaining repeated non-sensitive values. */
export function redactSearchParams(params: URLSearchParams): URLSearchParams {
  return new URLSearchParams(
    [...params].map(([key, value]) => [
      key,
      isSensitiveKey(key) ? REDACTED : value,
    ]),
  );
}

/** Omits unstructured or malformed bodies that cannot be safely key-redacted. */
export function sanitizeBody(
  body: unknown,
  contentType: string,
): string | undefined {
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : body;
  try {
    if (mediaType === "application/x-www-form-urlencoded") {
      if (typeof text !== "string") return undefined;
      return redactSearchParams(new URLSearchParams(text)).toString();
    }
    if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
      return undefined;
    }
    const parsed: unknown = typeof text === "string" ? JSON.parse(text) : text;
    if (parsed === null || typeof parsed !== "object") return undefined;
    return JSON.stringify(redactValue(parsed));
  } catch {
    return undefined;
  }
}
