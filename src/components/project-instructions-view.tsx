"use client";

import { useState, useEffect, useCallback } from "react";
import { type Project } from "@db/schema";
import {
  Frame,
  FrameHeader,
  FrameTitle,
  FrameDescription,
  FramePanel,
} from "@/components/reui/frame";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  FileTextIcon,
  SaveIcon,
  Loader2Icon,
  AlertCircleIcon,
  SettingsIcon,
  CheckCircle2Icon,
  RefreshCwIcon,
} from "lucide-react";

interface ProjectInstructionsViewProps {
  project: Project;
  onNavigateToSettings?: () => void;
}

export function ProjectInstructionsView({
  project,
  onNavigateToSettings,
}: ProjectInstructionsViewProps) {
  const [instructions, setInstructions] = useState<string>("");
  const [initialInstructions, setInitialInstructions] = useState<string>("");
  const [filePath, setFilePath] = useState<string>(".tasker/instructions.md");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<
    "NO_REPOSITORY" | "NOT_INITIALIZED" | "FETCH_ERROR" | null
  >(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const fetchInstructions = useCallback(async () => {
    if (!project.repositoryPath) {
      setErrorCode("NO_REPOSITORY");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      const res = await fetch(`/api/projects/${project.id}/instructions`);
      const data = await res.json();

      if (!res.ok) {
        if (data.code === "NO_REPOSITORY" || data.code === "NOT_INITIALIZED") {
          setErrorCode(data.code);
          return;
        }
        throw new Error(data.error || "Erreur lors du chargement des instructions.");
      }

      setInstructions(data.instructions ?? "");
      setInitialInstructions(data.instructions ?? "");
      if (data.filePath) {
        setFilePath(data.filePath);
      }
    } catch (err: unknown) {
      console.error("fetchInstructions error:", err);
      const message =
        err instanceof Error
          ? err.message
          : "Impossible de charger les instructions du projet.";
      setError(message);
      setErrorCode("FETCH_ERROR");
    } finally {
      setIsLoading(false);
    }
  }, [project.id, project.repositoryPath]);

  useEffect(() => {
    fetchInstructions();
  }, [fetchInstructions]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/projects/${project.id}/instructions`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instructions,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error || "Une erreur est survenue lors de la sauvegarde."
        );
      }

      setInitialInstructions(data.instructions ?? instructions);
      if (data.filePath) {
        setFilePath(data.filePath);
      }
      setLastSavedAt(new Date());
      toast.success("Instructions enregistrées avec succès.");
    } catch (err: unknown) {
      console.error("handleSave error:", err);
      const message =
        err instanceof Error
          ? err.message
          : "Erreur lors de la sauvegarde des instructions.";
      setError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  // État 1 : Chargement
  if (isLoading) {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <Frame stacked spacing="sm" className="w-full">
          <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-0.5">
              <FrameTitle>Instructions du projet</FrameTitle>
              <FrameDescription>
                Ces instructions sont appliquées à toutes les tâches exécutées dans ce projet.
              </FrameDescription>
            </div>
          </FrameHeader>
          <FramePanel className="p-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2Icon className="size-6 animate-spin text-primary" />
            <p className="text-sm">Chargement des instructions...</p>
          </FramePanel>
        </Frame>
      </div>
    );
  }

  // État 2 : Aucun repository configuré
  if (errorCode === "NO_REPOSITORY" || !project.repositoryPath) {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <Frame stacked spacing="sm" className="w-full">
          <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-0.5">
              <FrameTitle>Instructions du projet</FrameTitle>
              <FrameDescription>
                Ces instructions sont appliquées à toutes les tâches exécutées dans ce projet.
              </FrameDescription>
            </div>
          </FrameHeader>
          <FramePanel className="p-8 flex flex-col items-center justify-center text-center gap-4">
            <div className="size-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
              <AlertCircleIcon className="size-6" />
            </div>
            <div className="flex flex-col gap-1 max-w-md">
              <h3 className="text-sm font-medium text-foreground">
                Repository non configuré
              </h3>
              <p className="text-sm text-muted-foreground">
                Configurez d’abord le repository du projet dans Settings.
              </p>
            </div>
            {onNavigateToSettings && (
              <Button
                type="button"
                variant="outline"
                onClick={onNavigateToSettings}
                className="gap-2"
              >
                <SettingsIcon className="size-4" />
                Ouvrir les paramètres du projet
              </Button>
            )}
          </FramePanel>
        </Frame>
      </div>
    );
  }

  // État 3 : Tasker non initialisé
  if (errorCode === "NOT_INITIALIZED") {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <Frame stacked spacing="sm" className="w-full">
          <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-0.5">
              <FrameTitle>Instructions du projet</FrameTitle>
              <FrameDescription>
                Ces instructions sont appliquées à toutes les tâches exécutées dans ce projet.
              </FrameDescription>
            </div>
          </FrameHeader>
          <FramePanel className="p-8 flex flex-col items-center justify-center text-center gap-4">
            <div className="size-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
              <AlertCircleIcon className="size-6" />
            </div>
            <div className="flex flex-col gap-1 max-w-md">
              <h3 className="text-sm font-medium text-foreground">
                Tasker non initialisé
              </h3>
              <p className="text-sm text-muted-foreground">
                Initialisez Tasker dans Settings avant de configurer les instructions.
              </p>
            </div>
            {onNavigateToSettings && (
              <Button
                type="button"
                variant="outline"
                onClick={onNavigateToSettings}
                className="gap-2"
              >
                <SettingsIcon className="size-4" />
                Aller dans Settings
              </Button>
            )}
          </FramePanel>
        </Frame>
      </div>
    );
  }

  // État 4 : Erreur de chargement générique
  if (errorCode === "FETCH_ERROR") {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <Frame stacked spacing="sm" className="w-full">
          <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-0.5">
              <FrameTitle>Instructions du projet</FrameTitle>
              <FrameDescription>
                Ces instructions sont appliquées à toutes les tâches exécutées dans ce projet.
              </FrameDescription>
            </div>
          </FrameHeader>
          <FramePanel className="p-8 flex flex-col items-center justify-center text-center gap-4">
            <div className="size-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
              <AlertCircleIcon className="size-6" />
            </div>
            <div className="flex flex-col gap-1 max-w-md">
              <h3 className="text-sm font-medium text-foreground">
                Erreur de chargement
              </h3>
              <p className="text-sm text-muted-foreground">
                {error || "Une erreur est survenue lors de la lecture des instructions."}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={fetchInstructions}
              className="gap-2"
            >
              <RefreshCwIcon className="size-4" />
              Réessayer
            </Button>
          </FramePanel>
        </Frame>
      </div>
    );
  }

  const isDirty = instructions !== initialInstructions;

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col gap-6">
      <Frame stacked spacing="sm" className="w-full">
        <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <FrameTitle>Instructions du projet</FrameTitle>
            <FrameDescription>
              Ces instructions sont appliquées à toutes les tâches exécutées dans ce projet.
            </FrameDescription>
          </div>
          <div className="flex items-center gap-2">
            {isDirty && (
              <Badge variant="warning-light" className="text-xs">
                Modifications non enregistrées
              </Badge>
            )}
            {lastSavedAt && !isDirty && (
              <Badge variant="success-light" className="text-xs gap-1">
                <CheckCircle2Icon className="size-3" />
                Enregistré
              </Badge>
            )}
          </div>
        </FrameHeader>

        <FramePanel className="p-4 flex flex-col gap-4">
          {error && (
            <div className="p-3 text-xs rounded-md bg-destructive/10 text-destructive flex items-center gap-2">
              <AlertCircleIcon className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="instructions-textarea"
              className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"
            >
              <FileTextIcon className="size-3.5" />
              Contenu Markdown
            </label>
            <textarea
              id="instructions-textarea"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="# Instructions du projet..."
              rows={18}
              spellCheck={false}
              className="w-full min-h-[380px] p-3 text-sm font-mono leading-relaxed rounded-md border border-input bg-background/50 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Fichier :</span>
              <code className="font-mono font-medium px-2 py-0.5 rounded bg-muted text-foreground">
                {filePath}
              </code>
            </div>

            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="gap-1.5 shrink-0"
            >
              {isSaving ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Enregistrement...
                </>
              ) : (
                <>
                  <SaveIcon className="size-4" />
                  Enregistrer les modifications
                </>
              )}
            </Button>
          </div>
        </FramePanel>
      </Frame>
    </div>
  );
}
