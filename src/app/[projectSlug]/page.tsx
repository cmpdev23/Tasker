import { notFound } from "next/navigation";
import { projectService } from "@backend/projects/project.service";
import { ProjectViews } from "@/components/project-views";

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
        <h1 className="text-2xl font-semibold tracking-tight">
          {project.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Slug:{" "}
          <span className="font-mono text-foreground">{project.slug}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Project ID :{" "}
          <span className="font-mono text-foreground">{project.id}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Repository Path : {project.repositoryPath || "No repository linked"}
        </p>
        <p className="text-xs text-muted-foreground">
          Created At :{" "}
          {new Date(project.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>

      <ProjectViews project={project} />
    </div>
  );
}
