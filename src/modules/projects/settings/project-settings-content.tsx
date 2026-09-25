"use client";

import { type Project } from "@db/schema";
import { Frame, FrameHeader, FrameTitle, FrameDescription, FramePanel } from "@/components/reui/frame";

import { Input } from "@/components/ui/input";

import { useRepositorySettings } from "./use-repository-settings";
import { RepositorySettingsSection } from "./repository-settings-section";
import { ExecutionSettingsSection } from "./execution-settings-section";
export function ProjectSettingsContent({ project, onProjectUpdate }: { project: Project; onProjectUpdate: (project: Project) => void }) {
  const repository = useRepositorySettings(project, onProjectUpdate);
  return <div className="w-full max-w-4xl mx-auto flex flex-col gap-6">
    <Frame stacked spacing="sm" className="w-full">
      <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <FrameTitle>General</FrameTitle>
          <FrameDescription>
            Project identity and general settings.
          </FrameDescription>
        </div>
      </FrameHeader>

      <FramePanel className="p-0">
        <dl className="flex flex-col">
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:gap-5 items-center">
            <dt className="text-muted-foreground text-sm font-medium">
              Project name
            </dt>
            <dd className="text-foreground text-sm">
              <Input
                value={project.name}
                readOnly
                className="max-w-md bg-muted/40 cursor-default"
              />
            </dd>
          </div>
        </dl>
      </FramePanel>
    </Frame>
    <RepositorySettingsSection project={project} settings={repository} />
    <ExecutionSettingsSection project={project} enabled={Boolean(repository.inspection?.isTaskerInitialized)} />
  </div>;
}
