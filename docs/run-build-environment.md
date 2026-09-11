# Isolation de l’environnement des validations

## Situation actuelle

AgentTasker prépare les dépendances, exécute Codex puis lance les scripts de
validation dans un worktree. Le Run `b87c5b31-fc81-492a-9f43-0317b68062af` du
11 septembre 2026 avait produit un article et une couverture, avec une sortie Codex
structurée `SUCCESS` et un code de sortie 0. Le build du projet a ensuite échoué.

## Problème précis

Le sous-processus npm héritait de `process.env` du serveur AgentTasker lancé avec
`next dev`. `NODE_ENV=development` empêchait le `next build` du projet de choisir son
mode production. Les logs montrent successivement un avertissement de mode
incompatible, une compilation et un contrôle TypeScript réussis, puis un échec de
prérendu de `/_global-error` : `Cannot read properties of null (reading 'useContext')`.
Le code 0 présenté dans les détails concernait Codex; celui du build était 1.

La [documentation Next.js](https://nextjs.org/docs/messages/non-standard-node-env)
décrit les risques d’un mode incompatible. La CLI installée conserve un `NODE_ENV`
déjà défini au lieu de le remplacer. Le diagnostic a été confirmé en réexécutant
uniquement le build sur le worktree original, avec le même mode hérité : échec
avant correction, succès après correction. L’article et sa couverture restent
préservés; le Run historique garde fidèlement son statut d’échec initial.

## Situation visée

Les commandes des dépôts choisissent leur environnement indépendamment du mode du
serveur AgentTasker. L’interface expose l’étape exacte et son code de sortie, afin
qu’un résultat Codex positif ne soit pas confondu avec un Run validé et commité.

## Décisions livrées

- Retirer de la copie d’environnement des commandes gérées `NODE_ENV`, `NEXT_RUNTIME`,
  `TURBOPACK` et les marqueurs `__NEXT_*`. Le serveur lui-même n’est pas modifié.
- Ne pas forcer `production` pour toute validation : les outils de tests et les
  scripts personnalisés doivent choisir leur mode. L’installation ne doit pas
  omettre ses dépendances de développement à cause du mode du serveur.
- Conserver les autres variables existantes, dont les variables publiques du
  projet, l’authentification Git et les options Node. Ne lire ni copier aucun
  fichier de secrets pour cette correction.
- Persister le résultat de chaque commande et rendre ses sorties dans le Run
  Inspector, y compris sur les anciens Runs. Ne pas accepter une validation en
  échec ni transformer un ancien Run en succès lors du diagnostic.
- Aucune modification des réglages modèle, reasoning, sandbox, réseau,
  approbations ou délais n’est nécessaire pour résoudre cet incident.

## Vérifications

- Reproduction réelle du build original : code 1 avec l’ancien environnement,
  code 0 avec le correctif, même HEAD et mêmes fichiers Git en attente.
- Tests des sous-processus sous des hôtes `development`, `production` et `test` :
  retrait des marqueurs du serveur, préservation des autres variables et absence
  de mutation du parent.
- Pipeline réel sur dépôt/base jetables avec Codex simulé : queue, worktree,
  `npm ci`, validation, commit. Une validation volontairement en échec conserve le
  travail et interdit le commit ainsi que les validations suivantes.
- Tests des rapports UI : historique réel représentatif, états live, code non
  nul, délai, annulation, résultat absent et sorties volumineuses.
- Inspection du Run historique dans un navigateur sur ordinateur et mobile :
  résultat Codex distinct du build, sortie d’erreur visible, aucun débordement
  horizontal ni erreur JavaScript. Utiliser `localhost:5000` pour le serveur de
  développement; Next.js bloque les ressources de développement sur une origine
  alternative non autorisée telle que `127.0.0.1`.
- Suite complète : 84 tests réussis, un test de symlink ignoré sous Windows;
  TypeScript, ESLint et build de production réussis. Le build conserve un
  avertissement Turbopack préexistant sur le traçage des chemins de nettoyage Git.

Les rapports locaux sont dans `.test-artifacts/`, déjà ignoré par Git. Aucun
code mort n’a été introduit. Les fichiers de secrets absents d’un worktree ou un
script qui définit explicitement un mauvais mode peuvent toujours nécessiter une
configuration propre au projet; ils ne sont pas la cause de cet incident.
