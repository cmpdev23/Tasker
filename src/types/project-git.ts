export interface ProjectGitSettings {
  remote: string;
  push: boolean;
  createPullRequest: boolean;
  pullRequestDraft: boolean;
}

export interface GitHubCliRuntimeStatus {
  available: boolean;
  authenticated: boolean;
  executable: string | null;
  detail: string | null;
}

export const DEFAULT_PROJECT_GIT_SETTINGS: ProjectGitSettings = {
  remote: "origin",
  push: false,
  createPullRequest: false,
  pullRequestDraft: true,
};
