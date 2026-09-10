# Codex Agent Configuration

## Situation actuelle

AgentTasker configure exclusivement OpenAI Codex. La tab `Agents` édite une
configuration portable et versionnée dans le dépôt géré, tandis que la liste
des modèles disponibles est découverte depuis l'installation locale de Codex.

## Problème précis

Les clés et valeurs de `config.toml` évoluent rapidement. Une liste de modèles
figée ou des enums copiés depuis d'anciens exemples rendraient l'interface
incorrecte. Les sous-agents ont également leur propre mécanisme natif : des
fichiers TOML autonomes, et non des entrées d'un système générique de
providers.

## Situation visée

L'interface doit employer les noms et valeurs de configuration natifs de Codex,
stocker les fichiers source sous `.tasker/agents/`, et permettre au futur
runner de les appliquer à Codex sans couche de traduction inutile. AgentTasker
ne crée pas d'abstraction multi-provider et ne propose pas Claude, Gemini ou un
autre fournisseur.

## Sources de référence

Vérification effectuée le 10 septembre 2026 à partir de :

- [référence officielle `config.toml`](https://learn.chatgpt.com/docs/config-file/config-reference);
- [documentation officielle des sous-agents](https://learn.chatgpt.com/docs/agent-configuration/subagents);
- [protocole officiel Codex app-server](https://learn.chatgpt.com/docs/app-server);
- [schéma officiel du dépôt `openai/codex`](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json).

Les valeurs exposées par l'interface sont :

| Clé | Valeurs |
| --- | --- |
| `model_reasoning_effort` | `minimal`, `low`, `medium`, `high`, `xhigh` |
| `model_reasoning_summary` | `auto`, `concise`, `detailed`, `none` |
| `model_verbosity` | `low`, `medium`, `high` |
| `sandbox_mode` | `read-only`, `workspace-write`, `danger-full-access` |
| `approval_policy` | `on-request`, `never` |

`approval_policy = "untrusted"` n'est plus supporté et `on-failure` est
déprécié. La forme granulaire de `approval_policy` existe dans Codex, mais la
première interface AgentTasker expose seulement les deux politiques simples et
stables ci-dessus.

Le réseau du sandbox `workspace-write` utilise la clé native :

```toml
[sandbox_workspace_write]
network_access = true
```

## Découverte locale des modèles

AgentTasker appelle le protocole officiel `codex app-server`, effectue la
séquence `initialize` / `initialized`, puis utilise `model/list`. La réponse
fournit notamment les modèles visibles, leur effort par défaut et leurs efforts
supportés. Les résultats sont mis en cache brièvement dans le processus.

Si le CLI ou app-server est indisponible, le champ `model` reste un champ texte
libre. Il n'existe donc aucune liste statique de modèles à maintenir.

## Persistance

```text
.tasker/
└── agents/
    ├── main.toml
    ├── reviewer.toml
    └── explorer-docs.toml
```

`main.toml` contient les défauts de l'agent principal et la table native
`[agents]` :

```toml
model_reasoning_effort = "high"
model_reasoning_summary = "auto"
model_verbosity = "medium"
sandbox_mode = "workspace-write"
approval_policy = "never"

[sandbox_workspace_write]
network_access = false

[agents]
enabled = true
interrupt_message = true
```

Chaque autre fichier TOML correspond à un sous-agent personnalisé. Les champs
natifs obligatoires sont `name`, `description` et `developer_instructions`.
`model`, `model_reasoning_effort` et `sandbox_mode` sont des surcharges
optionnelles; lorsqu'elles sont absentes, Codex applique ses règles d'héritage.

Les fichiers restent sous `.tasker/agents/` parce qu'ils sont la configuration
portable d'AgentTasker. Le futur runner devra les fournir à Codex comme
configuration de projet équivalente aux fichiers `.codex/agents/*.toml`.
