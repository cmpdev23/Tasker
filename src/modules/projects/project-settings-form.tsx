"use client";

import { useState } from "react";
import type { Project } from "@db/schema";
import { ProjectSettingsContent } from "./settings/project-settings-content";

export function ProjectSettingsForm({ project, onProjectUpdate }: { project: Project; onProjectUpdate?: (updated: Project) => void }) {
  return <SettingsForm key={`${project.id}:${project.repositoryPath}`} initialProject={project} onProjectUpdate={onProjectUpdate} />;
}

function SettingsForm({ initialProject, onProjectUpdate }: { initialProject: Project; onProjectUpdate?: (updated: Project) => void }) {
  const [project, setProject] = useState(initialProject);
  return <ProjectSettingsContent key={project.repositoryPath} project={project} onProjectUpdate={(updated) => {
    setProject(updated);
    onProjectUpdate?.(updated);
  }} />;
}
