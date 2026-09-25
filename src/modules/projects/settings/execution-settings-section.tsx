"use client";

import { type Project } from "@db/schema";
import { Frame, FrameHeader, FrameTitle, FrameDescription, FramePanel } from "@/components/reui/frame";

import { Button } from "@/components/ui/button";

import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Loader2Icon, TerminalSquareIcon } from "lucide-react";

import { useExecutionSettings } from "./use-execution-settings";
import { usePublicationSettings } from "./use-publication-settings";
import { RuntimeSettingsSection } from "./runtime-settings-section";
import { EnvironmentSettingsSection } from "./environment-settings-section";
import { ScriptsSettingsSection } from "./scripts-settings-section";
import { TimeoutSettingsSection } from "./timeout-settings-section";
import { PublicationSettingsSection } from "./publication-settings-section";
import { DeleteProjectSection } from "./delete-project-section";
export function ExecutionSettingsSection({ project, enabled }: { project: Project; enabled: boolean }) {
  const execution = useExecutionSettings(project, enabled);
  const publication = usePublicationSettings(project, enabled);
  const { handleSaveExecution, isLoadingExecution, isSavingExecution } = execution;
  return (
    <Frame stacked spacing="sm" className="w-full">
      <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <FrameTitle>Execution settings</FrameTitle>
          <FrameDescription>
            Runtime, secrets, validation scripts, and advanced Run behavior.
          </FrameDescription>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleSaveExecution}
          disabled={
            !enabled ||
            isLoadingExecution ||
            isSavingExecution
          }
          className="shrink-0 gap-1.5"
        >
          {isSavingExecution ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <TerminalSquareIcon className="size-4" />
          )}
          Save execution
        </Button>
      </FrameHeader>

      <FramePanel className="p-0">
        {!enabled ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Initialize Tasker before configuring Project execution.
          </div>
        ) : isLoadingExecution ? (
          <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Loading execution
            settings...
          </div>
        ) : (
          <Tabs defaultValue="runtime" className="gap-0">
            <div className="border-b border-border/60 bg-muted/25 px-3 pt-2">
              <TabsList
                variant="line"
                className="h-auto max-w-full flex-wrap justify-start gap-1"
                aria-label="Execution settings sections"
              >
                <TabsTrigger
                  value="runtime"
                  className="flex-none px-3 py-2 text-xs"
                >
                  Packages &amp; Python
                </TabsTrigger>
                <TabsTrigger
                  value="environment"
                  className="flex-none px-3 py-2 text-xs"
                >
                  Environment variables
                </TabsTrigger>
                <TabsTrigger
                  value="scripts"
                  className="flex-none px-3 py-2 text-xs"
                >
                  Scripts
                </TabsTrigger>
                <TabsTrigger
                  value="advanced"
                  className="flex-none px-3 py-2 text-xs"
                >
                  Advanced
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="runtime" className="m-0">
              <RuntimeSettingsSection {...execution} />
            </TabsContent>

            <TabsContent value="environment" className="m-0">
              <EnvironmentSettingsSection environmentVariables={execution.environmentVariables} setEnvironmentVariables={execution.setEnvironmentVariables} />
            </TabsContent>

            <TabsContent value="scripts" className="m-0">
              <ScriptsSettingsSection {...execution} />
            </TabsContent>

            <TabsContent value="advanced" className="m-0">
              <div className="flex flex-col">
                <TimeoutSettingsSection {...execution} />

                <Separator />

                <PublicationSettingsSection settings={publication} />

                <DeleteProjectSection project={project} />
              </div>
            </TabsContent>
          </Tabs>
        )}
      </FramePanel>
    </Frame>
  );
}
