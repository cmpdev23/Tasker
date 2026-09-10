# CodexTasker

CodexTasker est une application Next.js 16 (App Router) initialisée en TypeScript, avec Tailwind CSS 4, shadcn et les blocs ReUI.

## Architecture

- `src/app/page.tsx` affiche l'App Shell ReUI principal.
- `src/components/blocks/app-shell-3/` contient l'App Shell et sa navigation latérale persistante.
- `src/components/ui/` contient les primitives shadcn générées ; `src/components/reui/` contient les primitives ReUI.
- `components.json` configure le registre ReUI. Il référence `REUI_LICENSE_KEY` depuis l'environnement via un en-tête Bearer, sans stocker la clé dans le dépôt.

## Commandes

- `npm run dev` lance l'application sur `http://localhost:5000`.
- `npm run lint` vérifie ESLint.
- `npm run build` crée la version de production.

## État actuel

L'écran d'accueil est un App Shell ReUI avec une barre latérale toujours visible sur ordinateur et repliable sur mobile. La marque visible et les métadonnées sont `CodexTasker`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
