import { notFound } from "next/navigation";
import { projectService } from "@backend/projects/project.service";
import { ProjectViews } from "@/components/project-views";
import { ProjectInfoTooltip } from "@/components/project-info-tooltip";

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
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {project.name}
        </h1>
        <ProjectInfoTooltip project={project} />
      </div>

      <ProjectViews project={project} />
    </div>
  );
}
