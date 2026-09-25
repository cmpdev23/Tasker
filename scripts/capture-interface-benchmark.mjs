import fs from "node:fs/promises";
import path from "node:path";

const port = process.argv[2];
const label = process.argv[3];
if (!["5056", "5058"].includes(port) || !/^[a-z0-9-]+$/.test(label ?? "")) {
  throw new Error("Usage: node scripts/capture-interface-benchmark.mjs <5056|5058> <label>");
}
const base = `http://127.0.0.1:${port}`;
const start = await (await fetch(`${base}/__benchmark/start`, { method: "POST" })).json();
await new Promise(resolve => setTimeout(resolve, Math.max(0, start.captureUntil - Date.now()) + 100));
const result = await (await fetch(`${base}/__benchmark/results`)).json();
if (result.captureUntil !== start.captureUntil) throw new Error("Capture replaced by another measurement.");
const file = path.join(".test-artifacts", `${label}.json`);
await fs.writeFile(file, JSON.stringify(result, null, 2));
console.log(`Saved complete 60-second capture: ${file} (${result.measurements.length} requests)`);
