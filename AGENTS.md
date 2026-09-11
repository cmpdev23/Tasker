# AgentTasker

AgentTasker est une application locale et open source, conçue spécifiquement pour orchestrer OpenAI Codex contre des dépôts Git locaux. Le MVP n'est pas une plateforme multi-provider et ne doit pas introduire d'abstraction générique de fournisseur.

La vision et le périmètre produit de référence se trouvent dans `AgentTasker_README.md`. Le nom du dépôt et du package (`CodexTasker` / `codex-tasker`) provient du squelette initial ; l’interface et les nouvelles fonctionnalités doivent adopter la marque **AgentTasker**, sauf décision explicite de migration technique.

## Référence fonctionnelle : automatisation Linux v3

`docs/v1/implantation-v3.md` décrit l'automatisation Linux qui fonctionnait
avant AgentTasker. C'est la référence concrète que l'interface doit reproduire
et généraliser; elle ne doit pas être confondue avec une dépendance de runtime
ni avec la documentation de l'architecture actuelle. Lire ce document avant
de modifier le runner, la queue, les worktrees, la validation, la finalisation
Git ou l'intégration PR.

Le système de référence exécutait, sur Linux et via un timer systemd, une
automatisation de création d'articles :

- une file de tâches JSON versionnée dans Git était sélectionnée depuis la
  base distante fraîchement fetchée;
- une branche distante jouait le rôle de réclamation atomique afin qu'une
  tâche ne soit jamais prise deux fois;
- chaque exécution utilisait un worktree éphémère, installait ses dépendances,
  construisait un prompt, lançait `codex exec` avec timeout et exigeait une
  sortie JSON conforme à un schéma;
- le runner, et non l'agent, décidait du succès en vérifiant le code de sortie,
  le schéma/résultat, un diff non vide composé uniquement de créations dans
  l'allowlist, puis le build;
- en succès comme en échec, l'état de la tâche était versionné et poussé; une
  PR brouillon était créée, avec le travail partiel préservé en cas d'échec;
- les logs par Run, les branches et les worktrees rendaient l'état récupérable;
  un nettoyage ne supprimait que les worktrees propres et entièrement poussés.

AgentTasker généralise ces règles : Tasks/Runs persistants plutôt que JSON de
blogue, scheduler interne plutôt que systemd, validations et allowlists propres
à chaque Task, et intégration Git/PR contrôlée par l'utilisateur. Les détails
spécifiques de la référence (`CMT_*`, `cmpdev23/cmt`, chemins de contenu,
cadence horaire, `npm run build`, `gpt-5.6-sol`) ne doivent jamais devenir des
valeurs codées en dur dans le produit.

## Principes produit non négociables

- **Local-first et multiplateforme :** pas de compte, SaaS ou plan de contrôle hébergé pour le MVP ; Windows, macOS et Linux sont ciblés.
- **Orchestration déterministe :** AgentTasker possède la planification, la file, les workers, les worktrees, le cycle de processus, les timeouts, les validations, Git, les logs et le nettoyage. L’agent produit le travail, mais ne détermine pas seul le statut final.
- **Isolation Git par défaut :** un Run s’exécute normalement dans un worktree temporaire, jamais dans le checkout de travail habituel de l’utilisateur.
- **Validation indépendante :** le statut de succès dépend notamment des codes de sortie, du diff Git et des commandes de validation configurées ; une déclaration de succès de l’agent est insuffisante.
- **Contrôle humain de l’intégration :** l’auto-merge est désactivé par défaut. Le flux attendu est validation, commit, push optionnel, puis PR brouillon optionnelle et revue humaine.
- **Traçabilité et récupération :** les Runs conservent événements, logs bruts, stderr, validations, diff, erreurs, branche et worktree afin de rendre chaque résultat compréhensible et récupérable.
- **Réclamation sûre :** lorsqu'un Run est destiné à modifier/pousser une même
  ressource qu'un autre Run, la sélection et la réclamation doivent empêcher
  les doublons, y compris entre processus. Ne jamais déduire l'exclusivité
  d'un état seulement local ou d'une déclaration de l'agent.

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
- SQLite/Drizzle, la gestion des Projects, l'initialisation `.tasker/`, les Instructions, les Settings Git/exécution et la tab Agents sont implémentés.
- La tab Agents édite `.tasker/agents/main.toml` et les sous-agents TOML, avec découverte locale des modèles via `codex app-server` / `model/list`.
- La tab Tasks fournit le CRUD versionné `.tasker/tasks/`, les plannings manual/once/hourly/daily/weekly, Run now, la réexécution des Runs échoués, un Sheet live et l’historique. Les Runs en file affichent leur position et les blocages globaux; une terminaison non vérifiée apparaît comme pipeline bloqué lorsqu’un Run attend, ou comme récupération requise lorsqu’il n’y en a aucun. Un Run terminal sans PID connu expose directement deux choix : conserver son travail et débloquer la queue, ou confirmer l’arrêt puis supprimer le Run, son worktree et sa branche en une seule action destructive. Aucune de ces actions ne recrée ni ne relance la Task. Réexécuter reste une action séparée qui crée un nouveau Run depuis la configuration actuelle.
- Le Sheet live est un Run Inspector : `src/components/run-inspector/` normalise les événements JSONL Codex, regroupe le cycle des items et rend une timeline humaine avec détails techniques secondaires. Le protocole supporté et ses limites sont documentés dans `docs/codex-run-events.md`.
- Le scheduler et le worker uniques démarrent côté serveur via `src/instrumentation.ts`. SQLite possède Runs, événements, curseurs et verrou interprocessus ; le worker lance réellement `codex exec` dans un worktree créé depuis la base distante fraîchement fetchée. Ils constituent la transposition UI du timer systemd et du runner unique de la référence Linux.
- Les Settings d’exécution versionnent dans `.tasker/project.toml` le gestionnaire de paquets, l’installation verrouillée optionnelle, les scripts `package.json` de validation et leurs délais. Le worker les exécute hors du sandbox Codex, dans le worktree, avant le commit.
- Le succès exige une préparation réussie lorsqu’activée, une sortie structurée positive, toutes les validations configurées et les contrôles Git ; le worker commit sans push/merge. Les échecs/annulations préservent le worktree. Au redémarrage, le worker vérifie l’arbre de processus enregistré avant de reprendre la queue ; lorsqu’une ancienne terminaison ne peut plus être vérifiée automatiquement, le Sheet exige une confirmation locale explicite avant la reprise. Voir `docs/task-runner-architecture.md` pour les politiques de reprise et de nettoyage.

## Direction d’implémentation

La direction technique du MVP est TypeScript/Node.js, Next.js/React, shadcn/ui, SQLite et Drizzle ORM, avec Git CLI, Codex CLI/app-server et/ou SDK, et GitHub CLI/API seulement lorsque l’intégration GitHub est activée.

L'intégration d'agent doit être spécifique à Codex et refléter sa configuration native. Ne pas créer d'interface `AgentProvider`, de dropdown de fournisseur ou d'architecture anticipant Claude, Gemini ou d'autres agents.

Les premières entités durables sont `Project`, `Reference`, `Task`, `Run` et `RunEvent`. Les paramètres agent et exécution de projet peuvent être surchargés par Task. Conserver dans un Run les horodatages, configuration résolue, worktree, branche, code de sortie, résultat, erreur, commit et URL de PR lorsque pertinents.

## Périmètre MVP

Inclure : projets et détection Git locale, instructions et références de dépôt, création/édition de Tasks, exécution manuelle et récurrente, scheduler interne, queue et concurrence configurable, worktrees temporaires, exécution Codex, journaux live, annulation, validations, commit après succès, push/PR brouillon optionnels, historique des Runs, SQLite et récupération de base après échec. Le comportement cible doit conserver les garanties du runner v3 documenté dans `docs/v1/implantation-v3.md`, en les rendant configurables par Project et Task.

Exclure : service cloud AgentTasker, comptes, équipes, orchestration multi-machine, marketplace/plugins, vector DB/RAG, workflow builder visuel, auto-merge par défaut, nombreux fournisseurs d’agents et application mobile.

## Règles de développement

- Avant toute modification de code Next.js, lire la documentation pertinente dans `node_modules/next/dist/docs/`, car Next.js 16 contient des changements incompatibles avec des conventions plus anciennes.
- Avant de modifier l’exécution Git, les Runs de tâches, la création de branches ou le comportement des worktrees, lire obligatoirement `docs/git-worktree-architecture.md`.
- Avant de modifier Tasks, Runs, scheduler, Codex runner ou worktrees, lire obligatoirement `docs/task-runner-architecture.md`. Le schéma des tâches est documenté dans `docs/task-configuration.md`.
- Avant de modifier le Run Inspector, sa normalisation ou ses renderers, lire obligatoirement `docs/codex-run-events.md` et confronter tout nouveau type aux sources officielles Codex et à des événements réels.
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
2. Ajouter, si souhaité, les overrides de validation par Task et le push/PR brouillon contrôlés.
3. Ajouter la rétention configurable des logs/branches/worktrees.
4. Étendre les références et les sous-agents personnalisés sans abstraction multi-provider.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
