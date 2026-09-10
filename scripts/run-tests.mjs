import fs from "node:fs";
import { spawnSync } from "node:child_process";
const files = fs.readdirSync("tests").filter(name => name.endsWith(".test.ts")).map(name => `tests/${name}`);
files.push("backend/tasks/task.service.test.cjs");
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit", windowsHide: true });
process.exitCode = result.status ?? 1;
