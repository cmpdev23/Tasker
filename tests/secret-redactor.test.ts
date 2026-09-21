import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecretRedactor } from "../backend/runs/secret-redactor";

test("Run output redaction removes direct, JSON-escaped, and URL-encoded secret values", () => {
  const secret = 'api key/with"quotes';
  const redact = createSecretRedactor([secret]);
  assert.equal(redact(`direct=${secret}`), "direct=[REDACTED]");
  assert.equal(redact(`json=${JSON.stringify(secret).slice(1, -1)}`), "json=[REDACTED]");
  assert.equal(redact(`url=${encodeURIComponent(secret)}`), "url=[REDACTED]");
});
