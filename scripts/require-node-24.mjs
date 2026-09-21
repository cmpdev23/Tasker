import process from "node:process";

const requiredMajor = 24;
const currentMajor = Number(process.versions.node.split(".", 1)[0]);

if (currentMajor !== requiredMajor) {
  console.error(`AgentTasker requires Node.js ${requiredMajor}.x; the current runtime is ${process.version}.`);
  process.exit(1);
}
