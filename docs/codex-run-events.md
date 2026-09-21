# Événements Codex du Run Inspector

## Situation actuelle

AgentTasker lance Codex en mode non interactif via `codex app-server`. Le stdout
est un flux JSON-RPC JSON Lines, conservé dans `run_events` avec les événements
propres au runner. Un adaptateur traduit les notifications `thread/*`, `turn/*` et
`item/*` vers le contrat historique snake_case du Run Inspector. Celui-ci transforme
le flux en activité lisible tout en gardant les messages bruts accessibles pour le
diagnostic et demeure compatible avec les anciens Runs produits par `codex exec --json`.

## Problème précis

Le protocole JSON-RPC de `codex app-server` est volontairement technique et
évolue avec Codex. Afficher directement ses notifications `item/started`,
`item/completed` et ses deltas oblige l’utilisateur à comprendre le transport,
duplique une même action plusieurs fois et rend les longues exécutions difficiles
à parcourir. Les anciens Runs utilisent en plus le contrat JSONL de
`codex exec --json`; l’interface doit comprendre les deux sans faire dépendre la
persistance d’une version précise du protocole.

## Situation visée

Le Run Inspector doit présenter une timeline sémantique fidèle au flux reçu :
une activité par item, un renderer adapté à son type, un résultat final visible,
et un fallback sûr pour tout événement futur. Les événements originaux restent
consultables dans « Événements Codex bruts » et le moteur d’exécution ne dépend
pas de l’interprétation UI.

## Contrats officiels vérifiés

Le transport actif a été vérifié le **21 septembre 2026** contre la
[documentation officielle de Codex App Server](https://developers.openai.com/codex/app-server/)
et Codex CLI **0.155.0-alpha.9** installé sur la machine de test. AgentTasker
initialise le serveur avec l’API expérimentale, crée un thread et un turn, puis
adapte les notifications JSON-RPC camelCase au contrat interne historique. Les
profils de permissions nommés utilisés pour exposer Python en lecture seule sont
sélectionnés sur `thread/start` et `turn/start`; le préflight utilise
`command/exec` avec le même profil.

Le contrat historique ci-dessous reste nécessaire pour lire les anciens Runs et
constitue le format normalisé actuellement consommé par le Run Inspector.

Vérification historique effectuée le **10 septembre 2026** contre la documentation OpenAI,
la branche `main` du dépôt officiel `openai/codex`, et Codex CLI **0.153.4**
installé sur la machine de test.

La [documentation du mode non interactif](https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable)
définit `--json` comme un flux JSONL sur stdout. Le contrat top-level de
[l’implémentation Rust](https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs)
et des [types d’événements du SDK TypeScript](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts)
est le suivant :

| Événement | Rôle | Champs utiles |
| --- | --- | --- |
| `thread.started` | Première notification d’une session | `thread_id` |
| `turn.started` | Début du traitement du prompt | aucun champ obligatoire additionnel |
| `item.started` | Création d’un item, généralement en cours | `item` |
| `item.updated` | Mise à jour incrémentale d’un item | `item` |
| `item.completed` | État terminal d’un item | `item` |
| `turn.completed` | Fin normale du tour | `usage` |
| `turn.failed` | Échec du tour | `error.message` |
| `error` | Erreur irrécupérable du flux | `message` |

`turn.completed.usage` expose actuellement `input_tokens`,
`cached_input_tokens`, `cache_write_input_tokens`, `output_tokens` et
`reasoning_output_tokens`.

### Types d’items

Le schéma de référence est la somme des
[items du SDK TypeScript](https://github.com/openai/codex/blob/main/sdk/typescript/src/items.ts)
et du schéma Rust plus récent :

| `item.type` | Données principales | Cycle observé | Renderer AgentTasker |
| --- | --- | --- | --- |
| `agent_message` | `text` | surtout `completed` | `AgentMessageEvent` |
| `reasoning` | résumé `text` | surtout `completed` | `ReasoningEvent` |
| `command_execution` | `command`, `aggregated_output`, `exit_code`, `status` | `started` → `completed` | `CommandEvent` |
| `file_change` | `changes[].path`, `changes[].kind`, `status` | `started` → `completed` avec CLI 0.153.4 | `FileChangeEvent` |
| `mcp_tool_call` | `server`, `tool`, `arguments`, `result`, `error`, `status` | `started` → `completed` | `ToolEvent` |
| `web_search` | `query`, `action` | `started` → `completed` | `ToolEvent` |
| `todo_list` | `items[].text`, `items[].completed` | `started` → `updated` → `completed` | `TodoEvent` |
| `error` | `message` | non fatal au niveau item | `ErrorEvent` |
| `collab_tool_call` | `tool`, threads émetteur/récepteurs, `prompt`, `agents_states`, `status` | `started` → `completed` lorsque disponible | `SubagentEvent` |

Les changements de fichiers utilisent les kinds `add`, `update` et `delete`.
Les statuts de commande et d’appel MCP sont `in_progress`, `completed` ou
`failed`. Le Run Inspector accepte toutefois des valeurs inconnues afin de ne
pas casser lorsqu’un statut est ajouté.

### Sous-agents et divergence du SDK

`collab_tool_call` est défini dans le schéma Rust officiel et traité par le
[processeur JSONL officiel](https://github.com/openai/codex/blob/main/codex-rs/exec/src/event_processor_with_jsonl_output.rs).
Les actions connues sont `spawn_agent`, `send_input`, `resume_agent`, `wait` et
`close_agent`. `agents_states` peut fournir `pending_init`, `running`,
`interrupted`, `completed`, `errored`, `shutdown` ou `not_found` par thread.

Au jour de la vérification, l’union `ThreadItem` du SDK TypeScript ne contient
pas encore `collab_tool_call`, alors que le runtime l’émet. Le dépôt officiel
suit ce décalage dans [l’issue #28318](https://github.com/openai/codex/issues/28318).
De plus, le flux `exec --json` peut omettre certains événements de spawn selon
la version et le mode multi-agent, limitation suivie dans
[l’issue #41590](https://github.com/openai/codex/issues/41590). AgentTasker rend
donc les sous-agents seulement quand le JSONL les expose et ne prétend pas
reconstituer les enfants absents du flux.

## Événements réellement observés dans AgentTasker

Le Run réel `960a7b2f…b809`, exécuté avec Codex CLI 0.153.4, contenait 261 lignes
persistées : 120 événements Codex normalisés, 122 fragments stdout bruts, 14
diagnostics stderr, quatre changements de statut AgentTasker et un événement de
processus. Les 120 événements Codex se répartissaient ainsi :

| Type | Nombre |
| --- | ---: |
| `reasoning` terminé | 43 |
| `command_execution` | 18 démarrés + 18 terminés |
| `agent_message` terminé | 11 |
| `mcp_tool_call` | 4 démarrés + 4 terminés |
| `web_search` | 4 démarrés + 4 terminés |
| `file_change` | 3 démarrés + 3 terminés |
| `collab_tool_call` | 3 démarrés + 2 terminés |
| `thread.started`, `turn.started`, `turn.completed` | 1 chacun |

Ce Run a confirmé plusieurs réalités que l’interface doit préserver :

- un `agent_message.text` peut être une chaîne JSON structurée contenant
  `status`, `summary` et `blocking_error` plutôt qu’un simple paragraphe;
- les chemins `file_change` peuvent être absolus dans le worktree;
- un appel MCP en échec contient une erreur sémantique exploitable, tandis que
  stderr contient souvent un diagnostic dupliqué ou non bloquant;
- un `collab_tool_call` commencé peut ne jamais recevoir de terminal;
- stdout contient les mêmes objets JSONL déjà persistés comme événements
  `codex`; il doit rester brut et ne pas doubler l’activité principale;
- `turn.completed` n’implique pas que le Run AgentTasker réussit : le résultat
  structuré, Git et les validations restent autoritaires.

Un second Run réel de smoke test, `cbad1447…e449`, a ensuite parcouru
`QUEUED → RUNNING → VALIDATING → SUCCESS` avec 47 événements persistés. Il a
confirmé le rendu live pendant l’exécution, le résumé final, la création du
commit dans le worktree et l’absence de modification du checkout principal.

## Normalisation AgentTasker

La chaîne de présentation est :

```text
RunEvent SQLite
  → décodage prudent du payload Codex
  → regroupement par item.id
  → NormalizedRunActivity
  → EventRenderer spécialisé
```

`src/components/run-inspector/event-normalizer.ts` applique les règles suivantes :

1. `item.started`, `item.updated` et `item.completed` portant le même `item.id`
   deviennent une seule activité stable dans la timeline.
2. L’horodatage du début est conservé; l’horodatage terminal permet de calculer
   une durée sans modifier la persistance.
3. Un message agent structuré affiche son `summary`; l’enveloppe JSON reste
   disponible dans les événements bruts.
4. Un chemin de fichier situé sous le worktree courant devient relatif au dépôt.
5. stdout, stderr et le PID ne sont pas injectés dans l’activité humaine. Les
   erreurs sémantiques Codex et l’erreur finale du Run restent visibles.
6. Un item encore `in_progress` quand le Run devient terminal est présenté comme
   interrompu plutôt que comme toujours actif.
7. Le résultat final et l’erreur du Run proviennent du modèle `Run`, jamais d’une
   simple déclaration de succès intermédiaire de l’agent.

La normalisation complète est mémoïsée par le composant. Le panneau brut ne rend
ses lignes que lorsqu’il est ouvert, ce qui évite de monter des centaines de
blocs JSON pendant le suivi normal. Cette approche reste linéaire et adaptée aux
Runs de 100 à 1 000+ événements sans introduire une couche de virtualisation
prématurée.

## Commandes gérées par AgentTasker

La section « Installation et validations du projet » utilise les événements du
runner, indépendamment du protocole Codex. Les événements `preparation` et
`validation` conservent leur message lisible et ajoutent un `rawPayload` avec
`kind: "project-command"`, `phase`, `command`, `status`, `exitCode`, `durationMs`
et `error`. Les états sont `running`, `success`, `failed`, `cancelled`, `timed-out`.
Aucune valeur d’environnement n’est incluse dans ces rapports.

Les fragments stdout/stderr préfixés par la phase sont rattachés à la commande
active, avec un extrait des 12 000 derniers caractères dans l’UI et les logs complets
toujours disponibles. L’échec ouvre cet extrait directement. Les anciens événements
`Starting`/`Completed` sont également lus; leur code d’échec peut être retrouvé dans
l’erreur finale exacte du runner. Un résultat absent reste non confirmé. Le libellé
« Code de sortie Codex » et le résumé distinguent un agent terminé avec code zéro
d’une validation indépendante échouée. Aucun nouveau type Codex n’est supposé.

## Fallback et compatibilité future

Tout événement top-level ou `item.type` inconnu produit un `FallbackEvent` avec
un résumé disponible et une divulgation « Données brutes ». Le parser utilise
des gardes runtime et n’exige jamais qu’un payload corresponde exactement à
l’union TypeScript connue. Une évolution additive de Codex demeure donc visible
et ne casse pas le Sheet; un renderer spécialisé peut être ajouté ensuite en
s’appuyant sur des événements réellement observés.

## Sources officielles

1. OpenAI, [Codex App Server](https://developers.openai.com/codex/app-server/), protocole JSON-RPC et permissions, consulté le 21 septembre 2026.
2. OpenAI, [Mode non interactif de Codex](https://learn.chatgpt.com/docs/non-interactive-mode#make-output-machine-readable), consulté le 10 septembre 2026.
3. OpenAI, [`codex-rs/exec/src/exec_events.rs`](https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs), schéma Rust autoritaire de `exec --json`, consulté le 10 septembre 2026.
4. OpenAI, [`sdk/typescript/src/events.ts`](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts), types top-level du SDK, consulté le 10 septembre 2026.
5. OpenAI, [`sdk/typescript/src/items.ts`](https://github.com/openai/codex/blob/main/sdk/typescript/src/items.ts), types d’items du SDK, consulté le 10 septembre 2026.
6. OpenAI, [`event_processor_with_jsonl_output.rs`](https://github.com/openai/codex/blob/main/codex-rs/exec/src/event_processor_with_jsonl_output.rs), conversion des notifications en JSONL, consulté le 10 septembre 2026.
7. OpenAI, [`event_processor_with_json_output.rs`](https://github.com/openai/codex/blob/main/codex-rs/exec/tests/event_processor_with_json_output.rs), tests officiels des événements JSON, consulté le 10 septembre 2026.
