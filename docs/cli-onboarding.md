# Initialisation d’un dépôt avec la CLI AgentTasker

## Situation actuelle

AgentTasker possède une configuration portable sous `.tasker/` et conserve les
chemins locaux ainsi que l’historique des Runs dans SQLite. Avant cette livraison,
l’utilisateur devait d’abord créer un Project dans l’interface, sélectionner son
dépôt, puis lancer l’initialisation depuis Settings.

## Problème précis

La configuration ne pouvait pas être amorcée naturellement depuis le dépôt. Créer
manuellement un dossier `.tasker/` ne produisait ni sa structure complète, ni le
skill AgentTasker, ni l’enregistrement local nécessaire pour afficher le Project
dans l’application.

## Situation visée

La commande `agenttasker init`, exécutée dans un dépôt Git, propose le nom du
dossier et la branche détectée, initialise la configuration sans écraser le contenu
existant, installe le skill livré avec AgentTasker, ignore les logs et dépose une
demande d’enregistrement que l’application importe à son prochain chargement.

## Utilisation

Une distribution desktop doit exposer `bin/agenttasker.mjs` dans le `PATH` sous le
nom `agenttasker`. Depuis le dépôt source AgentTasker, le même parcours peut être
testé sans installation globale :

```powershell
C:\chemin\vers\AgentTasker\agenttasker.cmd init C:\Dev\crm
```

Depuis le dépôt cible, une commande AgentTasker déjà exposée dans le `PATH` se
résume à `agenttasker init`. L’appel portable direct
`node C:\chemin\vers\AgentTasker\bin\agenttasker.mjs init C:\Dev\crm` produit le
même résultat.

Le mode interactif demande le nom, la branche de base, l’installation du skill et
une confirmation finale. Pour une automatisation sans prompt :

```powershell
node bin/agenttasker.mjs init C:\Dev\crm --yes --name "CRM"
```

Options principales :

- `--base-branch <branche>` remplace la détection Git;
- `--no-skill` conserve le dépôt sans copie locale du skill;
- `--force-skill` autorise explicitement le remplacement d’un skill différent;
- `--no-register` initialise seulement les fichiers versionnés;
- `--yes` accepte les valeurs sûres proposées.

## Fichiers créés

```text
.tasker/
├── project.toml
├── instructions.md
├── agents/
│   └── main.toml
├── tasks/
└── sequences/

.agents/skills/agenttasker-project/
```

`instructions.md` contient seulement son titre initial. La CLI détecte le
gestionnaire de paquets à partir des lockfiles, mais laisse l’installation des
dépendances, le push et la création de PR désactivés.

La règle suivante est ajoutée au `.gitignore` racine :

```gitignore
/.tasker/logs/
```

Le reste de `.tasker/` et le skill demeurent versionnés.

## Enregistrement local

La CLI n’écrit jamais directement dans SQLite. Elle crée une demande JSON atomique
et idempotente dans :

- `%LOCALAPPDATA%\AgentTasker\project-registrations` sous Windows;
- `~/Library/Application Support/AgentTasker/project-registrations` sous macOS;
- `$XDG_DATA_HOME/agenttasker/project-registrations`, ou
  `~/.local/share/agenttasker/project-registrations`, sous Linux.

Au chargement de la liste des Projects, AgentTasker réclame chaque demande,
revalide le chemin et lit le nom ainsi que la branche depuis
`.tasker/project.toml`, puis crée l’entrée SQLite. Une nouvelle demande pour un
Project existant ne crée pas de doublon; elle réactive un Project archivé.

Cette boîte de réception constitue un protocole local stable entre la CLI et
l’application. Elle permet à la commande de fonctionner lorsque l’application est
fermée sans lier la CLI aux migrations internes de SQLite.

## Idempotence et sécurité

- La commande exige un dépôt Git et travaille toujours depuis sa racine réelle.
- Les fichiers et dossiers existants sont conservés.
- Les liens symboliques sur les cibles écrites sont refusés.
- Un skill différent n’est remplacé qu’avec `--force-skill`.
- Aucun secret, chemin absolu ou état de Run n’est écrit dans `.tasker/`.
- La demande locale contient le chemin absolu, mais elle demeure hors du dépôt.
