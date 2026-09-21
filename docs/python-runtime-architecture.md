# Architecture du runtime Python

## Situation actuelle

AgentTasker exécute les Runs depuis un worker Node local et lance Codex avec
`codex app-server`. Les projets peuvent déclarer une version minimale portable
avec `[execution].python_min_version` dans `.tasker/project.toml`. Le worker
détecte Python avant chaque Run et partage le runtime résolu avec Codex, les
commandes d’installation et les validations.

## Problème précis

Sous Windows, `py.exe`, le `PATH`, les installations par utilisateur et les ACL
peuvent différer entre la session interactive, AgentTasker et le compte restreint
du sandbox Codex. Détecter Python sur l’hôte ne garantit donc pas que Codex puisse
lire et exécuter le même interpréteur. Versionner un chemin absolu dans le dépôt
rendrait par ailleurs la configuration non portable et pourrait révéler un nom de
profil local.

## Situation visée

La configuration portable ne contient qu’une version minimale. L’utilisateur
peut conserver la détection automatique recommandée ou choisir localement un
exécutable Python précis. AgentTasker valide ce chemin, vérifie son exécution dans
le sandbox Codex, accorde uniquement la lecture des répertoires nécessaires au
runtime et conserve le diagnostic dans la configuration résolue du Run.

## Décision livrée

### Configuration portable

`.tasker/project.toml` accepte seulement une exigence indépendante de la machine :

```toml
[execution]
python_min_version = "3.11"
```

Une valeur absente rend Python optionnel. Lorsqu’une version est exigée et
qu’aucun interpréteur compatible n’est accessible, le Run échoue pendant la
préparation avec un message actionnable.

### Préférence locale

Settings → Execution propose deux modes :

- détection automatique, recommandée;
- interpréteur local spécifique, sélectionnable avec le navigateur de fichiers.

Le chemin choisi est validé comme fichier absolu exécutable, résolu vers son
chemin réel, puis enregistré dans la table SQLite
`project_runtime_preferences`. Il n’est jamais écrit dans `.tasker`, dans Git ou
dans une variable d’environnement versionnée.

### Résolution du runtime

En mode automatique, les candidats sont essayés dans cet ordre :

- Windows : `py -<version>`, `py -3`, `python`, puis `python3`;
- macOS/Linux : `python`, puis `python3`.

Le probe recueille `sys.executable`, la version, `sys.prefix` et
`sys.base_prefix`. Pour une préférence explicite, seul l’exécutable choisi est
essayé. Le dossier de l’interpréteur est préfixé au `PATH`; `PYTHON` pointe vers
l’exécutable exact et `PYTHONDONTWRITEBYTECODE=1` évite d’écrire des caches dans
les répertoires du runtime.

### Accès du sandbox Codex

AgentTasker utilise un profil de permissions Codex éphémère et nommé pour les
Runs qui nécessitent des racines Python additionnelles. Le profil hérite du
sandbox normal du Run et ajoute en lecture seule les chemins déduits de
`sys.prefix` et `sys.base_prefix`. Il n’accorde jamais la racine du disque ni le
dossier utilisateur complet. Le worktree demeure la seule racine de travail en
écriture; le répertoire Git commun d’un worktree est ajouté en lecture seule
quand nécessaire.

Avant l’enregistrement des Settings et lors de leur chargement, AgentTasker lance
un préflight `command/exec` dans Codex App Server avec exactement le profil qui
sera utilisé par le Run. L’interface distingue ainsi :

- Python absent ou incompatible sur l’hôte;
- chemin explicite invalide;
- runtime visible sur l’hôte mais bloqué dans le sandbox;
- runtime exécutable avec accès en lecture seule.

Les demandes d’approbation interactives restent refusées pendant un Run autonome.
Le réglage `danger-full-access` conserve son comportement explicite, mais n’est
pas requis pour rendre Python disponible.

### Traçabilité

La configuration résolue d’un Run conserve la source du runtime, son chemin, sa
version, ses racines lisibles et le résultat du préflight. Les événements du Run
Inspector continuent d’utiliser le contrat normalisé existant : un adaptateur
convertit les notifications JSON-RPC de Codex App Server sans casser les Runs
historiques produits par `codex exec --json`.

## Garanties de sécurité et de portabilité

- aucun chemin Python absolu n’est versionné;
- aucun secret ou contenu de fichier d’environnement n’est lu;
- le sandbox reçoit des chemins exacts en lecture seule, pas un accès global au
  profil utilisateur;
- l’interpréteur est validé avant la sauvegarde et de nouveau résolu à chaque Run;
- Tasks et Sequences utilisent le même mécanisme;
- les validations gérées et Codex héritent du même environnement Python résolu.

## Limites connues

Les profils de permissions nommés dépendent de l’API expérimentale de Codex App
Server disponible dans la version de Codex prise en charge par AgentTasker. Un
changement de protocole doit être traité dans l’adaptateur App Server et vérifié
contre les types générés de la version installée. AgentTasker ne contourne jamais
une ACL Windows qui interdit au compte restreint de lire ou d’exécuter Python.
En particulier, certaines installations Python propres à un utilisateur sous
`AppData` restent non exécutables par le compte sandbox malgré le profil de
lecture. Le préflight le signale explicitement; la correction recommandée est une
installation Python système lisible par les utilisateurs locaux. Le mode
`danger-full-access` contourne l’isolation et ne constitue pas la valeur par défaut.
