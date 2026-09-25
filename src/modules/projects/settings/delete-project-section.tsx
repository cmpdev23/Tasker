"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { type Project } from "@db/schema";

import { Button } from "@/components/ui/button";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { toast } from "sonner";
import { useProjects } from "@/modules/projects/projects-context";

import { Loader2Icon, Trash2Icon } from "lucide-react";

export function DeleteProjectSection({ project }: { project: Project }) {
  const router = useRouter();
  const { deleteProject } = useProjects();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteProject = async () => {
    if (isDeletingProject) return;
    setIsDeletingProject(true);
    setDeleteError(null);
    try {
      await deleteProject(project.id);
      setIsDeleteDialogOpen(false);
      toast.success(`Projet « ${project.name} » supprimé.`);
      router.replace("/");
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error
          ? err.message
          : "Impossible de supprimer le projet.";
      setDeleteError(message);
      toast.error(message);
    } finally {
      setIsDeletingProject(false);
    }
  };
  return <>
    <div className="border-t-4 border-t-destructive/25 bg-destructive/[0.025] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-destructive">
            Zone de danger
          </h3>
          <p className="text-xs text-muted-foreground">
            Supprime le projet et son historique de la base locale
            AgentTasker. Le repository sur disque ne sera pas
            supprimé.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          onClick={() => {
            setDeleteError(null);
            setIsDeleteDialogOpen(true);
          }}
          className="shrink-0 gap-1.5"
        >
          <Trash2Icon className="size-4" />
          Supprimer le projet
        </Button>
      </div>
    </div>
    <Dialog
      open={isDeleteDialogOpen}
      onOpenChange={(open) => {
        if (!open && !isDeletingProject) {
          setIsDeleteDialogOpen(false);
          setDeleteError(null);
        }
      }}
    >
      <DialogContent showCloseButton={!isDeletingProject}>
        <DialogHeader>
          <DialogTitle>Supprimer le projet ?</DialogTitle>
          <DialogDescription>
            Cette action est irréversible. Le projet « {project.name} » et son
            historique d’exécutions seront supprimés d’AgentTasker. Le
            repository sur disque ne sera pas supprimé.
          </DialogDescription>
        </DialogHeader>
        {deleteError && (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isDeletingProject}
            onClick={() => {
              setIsDeleteDialogOpen(false);
              setDeleteError(null);
            }}
          >
            Annuler
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isDeletingProject}
            onClick={handleDeleteProject}
          >
            {isDeletingProject && (
              <Loader2Icon className="size-4 animate-spin" />
            )}
            Supprimer le projet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
