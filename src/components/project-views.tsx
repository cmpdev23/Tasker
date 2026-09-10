"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Project } from "@db/schema";

interface ProjectViewsProps {
  project: Project;
}

export function ProjectViews({ project }: ProjectViewsProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-center">
        <Tabs defaultValue="overviews">
          <TabsList>
            <TabsTrigger value="overviews">Overviews</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="instructions">Instructions</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="bg-muted/30 min-h-[260px] p-6 flex flex-col justify-center items-center text-center">
        <h2 className="text-lg font-medium">{project.name}</h2>
        <p className="text-sm text-muted-foreground max-w-md mt-1">
          Projet AgentTasker configuré et persisté dans SQLite.
        </p>
      </div>
    </div>
  );
}
