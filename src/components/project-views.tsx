import { type Project } from "@db/schema";

interface ProjectViewsProps {
  project: Project;
}

export function ProjectViews({ project }: ProjectViewsProps) {
  return (
    <div className="bg-muted/30 border-border/40 min-h-[260px] rounded-lg border p-6 flex flex-col justify-center items-center text-center">
      <h2 className="text-lg font-medium">{project.name}</h2>
      <p className="text-sm text-muted-foreground max-w-md mt-1">
        Projet AgentTasker configuré et persisté dans SQLite.
      </p>
    </div>
  );
}
