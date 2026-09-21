# Finaliser la configuration de base

Utiliser ce parcours lorsqu'un utilisateur a déjà exécuté `agenttasker init` dans
un dépôt Git et demande à un agent de configurer correctement AgentTasker pour ce
projet. Le résultat attendu est une configuration portable, relisible et utile dès
le premier Run, sans inventer de conventions propres au dépôt.

## Périmètre

Modifier seulement les éléments de configuration globale nécessaires :

- `.tasker/instructions.md` ;
- la table `[execution]` de `.tasker/project.toml`.

Conserver les champs d'identité et `[git]` existants, les agents, les Tasks, les
Sequences et tout contenu utilisateur non concerné. Ne pas créer de Run, ne pas
modifier SQLite, ne pas pousser et ne pas créer de PR.

## Découvrir le dépôt avant d'écrire

1. Lire `AGENTS.md` lorsqu'il existe, puis le README, les manifests de paquet, les
   lockfiles et les documents d'architecture directement pertinents. Relever les
   commandes réellement déclarées, les technologies, les conventions et les
   contraintes de validation.
2. Ne jamais lire de fichier `.env*` réel. Ne pas déduire des secrets, des chemins
   machine ou des variables d'environnement à partir de ces fichiers.
3. Si le dépôt ne fournit pas assez d'éléments fiables pour une instruction ou une
   validation, ne pas la fabriquer. Laisser ce réglage sûr par défaut et signaler
   ce qui doit être précisé par l'utilisateur.

## Rédiger `.tasker/instructions.md`

Écrire des instructions durables qui s'appliquent à toutes les Tasks et à toutes les
étapes de Sequence. Elles doivent permettre à un agent qui arrive dans le worktree
de comprendre le projet sans répéter toute sa documentation.

Inclure, uniquement quand ils sont établis par le dépôt :

- le but du projet et ses principaux répertoires ou frontières d'architecture ;
- les conventions de code, de tests et de documentation qui s'appliquent à tout
  changement ;
- les commandes de qualité configurées et les critères de fin pertinents ;
- l'obligation de lire `AGENTS.md` avant toute modification lorsqu'il existe ;
- les règles locales qui protègent les secrets, les migrations, les données ou les
  opérations Git destructives.

Garder les demandes temporaires, le détail d'une fonctionnalité et les consignes
spécifiques à une étape dans une Task ou une SequenceStep, pas ici. Préférer des
liens ou consignes de lecture vers les documents du dépôt à la duplication de longs
documents. Ne pas écraser des instructions existantes : compléter, corriger ou
réorganiser ce qui est déjà présent seulement lorsque le résultat devient plus
fidèle au dépôt.

## Configurer `[execution]` dans `project.toml`

`validation_scripts` contient exclusivement des noms de scripts déjà présents dans
le manifeste du dépôt. AgentTasker exécutera chacun d'eux comme
`<package_manager> run <script>` dans cet ordre après Codex et avant le commit : ce
ne sont jamais des commandes shell libres.

- Déterminer `package_manager` à partir du champ `packageManager` du manifeste et
  du lockfile. S'ils se contredisent ou si aucun gestionnaire Node n'est utilisé,
  ne pas deviner : conserver la valeur existante et expliquer le blocage.
- Choisir uniquement les validations locales, déterministes et adaptées au premier
  Run. Les scripts de lint, typecheck, test unitaire et build sont de bons candidats
  lorsqu'ils existent et ne nécessitent pas de service externe. Exclure par défaut
  `dev`, `start`, `watch`, `serve`, déploiement, migration, seed, e2e ou intégration
  nécessitant une infrastructure, sauf instruction explicite de l'utilisateur.
- Conserver les délais par défaut lorsque le dépôt ne donne pas de raison concrète
  de les modifier. Les valeurs doivent rester dans les bornes supportées : Run de 1
  à 1440 minutes, installation et validation de 1 à 120 minutes.
- Laisser `install_dependencies = false` par défaut. L'activer seulement si
  l'utilisateur a explicitement autorisé l'exécution des scripts de cycle de vie du
  dépôt et l'accès réseau éventuel dans chaque worktree. Indiquer clairement ce
  choix, car sans installation les validations exigent que les dépendances soient
  déjà disponibles dans le worktree.
- Si le workflow requiert Python, définir `python_min_version` à partir de sa
  compatibilité documentée (par exemple `"3.11"`). Omettre la clé lorsque Python
  est facultatif. Ne jamais écrire un chemin d’interpréteur dans `project.toml` :
  AgentTasker le résout localement pour chaque Run.

Ne pas modifier la table `[git]` dans ce parcours. Ne jamais ajouter une commande,
un secret, un chemin absolu, une variable d'environnement ou de l'état de Run dans
`project.toml`.

## Vérifier et rendre compte

Relire les deux fichiers modifiés. Vérifier que la table `[execution]` est unique,
que chaque script configuré existe réellement et que les instructions ne contiennent
pas de détails inventés ou temporaires. Présenter ensuite les instructions et
validations retenues, ainsi que tout réglage volontairement laissé à sa valeur sûre.
