import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLocalRequest } from "../backend/http/api";

test("Next normalized localhost URL accepts the browser's actual loopback Host and Origin", () => {
  assert.doesNotThrow(() => assertLocalRequest(new Request("http://localhost:5055/api/tasks", {
    headers: { host: "127.0.0.1:5055", origin: "http://127.0.0.1:5055", "sec-fetch-site": "same-origin" },
  })));
});
test("run mutations reject foreign origins, cross-site browser requests and non-loopback hosts", () => {
  const requests: Record<string, string>[] = [
    { host: "localhost:5000", origin: "https://attacker.example" },
    { host: "localhost:5000", "sec-fetch-site": "cross-site" },
    { host: "attacker.example", origin: "http://attacker.example" },
  ];
  for (const headers of requests) assert.throws(() => assertLocalRequest(new Request("http://localhost:5000/api/tasks", { headers })));
});
