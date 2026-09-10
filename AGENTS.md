# AgentTasker

AgentTasker est une application locale et open source, conçue spécifiquement pour orchestrer OpenAI Codex contre des dépôts Git locaux. Le MVP n'est pas une plateforme multi-provider et ne doit pas introduire d'abstraction générique de fournisseur.

La vision et le périmètre produit de référence se trouvent dans `AgentTasker_README.md`. Le nom du dépôt et du package (`CodexTasker` / `codex-tasker`) provient du squelette initial ; l’interface et les nouvelles fonctionnalités doivent adopter la marque **AgentTasker**, sauf décision explicite de migration technique.

## Principes produit non négociables

- **Local-first et multiplateforme :** pas de compte, SaaS ou plan de contrôle hébergé pour le MVP ; Windows, macOS et Linux sont ciblés.
- **Orchestration déterministe :** AgentTasker possède la planification, la file, les workers, les worktrees, le cycle de processus, les timeouts, les validations, Git, les logs et le nettoyage. L’agent produit le travail, mais ne détermine pas seul le statut final.
- **Isolation Git par défaut :** un Run s’exécute normalement dans un worktree temporaire, jamais dans le checkout de travail habituel de l’utilisateur.
- **Validation indépendante :** le statut de succès dépend notamment des codes de sortie, du diff Git et des commandes de validation configurées ; une déclaration de succès de l’agent est insuffisante.
- **Contrôle humain de l’intégration :** l’auto-merge est désactivé par défaut. Le flux attendu est validation, commit, push optionnel, puis PR brouillon optionnelle et revue humaine.
- **Traçabilité et récupération :** les Runs conservent événements, logs bruts, stderr, validations, diff, erreurs, branche et worktree afin de rendre chaque résultat compréhensible et récupérable.

## Modèle produit cible

- L’application comporte des **Projects** et des réglages globaux.
- Un Project regroupe `Overview`, `Tasks`, `Instructions` et `Settings`.
- Les Instructions de projet sont persistantes et s’ajoutent aux instructions propres à une Task. Les références sélectionnées sont des chemins relatifs dans le dépôt, sans duplication ni RAG requis pour le MVP.
- Une **Task** est une définition réutilisable : instructions, références, surcharges agent, planification, validations et comportement Git.
- Un **Run** est une exécution d’une Task, avec les statuts `QUEUED`, `PREPARING`, `RUNNING`, `VALIDATING`, `SUCCESS`, `FAILED` ou `CANCELLED`.
- Le Scheduler crée les Runs dus ; tous les Runs, y compris `Run now`, passent par la même Queue avant d’être traités par des Workers. Aucun ordonnanceur OS (cron, Task Scheduler, systemd ou launchd) ne doit être utilisé pour chaque Task.
- Les exécutions longues appartiennent au runner serveur, pas à une requête du navigateur. Le navigateur sert au contrôle et à l’observabilité et peut être fermé sans interrompre un Run.

## Architecture et stack actuelle

- Application Next.js 16 (App Router), TypeScript, React 19 et Tailwind CSS 4.
- `src/app/page.tsx` et `src/app/[projectSlug]/page.tsx` utilisent l’App Shell ReUI et les vues Project (Overview, Settings, Instructions, Tasks, Agents).
- `src/components/blocks/app-shell-3/` contient l’App Shell et sa navigation latérale persistante.
- `src/components/ui/` contient les primitives shadcn ; `src/components/reui/` contient les primitives ReUI.
- `components.json` configure le registre ReUI et lit `REUI_LICENSE_KEY` depuis l’environnement via un en-tête Bearer, sans jamais enregistrer la clé dans le dépôt.
- SQLite/Drizzle, la gestion des Projects, l'initialisation `.tasker/`, les Instructions, les Settings Git et la tab Agents sont implémentés.
- La tab Agents édite `.tasker/agents/main.toml` et les sous-agents TOML, avec découverte locale des modèles via `codex app-server` / `model/list`.
- La tab Tasks fournit le CRUD versionné `.tasker/tasks/`, les plannings manual/once/daily/weekly, Run now, un Sheet live et l’historique.
- Le scheduler et le worker uniques démarrent côté serveur via `src/instrumentation.ts`. SQLite possède Runs, événements, curseurs et verrou interprocessus ; le worker lance réellement `codex exec` dans un worktree créé depuis la base distante fraîchement fetchée.
- Le succès exige une sortie structurée positive et les contrôles Git ; le worker commit sans push/merge. Les échecs/annulations préservent le worktree. Voir `docs/task-runner-architecture.md` pour les politiques de reprise et de nettoyage.

## Direction d’implémentation

La direction technique du MVP est TypeScript/Node.js, Next.js/React, shadcn/ui, SQLite et Drizzle ORM, avec Git CLI, Codex CLI/app-server et/ou SDK, et GitHub CLI/API seulement lorsque l’intégration GitHub est activée.

L'intégration d'agent doit être spécifique à Codex et refléter sa configuration native. Ne pas créer d'interface `AgentProvider`, de dropdown de fournisseur ou d'architecture anticipant Claude, Gemini ou d'autres agents.

Les premières entités durables sont `Project`, `Reference`, `Task`, `Run` et `RunEvent`. Les paramètres agent et exécution de projet peuvent être surchargés par Task. Conserver dans un Run les horodatages, configuration résolue, worktree, branche, code de sortie, résultat, erreur, commit et URL de PR lorsque pertinents.

## Périmètre MVP

Inclure : projets et détection Git locale, instructions et références de dépôt, création/édition de Tasks, exécution manuelle et récurrente, scheduler interne, queue et concurrence configurable, worktrees temporaires, exécution Codex, journaux live, annulation, validations, commit après succès, push/PR brouillon optionnels, historique des Runs, SQLite et récupération de base après échec.

Exclure : service cloud AgentTasker, comptes, équipes, orchestration multi-machine, marketplace/plugins, vector DB/RAG, workflow builder visuel, auto-merge par défaut, nombreux fournisseurs d’agents et application mobile.

## Règles de développement

- Avant toute modification de code Next.js, lire la documentation pertinente dans `node_modules/next/dist/docs/`, car Next.js 16 contient des changements incompatibles avec des conventions plus anciennes.
- Avant de modifier l’exécution Git, les Runs de tâches, la création de branches ou le comportement des worktrees, lire obligatoirement `docs/git-worktree-architecture.md`.
- Avant de modifier Tasks, Runs, scheduler, Codex runner ou worktrees, lire obligatoirement `docs/task-runner-architecture.md`. Le schéma des tâches est documenté dans `docs/task-configuration.md`.
- Avant de modifier la persistance ou la configuration `.tasker/`, consulter `docs/tasker-persistence-architecture.md`.
- Préserver les fonctionnalités existantes ; après une modification transversale, vérifier chaque système affecté.
- Ne jamais lire, afficher ou modifier des fichiers `.env*` contenant des secrets. Utiliser exclusivement `.env.example` comme modèle, avec de fausses valeurs. Ajouter une variable seulement pour un secret ou une valeur réellement dépendante de l’environnement.
- Ne jamais mettre `REUI_LICENSE_KEY` dans le code, un fichier versionné ou une documentation contenant une valeur. Si l’accès ReUI Premium est en cause, seulement vérifier sa présence, jamais sa valeur.
- Rendre visibles et contrôlables les cibles de dépôt, commandes de validation, paramètres réseau/sandbox et nettoyages destructifs. Ne pas escalader silencieusement les permissions et ne pas exposer de credentials dans les prompts.
- Préserver les worktrees de Runs échoués par défaut lorsque cela aide à récupérer du travail partiel ; tout nettoyage destructif doit être explicite.
- Après un refactor, recenser le code devenu inaccessible dans `branch_doc/dead_code.md` ; ne le créer ou le modifier que si du code mort concret a été identifié.
- Avant de finir une tâche, vérifier si `AGENTS.md`, `docs/`, `branch_doc/` et `.gitignore` nécessitent une mise à jour durable. `docs/` contient les décisions livrées et stables ; `branch_doc/` contient les analyses et plans en cours.
- Après une erreur récurrente ou une correction importante de l’utilisateur, mettre à jour `LESSONS.md` avec une règle préventive concise. Le relire au début des sessions lorsqu’il existe.

## Commandes

- `npm run dev` lance l’application sur `http://localhost:5000`.
- `npm run lint` exécute ESLint.
- `npm run build` génère la version de production.
- `npm run typecheck` vérifie TypeScript ; `npm test` lance les tests filesystem, horaires, SQLite, Git et processus sur des fixtures temporaires. Le Node.js utilisé doit correspondre au binaire natif `better-sqlite3` installé.
- Le runner requiert un serveur Node persistant et Codex authentifié. `DATABASE_PATH` configure la base ; `AGENTTASKER_DATA_DIR` peut définir un runtime externe aux dépôts. `.test-artifacts/` contient les résultats locaux ignorés des smoke tests volontaires.

## Prochaines étapes

1. Valider les chemins POSIX du runner sur macOS/Linux (tests d’intégration actuels sous Windows).
2. Ajouter les validations configurables et, si souhaité, push/PR brouillon contrôlés.
3. Ajouter une interface de récupération pour les terminaisons non vérifiées, puis la rétention des logs/branches/worktrees.
4. Étendre les références et les sous-agents personnalisés sans abstraction multi-provider.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
