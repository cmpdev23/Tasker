# Diagnostic — runtime Python Windows des Runs AgentTasker

## Situation actuelle

Le poste de l’utilisateur possède une installation Python fonctionnelle dans sa
session Windows `mrvco` :

- `python --version` et `py -3 --version` retournent Python 3.12.3 ;
- l’interpréteur est situé dans
  `C:\Users\mrvco\AppData\Local\Programs\Python\Python312\python.exe` ;
- le launcher Windows détecte aussi Python 3.10.

Le code AgentTasker prépare désormais un diagnostic au démarrage des Runs et
tente, sous Windows, `py -<version>`, `py -3`, `python` et `python3`. Lorsqu’un
interpréteur compatible est résolu, son dossier est préfixé au `PATH` transmis à
Codex et aux commandes gérées du worktree. La configuration portable
`[execution].python_min_version` peut exiger une version minimale telle que
`"3.11"` sans versionner de chemin machine.

Le diagnostic exécuté depuis l’environnement de développement Codex ne représente
pas la session `mrvco` : il s’exécute sous `vincent\CodexSandboxOffline`, avec le
profil `C:\Users\CodexSandboxOffline`. Dans ce contexte, le `PATH` ne contient pas
Python 3.12, `py -3` ne trouve aucun interpréteur et Windows refuse l’exécution du
binaire placé dans le profil `mrvco`. Aucun serveur AgentTasker n’écoutait sur le
port 5000 au moment du contrôle ; l’identité du processus qui avait produit le
Run initial reste donc à confirmer.

## Problème précis

La présence de `py.exe` ne prouve pas qu’un processus donné peut lancer Python.
Le launcher, le `PATH`, les enregistrements d’installation et les permissions
d’accès peuvent différer selon le compte Windows qui exécute AgentTasker. Un
diagnostic lancé depuis un sandbox ou un service peut donc signaler « No installed
Python found! » alors que Python fonctionne parfaitement dans le terminal
interactif de l’utilisateur.

Sans connaître l’identité et l’environnement du processus serveur qui possède le
worker, il est impossible d’attribuer le message du Run à une absence d’installation
Python plutôt qu’à une différence de compte, de `PATH` ou d’ACL. Un chemin absolu
du profil utilisateur ne résout pas non plus une exécution sous un autre compte si
celui-ci ne peut pas lire ou lancer ce fichier.

## Situation visée

Chaque Run doit diagnostiquer le même environnement que celui qui lancera Codex :

1. le préflight Settings affiche les interpréteurs détectés, leurs versions et
   leurs chemins, sans afficher de variables sensibles ;
2. l’inspecteur du Run conserve les commandes tentées et l’interpréteur réellement
   retenu ;
3. un projet qui déclare `python_min_version = "3.11"` échoue tôt avec un message
   actionnable si aucun runtime compatible n’est accessible au worker ;
4. le runtime résolu est disponible de façon identique dans Codex, les scripts de
   préparation et les validations du worktree ;
5. l’utilisateur peut distinguer clairement une installation Python absente d’un
   problème d’identité Windows, de `PATH` ou de permissions.

## Vérification à effectuer sur le poste

1. Démarrer AgentTasker depuis la session Windows `mrvco`.
2. Ouvrir **Settings → Execution** et vérifier que le préflight affiche Python
   3.12 et son chemin attendu.
3. Configurer `python_min_version = "3.11"` pour le projet éditorial.
4. Lancer un Run puis vérifier son événement `runtime` et ses détails d’exécution.
5. Si le préflight ne détecte pas Python, identifier le propriétaire du processus
   Node/AgentTasker et comparer son profil et son `PATH` à ceux de `mrvco`.

## Décision à prendre si le worker n’est pas `mrvco`

Privilégier l’exécution locale d’AgentTasker sous le compte utilisateur qui possède
Python. Une installation Python accessible à tous les utilisateurs est une autre
option. Un éventuel chemin Python explicite doit être une préférence locale
persistée hors de `.tasker/project.toml`, validée avant exécution et jamais
versionnée dans Git ; il ne doit pas contourner les permissions Windows.
