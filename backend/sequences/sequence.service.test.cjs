/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

const { SequenceService } = require("./sequence.service.ts");
const {
  parseSequenceConfig,
  parseSequenceStepConfig,
  serializeSequenceConfig,
  serializeSequenceStepConfig,
  validateSequenceInput,
  validateSequenceStepInput,
} = require("./sequence-config.ts");
const { ValidationError, NotFoundError, ConflictError } = require("../errors.ts");

const stepInput = (index = 1, changes = {}) => ({
  name: `Étape ${index}`,
  instructions: `# Étape ${index}\n\nEffectuer le travail ${index}.\n`,
  expectChanges: index % 2 === 0,
  ...changes,
});

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "agenttasker-sequences-test-"));
  const repository = path.join(root, "repo");
  fs.mkdirSync(path.join(repository, ".tasker"), { recursive: true });
  const service = new SequenceService(async (id) => {
    if (id !== "project") throw new NotFoundError("Unknown project.");
    return { repositoryPath: repository };
  });
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("agenttasker-sequences-test-"));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return { service, repository, sequences: path.join(repository, ".tasker", "sequences") };
}

test("Sequence CRUD owns ordered steps without creating Tasks", async (t) => {
  const { service, repository, sequences } = fixture(t);
  assert.deepEqual(await service.list("project"), []);
  assert.equal(fs.existsSync(sequences), false, "reads must not initialize Sequence storage");
  const first = await service.create("project", { name: "Production SEO" });
  const second = await service.create("project", { name: "Production SEO" });
  assert.equal(first.id, "production-seo");
  assert.equal(first.pullRequestStrategy, "after_sequence");
  assert.equal(second.id, "production-seo-2");
  assert.equal(fs.existsSync(path.join(repository, ".tasker", "tasks")), false,
    "Sequence creation must not create or reference Task storage");

  let sequence = first;
  for (let index = 1; index <= 50; index++) {
    sequence = await service.createStep("project", sequence.id, stepInput(index));
  }
  assert.equal(sequence.steps.length, 50);
  assert.equal(sequence.steps[0].id, "etape-1");
  assert.equal(sequence.steps[49].id, "etape-50");
  assert.deepEqual(await service.get("project", sequence.id), sequence);

  const reversed = sequence.steps.map((step) => step.id).reverse();
  sequence = await service.reorderSteps("project", sequence.id, reversed);
  assert.deepEqual(sequence.steps.map((step) => step.id), reversed);
  sequence = await service.updateStep("project", sequence.id, "etape-1", stepInput(1, { name: "Validation finale" }));
  assert.equal(sequence.steps.at(-1).name, "Validation finale");
  sequence = await service.deleteStep("project", sequence.id, "etape-25");
  assert.equal(sequence.steps.length, 49);
  sequence = await service.update("project", sequence.id, {
    name: "SEO complet",
    pullRequestStrategy: "after_each_step",
  });
  assert.equal(sequence.id, "production-seo");
  assert.equal(sequence.name, "SEO complet");
  assert.equal(sequence.pullRequestStrategy, "after_each_step");

  await service.delete("project", sequence.id);
  await assert.rejects(service.get("project", sequence.id), NotFoundError);
  assert.equal((await service.get("project", second.id)).steps.length, 0);
});

test("Sequence TOML round-trips and rejects malformed or injected fields", () => {
  const config = {
    id: "seo", name: 'SEO "workflow"', pullRequestStrategy: "after_each_step",
    failurePolicy: "stop", maxConsecutiveFailures: 2, stepIds: ["research", "write"],
  };
  const serialized = serializeSequenceConfig(config);
  assert.deepEqual(parseSequenceConfig(serialized, config.id), config);
  const legacy = parseSequenceConfig(serialized.replace(/pull_request_strategy = "after_each_step"\n(?:failure_policy = "stop"\nmax_consecutive_failures = 2\n)?/, ""), config.id);
  assert.equal(legacy.pullRequestStrategy, "after_sequence", "older Sequence files must retain the safe final-publication behavior");
  assert.equal(legacy.failurePolicy, "stop");
  assert.equal(legacy.maxConsecutiveFailures, 2);
  const step = { id: "research", ...stepInput(1) };
  assert.deepEqual(parseSequenceStepConfig(serializeSequenceStepConfig(step), step.id, step.instructions), step);
  for (const invalid of [null, {}, { name: "" }, { name: "SEO", taskId: "forbidden" },
    { name: "SEO", pullRequestStrategy: "always" }]) {
    assert.throws(() => validateSequenceInput(invalid), ValidationError);
  }
  for (const invalid of [null, {}, stepInput(1, { expectChanges: "true" }), stepInput(1, { instructions: "" }),
    { ...stepInput(1), taskId: "forbidden" }]) {
    assert.throws(() => validateSequenceStepInput(invalid), ValidationError);
  }
  assert.throws(() => parseSequenceConfig(serialized.replace('id = "seo"', 'id = "task-reference"'), "seo"), ValidationError);
  assert.throws(() => parseSequenceConfig(`${serialized}unknown = true\n`, "seo"), ValidationError);
  assert.throws(() => parseSequenceConfig(serialized.replace('steps = ["research", "write"]', 'steps = ["research", "research"]'), "seo"), ValidationError);
});

test("Sequence TOML accepts a multiline steps array", () => {
  const config = parseSequenceConfig([
    "version = 1",
    'id = "seo"',
    'name = "SEO workflow"',
    'steps = [',
    '  "research", # Gather sources first',
    '  "write",',
    ']',
    "",
  ].join("\n"), "seo");
  assert.deepEqual(config.stepIds, ["research", "write"]);
});

test("Sequence mutations reject traversal and preserve unexpected files", async (t) => {
  const { service, sequences } = fixture(t);
  const sequence = await service.create("project", { name: "Audit" });
  const withStep = await service.createStep("project", sequence.id, stepInput());
  for (const id of ["../outside", "..\\outside", "/absolute", "C:\\outside", "con", "A", "a".repeat(101)]) {
    await assert.rejects(service.get("project", id), ValidationError);
  }
  await assert.rejects(service.reorderSteps("project", sequence.id, []), ValidationError);
  const stepDirectory = path.join(sequences, sequence.id, "steps", withStep.steps[0].id);
  fs.writeFileSync(path.join(stepDirectory, "notes.md"), "preserve");
  await assert.rejects(service.deleteStep("project", sequence.id, withStep.steps[0].id), ConflictError);
  await assert.rejects(service.delete("project", sequence.id), ConflictError);
  assert.equal(fs.readFileSync(path.join(stepDirectory, "notes.md"), "utf8"), "preserve");
});
