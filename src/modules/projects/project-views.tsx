"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { type Project } from "@db/schema";
import { ProjectSettingsForm } from "@/modules/projects/project-settings-form";
import { ProjectInstructionsView } from "@/modules/instructions/project-instructions-view";
import { ProjectAgentsView } from "@/modules/agents/project-agents-view";
import { ProjectTasksView } from "@/modules/tasks/project-tasks-view";
import { ProjectSequencesView } from "@/modules/sequences/project-sequences-view";

interface ProjectViewsProps {
  project: Project;
}

export function ProjectViews({ project: initialProject }: ProjectViewsProps) {
  const [project, setProject] = useState<Project>(initialProject);
  const [activeTab, setActiveTab] = useState<string>("tasks");

  return (
    <div className="flex flex-col gap-6 w-full">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col gap-6 w-full"
      >
        <div className="flex justify-center w-full">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="sequences">Sequences</TabsTrigger>
            <TabsTrigger value="instructions">Instructions</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="tasks" className="w-full">
          <ProjectTasksView project={project} onNavigateToSettings={() => setActiveTab("settings")} />
        </TabsContent>

        <TabsContent value="sequences" className="w-full">
          <ProjectSequencesView project={project} onNavigateToSettings={() => setActiveTab("settings")} />
        </TabsContent>

        <TabsContent value="instructions" className="w-full">
          <div className="flex justify-center w-full">
            <ProjectInstructionsView
              project={project}
              onNavigateToSettings={() => setActiveTab("settings")}
            />
          </div>
        </TabsContent>

        <TabsContent value="agents" className="w-full">
          <div className="flex justify-center w-full">
            <ProjectAgentsView
              project={project}
              onNavigateToSettings={() => setActiveTab("settings")}
            />
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
      </Tabs>
    </div>
  );
}
