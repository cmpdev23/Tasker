import fs from "node:fs";
const fixture = JSON.parse(fs.readFileSync(".test-artifacts/smoke.json", "utf8"));
process.env.DATABASE_PATH = fixture.database;
process.env.AGENTTASKER_DATA_DIR = fixture.runtime;
const production = process.argv.includes("--production");
process.env.AGENTTASKER_BUILD_DIR = production ? ".test-artifacts/next-production" : ".test-artifacts/next-smoke";
process.argv = [process.execPath, "next", production ? "start" : "dev", "--hostname", "127.0.0.1", "--port", "5055"];
await import("next/dist/bin/next");
