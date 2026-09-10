"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { type Project } from "@db/schema";
import { ProjectSettingsForm } from "@/components/project-settings-form";
import { ProjectInstructionsView } from "@/components/project-instructions-view";
import { ProjectAgentsView } from "@/components/project-agents-view";
import { ProjectTasksView } from "@/components/project-tasks-view";

interface ProjectViewsProps {
  project: Project;
}

export function ProjectViews({ project: initialProject }: ProjectViewsProps) {
  const [project, setProject] = useState<Project>(initialProject);
  const [activeTab, setActiveTab] = useState<string>("overview");

  return (
    <div className="flex flex-col gap-6 w-full">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col gap-6 w-full"
      >
        <div className="flex justify-center w-full">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="instructions">Instructions</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          <div className="bg-muted/30 min-h-[260px] p-6 flex flex-col justify-center items-center text-center">
            <h2 className="text-lg font-medium">{project.name}</h2>
            <p className="text-sm text-muted-foreground max-w-md mt-1">
              Projet AgentTasker configuré et persisté dans SQLite.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="w-full">
          <div className="flex justify-center w-full">
            <ProjectSettingsForm
              project={project}
              onProjectUpdate={setProject}
            />
          </div>
        </TabsContent>

        <TabsContent value="instructions" className="w-full">
          <div className="flex justify-center w-full">
            <ProjectInstructionsView
              project={project}
              onNavigateToSettings={() => setActiveTab("settings")}
            />
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="w-full">
          <ProjectTasksView project={project} onNavigateToSettings={() => setActiveTab("settings")} />
        </TabsContent>

        <TabsContent value="agents" className="w-full">
          <div className="flex justify-center w-full">
            <ProjectAgentsView
              project={project}
              onNavigateToSettings={() => setActiveTab("settings")}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
