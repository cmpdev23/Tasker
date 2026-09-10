import {
  projectRepository,
  type ProjectRepository,
} from "./project.repository";
import { type Project } from "@db/schema";
import { ConflictError, NotFoundError, ValidationError } from "../errors";

export interface CreateProjectDTO {
  name: string;
  repositoryPath?: string | null;
  defaultBranch?: string | null;
}

export interface UpdateProjectDTO {
  name?: string;
  slug?: string;
  repositoryPath?: string | null;
  defaultBranch?: string | null;
}

export function slugify(text: string): string {
  const slug = text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `project-${Date.now()}`;
}

export class ProjectService {
  constructor(private readonly repo: ProjectRepository = projectRepository) {}

  async listProjects(): Promise<Project[]> {
    return this.repo.listProjects();
  }

  async getProjectById(id: string): Promise<Project> {
    if (!id || typeof id !== "string") {
      throw new ValidationError("Invalid project ID provided.");
    }
    const project = await this.repo.getProjectById(id);
    if (!project) {
      throw new NotFoundError(`Project with ID "${id}" was not found.`);
    }
    return project;
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    if (!slug || typeof slug !== "string") {
      throw new ValidationError("Invalid project slug provided.");
    }
    return this.repo.getProjectBySlug(slug);
  }

  async createProject(dto: CreateProjectDTO): Promise<Project> {
    if (!dto || typeof dto.name !== "string" || !dto.name.trim()) {
      throw new ValidationError("Project name is required and cannot be empty.");
    }

    const trimmedName = dto.name.trim();
    const baseSlug = slugify(trimmedName);

    // Ensure slug uniqueness
    let finalSlug = baseSlug;
    let counter = 1;
    while (await this.repo.getProjectBySlug(finalSlug)) {
      finalSlug = `${baseSlug}-${counter}`;
      counter++;
    }

    return this.repo.createProject({
      name: trimmedName,
      slug: finalSlug,
      repositoryPath: dto.repositoryPath?.trim() || null,
    });
  }

  async updateProject(id: string, dto: UpdateProjectDTO): Promise<Project> {
    if (!id || typeof id !== "string") {
      throw new ValidationError("Invalid project ID provided.");
    }

    const existing = await this.repo.getProjectById(id);
    if (!existing) {
      throw new NotFoundError(`Project with ID "${id}" was not found.`);
    }

    const updateData: {
      name?: string;
      slug?: string;
      repositoryPath?: string | null;
      defaultBranch?: string | null;
    } = {};

    if (dto.name !== undefined) {
      if (typeof dto.name !== "string" || !dto.name.trim()) {
        throw new ValidationError("Project name cannot be empty.");
      }
      updateData.name = dto.name.trim();
    }

    if (dto.slug !== undefined) {
      if (typeof dto.slug !== "string" || !dto.slug.trim()) {
        throw new ValidationError("Project slug cannot be empty.");
      }
      const newSlug = slugify(dto.slug);
      if (newSlug !== existing.slug) {
        const slugExists = await this.repo.getProjectBySlug(newSlug);
        if (slugExists && slugExists.id !== id) {
          throw new ConflictError(`Project slug "${newSlug}" is already in use.`);
        }
        updateData.slug = newSlug;
      }
    }

    if (dto.repositoryPath !== undefined) {
      updateData.repositoryPath = dto.repositoryPath ? dto.repositoryPath.trim() : null;
    }

    if (dto.defaultBranch !== undefined) {
      updateData.defaultBranch = dto.defaultBranch ? dto.defaultBranch.trim() : null;
    }

    const updated = await this.repo.updateProject(id, updateData);
    if (!updated) {
      throw new NotFoundError(`Failed to update project "${id}".`);
    }
    return updated;
  }

  async deleteProject(id: string): Promise<boolean> {
    if (!id || typeof id !== "string") {
      throw new ValidationError("Invalid project ID provided.");
    }

    const existing = await this.repo.getProjectById(id);
    if (!existing) {
      throw new NotFoundError(`Project with ID "${id}" was not found.`);
    }

    return this.repo.deleteProject(id);
  }
}

export const projectService = new ProjectService();
