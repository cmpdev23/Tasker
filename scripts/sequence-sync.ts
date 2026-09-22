import { sequenceCheckpointMigrationService } from "../backend/sequences/sequence-checkpoint-migration.service";

function parse(argv: string[]) {
  const options: { repository: string; sequenceId?: string; dryRun: boolean } = { repository: "", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--repository") {
      const next = argv[++index];
      if (!next || next.startsWith("-")) throw new Error("--repository requires a value.");
      options.repository = next;
    } else if (value === "--id") {
      const next = argv[++index];
      if (!next || next.startsWith("-")) throw new Error("--id requires a Sequence identifier.");
      options.sequenceId = next;
    } else if (value === "--all") {
      if (options.sequenceId) throw new Error("Use either --id or --all, not both.");
    } else if (value === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown option: ${value}`);
  }
  if (!options.repository) throw new Error("--repository is required.");
  if (!options.sequenceId && !argv.includes("--all")) throw new Error("Use --id <sequence-id> or --all.");
  return options;
}

async function main() {
  const options = parse(process.argv.slice(2));
  const results = await sequenceCheckpointMigrationService.sync(options.repository, options);
  for (const result of results) console.log(`${result.status.padEnd(7)} ${result.sequenceId} — ${result.message}`);
  const synced = results.filter((result) => result.status === "SYNCED").length;
  const ready = results.filter((result) => result.status === "READY").length;
  const skipped = results.filter((result) => result.status === "SKIPPED").length;
  console.log(`\n${options.dryRun ? "Preview" : "Migration"}: ${synced} synced, ${ready} ready, ${skipped} skipped.`);
}

void main().catch((error) => {
  console.error(`AgentTasker Sequence sync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
