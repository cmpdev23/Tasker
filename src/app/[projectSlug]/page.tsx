import { notFound } from "next/navigation";
import { projectService } from "@backend/projects/project.service";

interface ProjectPageProps {
  params: Promise<{ projectSlug: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectSlug } = await params;
  const project = await projectService.getProjectBySlug(projectSlug);

  if (!project) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
        <p className="text-sm text-muted-foreground">
          Slug: <span className="font-mono text-foreground">{project.slug}</span>
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="bg-card border-border/40 rounded-lg border p-4 shadow-xs">
          <div className="text-xs font-medium text-muted-foreground">Project ID</div>
          <div className="mt-1 font-mono text-xs truncate" title={project.id}>
            {project.id}
          </div>
        </div>
        <div className="bg-card border-border/40 rounded-lg border p-4 shadow-xs">
          <div className="text-xs font-medium text-muted-foreground">Repository Path</div>
          <div className="mt-1 text-sm">
            {project.repositoryPath || "No repository linked"}
          </div>
        </div>
        <div className="bg-card border-border/40 rounded-lg border p-4 shadow-xs">
          <div className="text-xs font-medium text-muted-foreground">Created At</div>
          <div className="mt-1 text-sm">
            {new Date(project.createdAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
      </div>

      <div className="bg-muted/30 border-border/40 min-h-[260px] rounded-lg border p-6 flex flex-col justify-center items-center text-center">
        <h2 className="text-lg font-medium">{project.name}</h2>
        <p className="text-sm text-muted-foreground max-w-md mt-1">
          Projet AgentTasker configuré et persisté dans SQLite.
        </p>
      </div>
    </div>
  );
}
