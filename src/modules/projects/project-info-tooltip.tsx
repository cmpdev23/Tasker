"use client";

import { InfoIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type Project } from "@db/schema";

interface ProjectInfoTooltipProps {
  project: Project;
}

export function ProjectInfoTooltip({ project }: ProjectInfoTooltipProps) {
  const formattedDate = new Date(project.createdAt).toLocaleDateString(
    undefined,
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Informations du projet"
          />
        }
      >
        <InfoIcon className="size-4" />
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        className="flex max-w-sm flex-col items-start gap-1.5 p-3 text-xs leading-relaxed"
      >
        <div>
          <span className="text-background/70">Slug : </span>
          <span className="font-mono font-medium text-background">
            {project.slug}
          </span>
        </div>
        <div>
          <span className="text-background/70">Project ID : </span>
          <span className="font-mono text-background">{project.id}</span>
        </div>
        <div>
          <span className="text-background/70">Repository Path : </span>
          <span className="text-background">
            {project.repositoryPath || "No repository linked"}
          </span>
        </div>
        <div>
          <span className="text-background/70">Created At : </span>
          <span className="text-background">{formattedDate}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
