# Guide d'implantation — Automatisation du blogue v3

> **Document d'exécution — 16 juillet 2026.** Ce guide implante la conception
> décrite dans `automation-v3.md`. Suivre les phases dans l'ordre; chaque
> phase se termine par une vérification. Ne pas passer à la phase suivante
> tant que la vérification échoue.

Conventions :

- `[PC]` : étape réalisée sur le PC Windows (PowerShell ou Git Bash);
- `[slushville]` : étape réalisée en SSH sur le serveur
  (`ssh slushville@100.72.14.82`);
- les blocs `bash` sont destinés à `slushville`, sauf indication contraire;
- les cases `- [ ]` servent à suivre la progression.

## Vue d'ensemble des phases

| Phase | Où | Objectif | Durée estimée |
| --- | --- | --- | --- |
| 0 | slushville | Vérifier les prérequis | 15 min |
| 1 | slushville + GitHub | Assainir l'héritage de l'incident | 30–60 min |
| 2 | PC (branche Git) | Développer les livrables versionnés | ½–1 jour |
| 3 | slushville | Tester sur un dépôt jetable | ½ jour |
| 4 | slushville | Installer bootstrap, env, unités systemd | 30 min |
| 5 | slushville | Une exécution réelle supervisée | ~1 h |
| 6 | GitHub | Mise en service et surveillance | 1 semaine passive |
| 7 | slushville + dépôt | Décommissionner l'ancien système | 15 min |

Un **rollback** est possible à tout moment (section finale) : le système
n'a aucun état résident — désactiver le timer suffit.

## Décisions arrêtées par ce guide

| Décision | Choix | Raison |
| --- | --- | --- |
| Langage du runner | Python (`automation/scripts/run_blog_task.py`) | Manipulation JSON robuste, pas de dépendance `jq`; remplace le nom `run_blog_task.sh` de la conception |
| Cadence | Horaire (comme conçu) | Le `oneshot` systemd empêche déjà tout chevauchement local |
| Dépendances des worktrees éphémères | `npm ci` à chaque exécution | `package-lock.json` présent; ~1–3 min par run; aucun état partagé |
| Build de vérification | `npm run build` | Seule validation mécanique rejouable du projet |
| Allowlist du diff | créations sous `src/content/blog/**` et `public/images/blog/**` | Emplacements réels des articles et couvertures |
| Dépôt de test | `cmpdev23/cmt-automation-test` (privé, jetable) | `gh` et les push se comportent exactement comme en production |
| Configuration du runner | Variables d'environnement `CMT_*` avec défauts de production | Permet de pointer les tests vers le dépôt jetable sans modifier le code |

## Phase 0 — Prérequis sur slushville

`[slushville]` Vérifier chaque point; corriger avant de continuer.

```bash
codex --version && codex login status        # CLI authentifiée
gh auth status                               # GitHub authentifié
git -C /data/projects/SiteWeb/cmt remote -v  # origin = cmpdev23/cmt
git config --global user.name && git config --global user.email  # identité pour les commits du runner
node --version && npm --version              # build Next.js
python3 --version                            # runner
timeout --version | head -1                  # coreutils
df -h /data                                  # ≥ 5 Go libres (worktree + node_modules par run)
systemctl --user status >/dev/null && echo "session user OK"
```

- [ ] `codex` authentifié
- [ ] `gh` authentifié avec droits push + PR sur `cmpdev23/cmt`
- [ ] identité Git configurée
- [ ] `node`, `npm`, `python3`, `timeout` disponibles
- [ ] espace disque suffisant
- [ ] session systemd user fonctionnelle

> **Note :** si `node` est installé via `nvm`, relever le chemin réel
> (`dirname "$(which node)"`) — il devra figurer dans le `PATH` du fichier
> d'environnement de la phase 4, car un service systemd ne charge pas
> `.bashrc`.

## Phase 1 — Assainir l'héritage de l'incident

### 1.1 Mettre en pause l'automatisation Codex native

`[slushville]`

```bash
sed -i 's/^status = "ACTIVE"/status = "PAUSED"/' \
  ~/.codex/automations/traiter-la-prochaine-t-che-de-blogue/automation.toml
grep '^status' ~/.codex/automations/traiter-la-prochaine-t-che-de-blogue/automation.toml
```

- [ ] `status = "PAUSED"` confirmé (la suppression définitive attend la
      phase 7)

### 1.2 Supprimer le verrou hérité

`[slushville]`

```bash
rm -rf /tmp/cmt-blog-automation.lock
```

- [ ] Le verrou n'existe plus (il n'a aucun rôle dans la v3)

### 1.3 Résoudre la PR #42

L'article de la PR brouillon #42 est terminé, mais le JSON de sa tâche est
resté dans `pending/` (c'est le refus qui a déclenché l'incident).

`[PC ou slushville]`

```bash
gh pr view 42 --repo cmpdev23/cmt
```

Sur la branche de cette PR : mettre `status: completed` + `completedAt`
dans le JSON de la tâche, le déplacer vers `automation/tasks/completed/`
(même nom de fichier), commiter, pousser. Puis décision humaine :

- article satisfaisant → marquer la PR prête et **fusionner**;
- article à refaire → fermer la PR et **supprimer la branche** (la v3 la
  retentera d'elle-même une fois en service).

- [ ] PR #42 fusionnée ou fermée; plus aucune PR de l'ancien système en
      suspens

### 1.4 Réconcilier le registre local

`[slushville]`

```bash
cat /data/projects/SiteWeb/cmt.worktrees/automation/automation/tasks-completed.local.json
```

Pour chaque identifiant listé : vérifier que la PR correspondante est
fusionnée **et** que le JSON de la tâche est dans `completed/` sur `main`.
Corriger les écarts par une petite PR. Ne pas encore supprimer le fichier
(phase 7) — la v3 l'ignore de toute façon.

- [ ] Chaque tâche du registre local est cohérente avec `main`

**Vérification de fin de phase 1 :** aucune automatisation active, aucun
verrou, aucune PR héritée en suspens, file `pending/` cohérente.

## Phase 2 — Développer les livrables versionnés

`[PC]` Créer une branche dédiée depuis `main` à jour :

```powershell
git fetch origin
git switch -c add-blog-automation-v3 origin/main
```

Livrables de la branche :

| Fichier | Action |
| --- | --- |
| `automation/result.schema.json` | créer (§ 2.1) |
| `automation/scripts/run_blog_task.py` | créer (§ 2.2) |
| `automation/tests/stub-codex.sh` | créer (§ 2.3) |
| `automation/prompts/create-blog-article.md` | adapter (§ 2.4) |
| `automation/scripts/claim_next_job.py` | supprimer (§ 2.5) |
| `branch_doc/blog-automation/automation-v3.md` | mettre à jour les références (§ 2.6) |

### 2.1 `automation/result.schema.json`

Contenu exact :

```json
{
  "type": "object",
  "required": ["status", "summary", "modified_files", "validations", "blocking_error"],
  "properties": {
    "status": { "enum": ["SUCCESS", "FAILURE"] },
    "summary": { "type": "string" },
    "modified_files": { "type": "array", "items": { "type": "string" } },
    "validations": { "type": "array", "items": { "type": "string" } },
    "blocking_error": { "type": ["string", "null"] }
  },
  "additionalProperties": false
}
```

- [ ] Fichier créé

### 2.2 `automation/scripts/run_blog_task.py` — contrat d'implémentation

C'est le seul livrable substantiel. L'implémenter (seul ou avec un agent de
code) en respectant ce contrat; **les tests de la phase 3 sont le critère
d'acceptation.**

#### Configuration (variables d'environnement, avec défauts de production)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CMT_REPO` | `/data/projects/SiteWeb/cmt` | Clone principal (base Git) |
| `CMT_GH_REPO` | `cmpdev23/cmt` | Dépôt GitHub pour `gh` |
| `CMT_WORKTREES_DIR` | `/data/projects/SiteWeb/cmt.worktrees` | Parent des worktrees `run-*` |
| `CMT_RUNS_DIR` | `~/cmt-runs` | Journaux par exécution |
| `CMT_CODEX_CMD` | `codex` | Binaire agent (remplacé par le stub en test) |
| `CMT_AGENT_TIMEOUT` | `3h` | Borne du `timeout` interne |
| `CMT_BUILD_CMD` | `npm run build` | Validation mécanique rejouée |
| `CMT_MODEL` | `gpt-5.6-sol` | Modèle de l'agent |
| `CMT_RETENTION_DAYS` | `14` | Purge des RUN_DIR |
| `CMT_RUN_ID`, `CMT_RUN_DIR` | fournis par le bootstrap | Identité de l'exécution |

Constantes : `BRANCH_PREFIX = "add-blog-article-"`,
`ALLOWLIST = ["src/content/blog/", "public/images/blog/"]`,
`MAX_CLAIM_ATTEMPTS = 3`.

#### Codes de sortie

- `0` : exécution normale — y compris « aucune tâche » et « tâche parquée
  proprement en échec »;
- `≠ 0` : erreur mécanique du runner lui-même (systemd marquera le service
  `failed`, visible dans `journalctl`).

#### Étapes (suivre `automation-v3.md`, « Déroulement d'une exécution »)

1. **RUN_DIR** : purger les répertoires de `CMT_RUNS_DIR` plus vieux que
   `CMT_RETENTION_DAYS` jours.
2. **Nettoyage des worktrees** : `git worktree prune`, puis pour chaque
   worktree `run-*` : le supprimer **uniquement** si
   `git status --porcelain` vide **et** upstream présent **et**
   `git rev-list --count @{upstream}..HEAD` = 0; sinon le journaliser sans
   y toucher.
3. **Sélection** : `git -C $CMT_REPO ls-tree --name-only origin/main --
   automation/tasks/pending/`; lire chaque JSON via
   `git show origin/main:<chemin>`; garder `status == "pending"` avec
   `scheduledAt` non vide; calculer le slug depuis `payload.primaryKeyword`
   (minuscules, accents décomposés via `unicodedata` puis supprimés, toute
   séquence hors `[a-z0-9]` remplacée par `-`, sans `-` en tête/queue);
   erreur si deux tâches en attente produisent le même slug; exclure les
   slugs dont la branche existe
   (`git ls-remote --heads origin "add-blog-article-*"`); trier par
   `scheduledAt` puis `createdAt`. Liste vide → journaliser le rapport des
   tâches parquées et sortir `0`.
4. **Réclamation** (au plus `MAX_CLAIM_ATTEMPTS` candidates) :
   `git -C $CMT_REPO worktree add -b add-blog-article-<slug>
   $CMT_WORKTREES_DIR/run-<slug> origin/main`; dans le worktree :
   `git commit --allow-empty -m "chore(automation): claim <task-id> [run
   <run-id>]"`; `git push -u origin add-blog-article-<slug>`. Push rejeté →
   supprimer worktree + branche locale, candidate suivante.
5. **Dépendances** : `npm ci` dans le worktree (log vers le RUN_DIR).
6. **Prompt** : écrire `$CMT_RUN_DIR/prompt.txt` = en-tête avec `subject`,
   `primaryKeyword`, `id` de la tâche + contenu du fichier
   `workflow.promptTemplate` + bloc de contraintes (celui de la conception,
   section « Le prompt généré »).
7. **Agent** :

   ```text
   timeout --signal=TERM --kill-after=5m $CMT_AGENT_TIMEOUT \
   $CMT_CODEX_CMD exec -C $WORKTREE \
     --model $CMT_MODEL \
     -c model_reasoning_effort="xhigh" \
     -c approval_policy="never" \
     -c sandbox_workspace_write.network_access=true \
     --sandbox workspace-write --search --json \
     --output-schema automation/result.schema.json \
     --output-last-message $CMT_RUN_DIR/result.json \
     -   < prompt.txt  > events.jsonl  2> stderr.log
   ```

   Le runner **attend** la fin du processus; conserver le code de sortie
   (124 = tué par `timeout`).
8. **Vérification** — appliquer exactement la table de décision de la
   conception : code de sortie ≠ 0 → échec; `result.json` absent, non-JSON
   ou non conforme au schéma → échec; `status != "SUCCESS"` → échec; diff
   (`git status --porcelain`) vide → échec; toute entrée du diff qui n'est
   pas une **création** (`??` ou `A`) sous l'allowlist → échec;
   `CMT_BUILD_CMD` (log vers RUN_DIR) échoue → échec. Sinon → succès.
   `node_modules/` doit être ignoré par Git — vérifier qu'il n'apparaît pas
   dans le diff.
9. **Finalisation succès** : `git add` des fichiers de l'allowlist, commit
   `feat(blog): add <sujet>`; éditer le JSON de la tâche
   (`status: completed`, `completedAt` ISO 8601, `branch`, `runId`),
   `git mv` vers `automation/tasks/completed/`, commit
   `chore(automation): complete <task-id>`; push; vérifier
   `git rev-list --left-right --count HEAD...@{upstream}` = `0 0`;
   `gh pr create --repo $CMT_GH_REPO --base main --draft` avec le corps
   « succès » ci-dessous (pas de doublon si une PR ouverte existe déjà);
   journaliser l'URL.
10. **Finalisation échec** : si diff non vide → `git add -A` + commit
    `wip(blog): travail partiel <task-id>`; éditer le JSON
    (`status: failed`, `failedAt`, `error`, `branch`, `runId`), `git mv`
    vers `automation/tasks/failed/`, commit
    `chore(automation): fail <task-id>`; push; PR brouillon
    `[NEEDS-ATTENTION] <sujet>` avec le corps « échec » ci-dessous.
11. **Nettoyage final** : `git worktree remove` (tout est poussé). Si le
    push a échoué, laisser le worktree en place et sortir `≠ 0` avec un
    message explicite.

#### Corps de PR — succès

```markdown
## Article généré automatiquement

- **Sujet** : <subject>
- **Mot-clé principal** : <primaryKeyword>
- **Tâche** : `<task-id>` (run `<run-id>`)
- **Fichiers créés** : <liste>
- **Validations rejouées par le runner** : diff conforme à l'allowlist; `npm run build` réussi
- **Résumé de l'agent** : <summary de result.json>

> PR créée par l'automatisation v3. La fusion déplace la tâche hors de la file.
```

#### Corps de PR — échec

```markdown
## ⚠️ Tâche en échec — intervention requise

- **Sujet** : <subject>
- **Tâche** : `<task-id>` (run `<run-id>`)
- **Raison** : <raison déterminée par la vérification>
- **blocking_error de l'agent** : <valeur ou "aucun result.json">
- **Extrait stderr** : <20 dernières lignes>
- **Journaux complets** : `<CMT_RUN_DIR>` sur slushville

> Pour retenter : fermer cette PR et supprimer la branche.
> Pour abandonner : retirer le JSON de la tâche de `pending/` sur `main`.
```

- [ ] Runner implémenté conformément au contrat

### 2.3 `automation/tests/stub-codex.sh`

Simule `codex exec` pour tester le runner sans coût LLM. Contenu exact :

```bash
#!/usr/bin/env bash
# Simule codex exec. STUB_MODE : success (défaut) | failure | invalid |
# junk | silent | hang | crash
set -euo pipefail

WORKTREE="$PWD"; RESULT=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[$i]}" in
    -C) WORKTREE="${args[$((i + 1))]}" ;;
    --output-last-message) RESULT="${args[$((i + 1))]}" ;;
  esac
done
cat >/dev/null || true   # consommer le prompt (stdin)

ts="$(date +%s)"
mdx="$WORKTREE/src/content/blog/hypotheque/article-stub-$ts.mdx"

case "${STUB_MODE:-success}" in
  hang)   sleep 3600 ;;
  crash)  exit 1 ;;
  silent) exit 0 ;;                        # exit 0 mais aucun result.json
  invalid)
    echo "ceci n'est pas du JSON" > "$RESULT" ;;
  failure)
    printf '{"status":"FAILURE","summary":"stub","modified_files":[],"validations":[],"blocking_error":"échec simulé"}' > "$RESULT" ;;
  junk)
    echo "junk" > "$WORKTREE/src/junk-$ts.txt"   # hors allowlist
    printf '{"status":"SUCCESS","summary":"stub junk","modified_files":[],"validations":[],"blocking_error":null}' > "$RESULT" ;;
  success)
    mkdir -p "$(dirname "$mdx")"
    printf -- '---\ntitle: "Article stub"\n---\n\nContenu de test.\n' > "$mdx"
    printf 'stub' > "$WORKTREE/public/images/blog/article-stub-$ts.webp"
    printf '{"status":"SUCCESS","summary":"stub ok","modified_files":["%s"],"validations":["stub"],"blocking_error":null}' "$mdx" > "$RESULT" ;;
esac
```

- [ ] Stub créé et exécutable (`chmod +x`)

### 2.4 Adapter `automation/prompts/create-blog-article.md`

Les sections 1 à 5 (lecture du projet, compréhension de la tâche, skill,
workflow multi-agent, terminer réellement) restent **inchangées**, sauf :

- dans la section 5, remplacer « Ne crée pas de commit Git et ne pousse
  aucune modification, sauf si les instructions du projet l'exigent
  explicitement. » par « **Ne crée jamais de commit Git et ne pousse jamais
  de modification.** »

Remplacer **entièrement** la section 6 (« Résultat final et mise à jour de
la tâche », y compris « En cas de succès » et « En cas d'échec » — c'est la
partie qui a causé l'incident du 15 juillet) par :

```markdown
## 6. Rapport final

Ton dernier message doit être uniquement le résultat structuré exigé par le
schéma fourni au lancement :

- `status` : `SUCCESS` seulement si le workflow complet a été exécuté, que
  l'article est intégré et que toutes les validations obligatoires ont
  réussi; sinon `FAILURE`;
- `summary` : sujet traité, mot-clé principal, chemin du MDX créé;
- `modified_files` : tous les fichiers créés ou modifiés;
- `validations` : les validations exécutées et leur résultat;
- `blocking_error` : `null` en cas de succès; sinon la cause précise.

Interdictions absolues :

- n'exécute aucune commande `git`;
- ne modifie aucun fichier sous `automation/` : la file de tâches est gérée
  par le système qui t'a lancé;
- ne marque jamais la tâche comme terminée toi-même.
```

- [ ] Prompt adapté

### 2.5 Supprimer `automation/scripts/claim_next_job.py`

La sélection vit désormais dans le runner et le registre local disparaît.
Supprimer le fichier (et `automation/scripts/__pycache__/`) pour qu'il ne
reste qu'une seule autorité de sélection. Reprendre au besoin sa logique de
tri (`scheduledAt`, `createdAt`) dans le runner.

- [ ] Script supprimé

### 2.6 Mettre à jour la documentation

Dans `branch_doc/blog-automation/automation-v3.md` : remplacer les mentions
`run_blog_task.sh` par `run_blog_task.py`. Ajouter en tête de
`automation-v2.md` une note « remplacé par automation-v3.md ».

- [ ] Références à jour

### 2.7 Ouvrir la PR

`[PC]` Commiter, pousser `add-blog-automation-v3`, ouvrir la PR vers
`main`. **Ne pas fusionner tout de suite** : la phase 3 teste d'abord cette
branche sur le dépôt jetable; fusionner après les tests (le bootstrap de
production lit `origin/main`).

- [ ] PR ouverte, tests de phase 3 à venir

## Phase 3 — Tests sur dépôt jetable

### 3.1 Préparer l'environnement de test

`[slushville]`

```bash
gh repo create cmpdev23/cmt-automation-test --private

git clone https://github.com/cmpdev23/cmt.git ~/cmt-test
cd ~/cmt-test
git checkout add-blog-automation-v3          # la branche de la phase 2
git remote set-url origin https://github.com/cmpdev23/cmt-automation-test.git
git push -u origin HEAD:refs/heads/main      # les livrables deviennent le main du dépôt de test
```

Créer le fichier d'overrides de test :

```bash
cat > ~/cmt-test-env <<'EOF'
export CMT_REPO="$HOME/cmt-test"
export CMT_GH_REPO="cmpdev23/cmt-automation-test"
export CMT_WORKTREES_DIR="$HOME/cmt-test.worktrees"
export CMT_RUNS_DIR="$HOME/cmt-test-runs"
export CMT_CODEX_CMD="$HOME/cmt-test/automation/tests/stub-codex.sh"
export CMT_BUILD_CMD="true"
export CMT_AGENT_TIMEOUT="30s"
EOF
```

Installer le bootstrap dès maintenant (§ 4.2 — il est paramétré par les
variables `CMT_*`, la production n'utilisera que les défauts). Chaque test
se lance ainsi :

```bash
source ~/cmt-test-env && STUB_MODE=success ~/.local/bin/cmt-blog-runner
```

> `CMT_BUILD_CMD=true` court-circuite le build Next.js (lent) pour les
> tests de logique; le test 5c le réactive en mode échec avec `false`.

- [ ] Dépôt de test opérationnel; les 20 tâches `pending` du dépôt servent
      de données de test

### 3.2 Dérouler les tests d'acceptation

Après chaque test, vérifier les trois états : la file sur `origin/main` du
dépôt de test, les branches sur `origin`, et l'absence d'état local requis.
Nettoyer entre les tests (supprimer branches et worktrees de test au
besoin — sur le dépôt jetable, tout est permis).

| # | Test (conception, § Tests requis) | Procédure | Attendu |
| --- | --- | --- | --- |
| 1 | Sélection | Pousser manuellement une branche `add-blog-article-<slug de la tâche la plus ancienne>`, puis lancer un run `success` | La tâche exclue est sautée; la 2ᵉ plus ancienne est traitée; le rapport signale la tâche parquée |
| 2 | Course | Lancer deux runners en parallèle (`… & … &`) avec `STUB_MODE=success` | Deux tâches différentes traitées (ou un perdant propre); jamais deux branches pour une même tâche |
| 3 | Instance unique | (Reporté en phase 5 — nécessite les unités systemd) | Timer absorbé pendant un run actif |
| 4 | Timeout agent | `STUB_MODE=hang` (borne 30 s) | Exit 124 détecté; JSON → `failed/`; PR `[NEEDS-ATTENTION]`; worktree supprimé |
| 5a | `result.json` invalide | `STUB_MODE=invalid`, puis `silent` | Échec parqué proprement dans les deux cas |
| 5b | Diff hors allowlist | `STUB_MODE=junk` | Échec; le fichier junk est préservé dans le commit `wip` |
| 5c | Build cassé | `STUB_MODE=success` + `CMT_BUILD_CMD=false` | Échec malgré le `SUCCESS` de l'agent |
| 6 | Succès complet | `STUB_MODE=success` | Commits `claim` + `feat` + `chore`; push `0 0`; PR brouillon au bon format; worktree supprimé; JSON dans `completed/` sur la branche |
| 7 | Mort du runner | Lancer un run `hang` puis `kill -9` le processus python | Branche de réclamation seule sur `origin`; le run suivant signale le worktree orphelin et traite une autre tâche |
| 8 | Branche supprimée | Supprimer sur GitHub la branche du test 7 | La tâche redevient sélectionnable au run suivant |
| 9 | PR fusionnée | Fusionner la PR du test 6 | Le JSON quitte `pending/` sur `main`; la tâche n'est plus jamais choisie |
| 10 | Reboot simulé | `rm -rf ~/cmt-test-runs` puis un run normal | Aucun impact : tout l'état se dérive d'`origin` |
| 11 | Bootstrap | Modifier `run_blog_task.py` sur une branche non fusionnée du dépôt de test, relancer | Le comportement ne change pas (seul `origin/main` compte) |

- [ ] Tests 1–2 et 4–11 passés (le 3 attend la phase 5)
- [ ] Corrections éventuelles commitées sur `add-blog-automation-v3` et
      repoussées vers le `main` du dépôt de test, jusqu'à réussite complète

### 3.3 Fusionner les livrables

`[PC]` Quand tous les tests passent : revue de la PR de la phase 2, fusion
dans `main` de `cmpdev23/cmt`. Le bootstrap de production lira ces fichiers
depuis `origin/main`.

- [ ] PR `add-blog-automation-v3` fusionnée

## Phase 4 — Installation sur slushville

### 4.1 Fichier d'environnement

```bash
mkdir -p ~/.config/cmt-blog-automation
nano ~/.config/cmt-blog-automation/env
```

Contenu (syntaxe systemd : `CLÉ=valeur`, sans `export`; adapter le PATH
selon la note de la phase 0) :

```ini
PATH=/home/slushville/.local/bin:/usr/local/bin:/usr/bin:/bin
SERPAPI_API_KEY=<clé réelle>
# NODE_OPTIONS=--max-old-space-size=4096   # si le build manque de mémoire
```

- [ ] Fichier créé; ne contient que le nécessaire

### 4.2 Bootstrap `~/.local/bin/cmt-blog-runner`

Contenu exact (la seule pièce de logique hors Git, volontairement
triviale) :

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO="${CMT_REPO:-/data/projects/SiteWeb/cmt}"
RUNS_DIR="${CMT_RUNS_DIR:-$HOME/cmt-runs}"
RUN_ID="$(date +%Y-%m-%dT%H-%M-%S)-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
RUN_DIR="$RUNS_DIR/$RUN_ID"
mkdir -p "$RUN_DIR"

git -C "$REPO" fetch --prune origin
git -C "$REPO" show origin/main:automation/scripts/run_blog_task.py > "$RUN_DIR/run_blog_task.py"

export CMT_RUN_ID="$RUN_ID" CMT_RUN_DIR="$RUN_DIR"
exec python3 "$RUN_DIR/run_blog_task.py"
```

```bash
chmod +x ~/.local/bin/cmt-blog-runner
```

- [ ] Bootstrap installé et exécutable

### 4.3 Unités systemd

```ini
# ~/.config/systemd/user/cmt-blog-automation.timer
[Unit]
Description=Planificateur des articles CMT

[Timer]
OnCalendar=hourly
Persistent=true
RandomizedDelaySec=2m
Unit=cmt-blog-automation.service

[Install]
WantedBy=timers.target
```

```ini
# ~/.config/systemd/user/cmt-blog-automation.service
[Unit]
Description=Traiter une tâche de blogue CMT
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/home/slushville/.local/bin/cmt-blog-runner
EnvironmentFile=%h/.config/cmt-blog-automation/env
TimeoutStartSec=4h
```

```bash
sudo loginctl enable-linger slushville
systemctl --user daemon-reload
```

- [ ] Unités en place, linger activé
- [ ] **Ne pas activer le timer** — la phase 5 vient d'abord

## Phase 5 — Exécution réelle supervisée

Une vraie exécution complète (vrai `codex`, vrai build, vraie PR sur
`cmpdev23/cmt`), déclenchée à la main et observée.

`[slushville]` Terminal 1 :

```bash
journalctl --user -u cmt-blog-automation.service -f
```

Terminal 2 :

```bash
systemctl --user start cmt-blog-automation.service
```

Pendant le run (30–45 min), profiter du terminal 2 pour le **test 3**
(instance unique) :

```bash
systemctl --user start cmt-blog-automation.service   # doit être absorbé sans effet
```

Checklist après la fin :

- [ ] Journal : sélection → réclamation → `npm ci` → agent → vérification →
      finalisation, sans erreur
- [ ] Une branche `add-blog-article-<slug>` sur `origin` avec exactement
      3 commits (`claim`, `feat`, `chore`)
- [ ] PR brouillon présente et bien formée
      (`gh pr list --repo cmpdev23/cmt --draft`)
- [ ] Diff de la PR : uniquement l'article MDX, la couverture et le
      déplacement du JSON `pending/` → `completed/`; pas de `node_modules`,
      rien d'autre
- [ ] Worktree supprimé (`git -C /data/projects/SiteWeb/cmt worktree list`)
- [ ] `~/cmt-runs/<run-id>/` contient `prompt.txt`, `events.jsonl`,
      `stderr.log`, `result.json`
- [ ] Qualité de l'article vérifiée à la main (c'est aussi un test du
      prompt adapté)

En cas de problème : diagnostiquer via le journal et le RUN_DIR, corriger
(runner → nouvelle PR fusionnée; prompt → idem), supprimer la branche de la
tâche pour la remettre en file, recommencer la phase 5.

## Phase 6 — Mise en service

```bash
systemctl --user enable --now cmt-blog-automation.timer
systemctl --user list-timers
```

- [ ] Timer actif

Surveillance de la première semaine :

| Fréquence | Vérification |
| --- | --- |
| Quotidien | `gh pr list --repo cmpdev23/cmt` — nouvelles PR brouillon; toute PR `[NEEDS-ATTENTION]` |
| Quotidien | Fusionner les PR satisfaisantes (le rythme réel de publication = le rythme de fusion; les tâches avec PR ouverte sont exclues de la sélection, c'est voulu) |
| 2–3 fois | `journalctl --user -u cmt-blog-automation.service -n 100` — erreurs mécaniques |
| Hebdo | Branches `add-blog-article-*` sans PR (parcage muet) : `git ls-remote --heads origin 'add-blog-article-*'` croisé avec `gh pr list --state all` |
| Hebdo | `du -sh ~/cmt-runs` et `git -C /data/projects/SiteWeb/cmt worktree list` — pas d'accumulation |

- [ ] Une semaine de fonctionnement sans intervention mécanique

## Phase 7 — Décommissionner l'ancien système

Seulement après une semaine stable.

`[slushville]`

```bash
# 1. Supprimer l'automatisation Codex native
rm -rf ~/.codex/automations/traiter-la-prochaine-t-che-de-blogue

# 2. Supprimer l'ancien worktree (vérifier qu'il est propre d'abord)
git -C /data/projects/SiteWeb/cmt.worktrees/automation status --porcelain
git -C /data/projects/SiteWeb/cmt worktree remove /data/projects/SiteWeb/cmt.worktrees/automation
git -C /data/projects/SiteWeb/cmt branch -d automation/runner
git ls-remote --heads origin 'automation/*'   # supprimer sur origin si présente

# 3. Le registre local vivait dans l'ancien worktree; vérifier qu'aucune
#    copie ne traîne
find /data/projects/SiteWeb -name 'tasks-completed.local.json'

# 4. Dépôt de test devenu inutile
gh repo delete cmpdev23/cmt-automation-test --yes
rm -rf ~/cmt-test ~/cmt-test.worktrees ~/cmt-test-runs ~/cmt-test-env
```

- [ ] Ancien système entièrement retiré; seul le timer v3 subsiste

## Rollback

À n'importe quel moment, sans autre nettoyage :

```bash
systemctl --user disable --now cmt-blog-automation.timer
```

Le système est inerte : aucun démon, aucun verrou, aucun état résident. La
file, les branches et les PR restent cohérents et lisibles dans GitHub. Une
exécution en cours se termine normalement ou est bornée par
`TimeoutStartSec`; au pire, une tâche est parquée sur sa branche.

## Annexe — commandes de tous les jours

| Besoin | Commande |
| --- | --- |
| Prochain déclenchement | `systemctl --user list-timers` |
| Suivre une exécution en direct | `journalctl --user -u cmt-blog-automation.service -f` |
| Dernier journal | `journalctl --user -u cmt-blog-automation.service -n 200` |
| Lancer une exécution manuelle | `systemctl --user start cmt-blog-automation.service` |
| Mettre en pause / reprendre | `systemctl --user stop cmt-blog-automation.timer` / `start` |
| État de la file | PR et branches `add-blog-article-*` dans GitHub |
| Retenter une tâche | Supprimer sa branche sur GitHub |
| Abandonner une tâche | Retirer son JSON de `pending/` par un commit sur `main` |
| Journaux d'un run | `ls ~/cmt-runs/`, puis le répertoire du run |
