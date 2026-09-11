import type { ProjectCommandActivity } from "./project-command-events";

const labels = { running: "En cours", success: "Réussie", failed: "Échec", cancelled: "Annulée",
  "timed-out": "Délai dépassé", interrupted: "Résultat non confirmé" } as const;

export function ProjectCommands({ commands }: { commands: ProjectCommandActivity[] }) {
  if (!commands.length) return null;
  return (
    <section aria-labelledby="project-commands-title" className="space-y-3">
      <h2 id="project-commands-title" className="text-sm font-medium">Installation et validations du projet</h2>
      {commands.map(command => {
        const failed = command.status === "failed" || command.status === "timed-out";
        return (
          <div key={command.id} className="rounded-md border px-3 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-muted-foreground">{command.phase === "validation" ? "Validation" : "Installation"}</span>
              <code className="break-all">{command.command}</code>
              <span className={failed ? "font-medium text-destructive" : command.status === "success" ? "text-success" : "text-muted-foreground"}>{labels[command.status]}</span>
              <span className="text-muted-foreground">Code : {command.exitCode ?? "non disponible"}</span>
            </div>
            {command.error && <p className="mt-2 break-words text-destructive">{command.error}</p>}
            {command.output && (
              <details open={failed} className="mt-2">
                <summary className="cursor-pointer text-muted-foreground">Sortie de la commande{command.outputTruncated ? " (dernières lignes)" : ""}</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-3 text-[0.6875rem] leading-5">{command.output}</pre>
                {command.outputTruncated && <p className="mt-1 text-muted-foreground">La sortie complète reste disponible dans les événements bruts et les logs.</p>}
              </details>
            )}
          </div>
        );
      })}
    </section>
  );
}
