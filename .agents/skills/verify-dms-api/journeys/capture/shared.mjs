

export const DEFAULT_HEADERS = ["content-type", "content-length", "user-agent", "accept", "accept-encoding", "host", "referer", "origin"];
export const REDACTED_WORDS = ["password", "passwd", "secret", "authorization", "cookie", "apikey", "privatekey", "credential", "recoverycode", "backupcode", "cardnumber", "securitycode", "pincode", "token", "otp", "cvc", "cvv", "cvn", "iban", "pin", "pan", "ssn", "card"];
export const JSON_HEADERS = { "content-type": "application/json", "user-agent": "verify-agent/1.0", "x-request-id": "req-capture-1", "x-webhook-signature": "sig-1", authorization: "Bearer top-secret", cookie: "sid=1", "proxy-authorization": "Basic cHJveHk6cHc=", "set-cookie": "sid=2", "x-api-key": "k-1", origin: "https://client.example.org", referer: "https://client.example.org/page" };
