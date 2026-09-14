import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseProjectGitSettings,
  updateProjectGitToml,
} from "../backend/tasker/project-git";
import { DEFAULT_PROJECT_GIT_SETTINGS } from "../src/types/project-git";

test("Project Git settings are safe by default and preserve unrelated TOML", () => {
  assert.deepEqual(parseProjectGitSettings('[git]\nbase_branch = "main"\n'), DEFAULT_PROJECT_GIT_SETTINGS);
  const updated = updateProjectGitToml(`version = 1

[git]
# Keep the base selection.
base_branch = "main"

[execution]
package_manager = "npm"
`, {
    remote: "upstream",
    push: true,
    createPullRequest: true,
    pullRequestDraft: true,
  });
  assert.match(updated, /base_branch = "main"/);
  assert.match(updated, /remote = "upstream"/);
  assert.match(updated, /push = true/);
  assert.match(updated, /create_pull_request = true/);
  assert.match(updated, /pull_request_draft = true/);
  assert.match(updated, /\[execution\]\npackage_manager = "npm"/);
  assert.deepEqual(parseProjectGitSettings(updated), {
    remote: "upstream",
    push: true,
    createPullRequest: true,
    pullRequestDraft: true,
  });
});

test("Project Git settings reject ambiguous or unsafe publication configuration", () => {
  assert.throws(() => updateProjectGitToml("", {
    remote: "origin",
    push: false,
    createPullRequest: true,
    pullRequestDraft: true,
  }), /requires branch push/i);
  assert.throws(() => updateProjectGitToml("", {
    remote: "-malicious",
    push: true,
    createPullRequest: false,
    pullRequestDraft: true,
  }), /remote name/i);
  assert.throws(() => parseProjectGitSettings('[git]\npush = true\npush = false\n'), /Duplicate Git setting/i);
});
