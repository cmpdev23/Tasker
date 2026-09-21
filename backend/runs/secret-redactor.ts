const REDACTED = "[REDACTED]";

function encodings(value: string): string[] {
  let urlEncoded = value;
  try { urlEncoded = encodeURIComponent(value); } catch { /* Keep the direct value for malformed Unicode. */ }
  return [value, JSON.stringify(value).slice(1, -1), urlEncoded];
}

/** Redact configured values before any Run output crosses a persistence boundary. */
export function createSecretRedactor(values: Iterable<string>): (value: string) => string {
  const secrets = [...new Set([...values].flatMap(encodings))]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  return (value) => secrets.reduce((result, secret) => result.replaceAll(secret, REDACTED), value);
}
