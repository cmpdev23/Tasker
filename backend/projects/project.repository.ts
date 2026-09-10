import { db } from "@db/client";
import { projects, type Project } from "@db/schema";
import { eq, desc } from "drizzle-orm";

export interface CreateProjectRepoInput {
  name: string;
  slug: string;
  repositoryPath?: string | null;
  defaultBranch?: string | null;
}

export interface UpdateProjectRepoInput {
  name?: string;
  slug?: string;
  repositoryPath?: string | null;
  defaultBranch?: string | null;
}

export class ProjectRepository {
  async listProjects(): Promise<Project[]> {
    return db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async getProjectById(id: string): Promise<Project | null> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project ?? null;
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    const [project] = await db.select().from(projects).where(eq(projects.slug, slug));
    return project ?? null;
  }

  async createProject(input: CreateProjectRepoInput): Promise<Project> {
    const [created] = await db
      .insert(projects)
      .values({
        name: input.name,
        slug: input.slug,
        repositoryPath: input.repositoryPath ?? null,
        defaultBranch: input.defaultBranch ?? null,
      })
      .returning();
    return created;
  }

  async updateProject(id: string, input: UpdateProjectRepoInput): Promise<Project | null> {
    const updateValues: Partial<typeof projects.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };

    if (input.name !== undefined) {
      updateValues.name = input.name;
    }
    if (input.slug !== undefined) {
      updateValues.slug = input.slug;
    }
    if (input.repositoryPath !== undefined) {
      updateValues.repositoryPath = input.repositoryPath;
    }
    if (input.defaultBranch !== undefined) {
      updateValues.defaultBranch = input.defaultBranch;
    }

    const [updated] = await db
      .update(projects)
      .set(updateValues)
      .where(eq(projects.id, id))
      .returning();

    return updated ?? null;
  }

  async deleteProject(id: string): Promise<boolean> {
    const [deleted] = await db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning();
    return Boolean(deleted);
  }
}

export const projectRepository = new ProjectRepository();
