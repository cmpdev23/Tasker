"use client";

import { useCallback, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { shortId } from "./format";

export interface RunIdCopyProps {
  id: string;
  displayText?: string;
  prefix?: string;
  className?: string;
}

export function RunIdCopy({
  id,
  displayText,
  prefix = "Run ",
  className,
}: RunIdCopyProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(id);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = id;
          textarea.style.position = "fixed";
          textarea.style.left = "-9999px";
          textarea.style.top = "0";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
        setCopied(true);
        toast.success("ID du Run copié.");
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error("Impossible de copier l’ID du Run.");
      }
    },
    [id],
  );

  const display = displayText ?? shortId(id);

  return (
    <span className={cn("inline-flex items-center gap-1 font-mono", className)}>
      <span title={id}>
        {prefix}
        {display}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title={copied ? "Copié !" : `Copier l’ID complet (${id})`}
        aria-label="Copier l’ID complet du Run"
      >
        {copied ? (
          <CheckIcon className="size-3 text-success animate-in fade-in" aria-hidden="true" />
        ) : (
          <CopyIcon className="size-3" aria-hidden="true" />
        )}
      </button>
    </span>
  );
}
