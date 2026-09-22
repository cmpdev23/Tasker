# Skill de configuration AgentTasker

## Situation actuelle

AgentTasker enregistre la configuration portable d’un projet dans le dossier
versionné `.tasker/` de son dépôt. L’interface permet de gérer cette configuration,
mais un agent travaillant directement dans le dépôt ne disposait pas encore d’un
guide exécutable et distribuable décrivant les schémas réellement implémentés.

## Problème précis

Sans skill canonique, chaque agent doit redécouvrir les formats de `project.toml`,
des Tasks, des Sequences et des agents Codex. Des exemples de roadmap peuvent aussi
être confondus avec le contrat livré. Il manquait enfin un moyen simple de versionner
ce savoir dans AgentTasker, de l’installer dans un autre dépôt, puis de récupérer
une version plus récente depuis Git.

## Situation visée

Le dépôt AgentTasker possède un skill canonique sous
`.agents/skills/agenttasker-project/`. Un dépôt géré peut en conserver une copie
locale au même chemin, la committer, l’invoquer avec `$agenttasker-project`, vérifier
les mises à jour distantes et appliquer explicitement une nouvelle version.

## Source canonique

```text
.agents/skills/agenttasker-project/
├── SKILL.md
├── init.md
├── VERSION
├── agents/openai.yaml
├── references/
└── scripts/
```

Le skill couvre exclusivement la configuration versionnée du dépôt :

- `.tasker/project.toml`, `.tasker/instructions.md` et `.tasker/LESSONS.md`;
- `.tasker/tasks/`;
- `.tasker/sequences/` et leurs SequenceSteps;
- `.tasker/agents/`.

`init.md` est le parcours spécialisé pour le premier réglage d'un dépôt qui vient
d'exécuter `agenttasker init`. Il guide un agent pour établir des instructions
globales fondées sur le dépôt et des validations `[execution]` réellement
disponibles, tout en gardant l'installation des dépendances désactivée tant que
l'utilisateur ne l'a pas explicitement autorisée.
Lorsqu’un workflow nécessite Python, il peut aussi déclarer une version minimale
portable; le skill ne versionne jamais le chemin local de l’interpréteur.

Il ne crée pas l’enregistrement local du Project dans SQLite et ne possède pas les
Runs, la queue, les logs, les worktrees ou les intégrations locales.

## Installer dans un dépôt géré

Le parcours normal est maintenant `agenttasker init`: la CLI initialise `.tasker/`,
installe la copie canonique livrée avec l’application et enregistre le Project
localement. La commande ci-dessous reste utile pour installer uniquement le skill
depuis une copie source d’AgentTasker.

Depuis une copie locale du dépôt AgentTasker, exécuter :

```powershell
node .agents/skills/agenttasker-project/scripts/install-to-repository.mjs --target "C:\chemin\vers\crm"
```

Sur macOS ou Linux, la même commande accepte naturellement un chemin POSIX. Le
dépôt cible doit être un dépôt Git et `--target` doit désigner sa racine. Si une
copie différente existe déjà, le script refuse de l’écraser; `--force` rend ce
remplacement explicite.

Après l’installation, réviser et committer le dossier dans le dépôt cible :

```text
.agents/skills/agenttasker-project/
```

Le skill devient alors disponible aux agents qui découvrent les skills du projet.

## Publier et tirer une nouvelle version

Pour publier une évolution :

1. modifier la source canonique dans AgentTasker;
2. augmenter `VERSION` lorsque le changement est livré;
3. exécuter la validation du skill;
4. committer et pousser le changement dans Git.

Dans le dépôt cible, vérifier ensuite la source distante sans modifier les fichiers :

```powershell
node .agents/skills/agenttasker-project/scripts/update-from-git.mjs
```

Appliquer la version récupérée :

```powershell
node .agents/skills/agenttasker-project/scripts/update-from-git.mjs --apply
```

Le script utilise par défaut `https://github.com/cmpdev23/Tasker.git` et la branche
`main`. Un fork ou une branche de stabilisation peut être choisi avec `--repo` et
`--ref`. Le téléchargement passe par Git et réutilise donc l’authentification Git
locale pour un dépôt privé.

Une mise à jour refuse d’écraser un skill contenant des changements non commités.
`--apply --force` l’autorise explicitement. Git demeure le mécanisme de récupération :
toujours inspecter le diff produit avant de le committer dans le dépôt cible.

## Maintenance

Le schéma applicatif réel demeure la source de vérité. La version 1.7.0 documente
aussi la migration contrôlée de l’historique local vers un checkpoint portable de
Sequence. Lorsqu’une évolution modifie
durablement `.tasker/`, mettre à jour dans la même livraison les références du skill,
sa version et ce document. Le validateur structurel du `skill-creator` vérifie le
paquet, mais les exemples doivent aussi être confrontés aux parseurs et sérialiseurs
du backend AgentTasker.
