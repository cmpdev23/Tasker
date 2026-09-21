import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUIRED_NODE_MAJOR, isRequiredNodeRuntime, nodeMajor } from "../backend/runtime/node-runtime";

test("AgentTasker accepts only the required Node.js major version", () => {
  assert.equal(REQUIRED_NODE_MAJOR, 24);
  assert.equal(nodeMajor("24.19.0"), 24);
  assert.equal(nodeMajor("invalid"), null);
  assert.equal(isRequiredNodeRuntime("24.0.0"), true);
  assert.equal(isRequiredNodeRuntime("20.15.0"), false);
  assert.equal(isRequiredNodeRuntime("25.0.0"), false);
});
