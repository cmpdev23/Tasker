# Chargement et mutations de l’interface

## Situation actuelle

Les modules Tasks, Sequences et Settings possèdent leurs données et leurs règles
métier. La phase 2 partage le cycle technique du polling et des actions de queue,
et divise Settings en sections locales. Les routes API et le runner sont inchangés.

## Problème précis

Les deux listes dupliquaient annulation, timer et nettoyage, et rechargeaient
souvent les définitions et l’historique après avoir déjà reçu une définition
complète. Un polling en cours pouvait réappliquer un état antérieur à une mutation.
Settings mélangeait inspection Git, exécution, variables locales, publication et
suppression dans un composant de près de 1 700 lignes.

## Situation visée

Chaque mutation indique les données réconciliées et celles qui manquent encore.
Une réponse devenue obsolète ne peut pas écraser le résultat courant. Les sections
Settings ont un propriétaire explicite, sans store global ni changement d’API.

## Polling et invalidation

`src/lib/polling.ts` possède le timer, l’AbortController et les pauses pendant les
mutations. `src/hooks/use-polling.ts` lie ce mécanisme au montage React et fournit
`refresh` et `mutate`. Cette primitive ne connaît ni Project, ni Task, ni Sequence.

Les hooks `useTaskOverview` et `useSequenceOverview` gardent leurs URL, états,
erreurs, validations de réponse et cadences. Ils conservent `Promise.allSettled` :
une réponse valide reste applicable si l’autre requête échoue; la liste en erreur
garde son dernier contenu et un avertissement. Tasks attend 3 secondes après un
cycle; Sequences attend 1,5 seconde si un Run est actif, sinon 3 secondes. Le délai
commence après la réponse, sans empiler des requêtes périodiques.

Avant une mutation, `mutate` annule le cycle et suspend les prochains appels.
Les callbacks vérifient `signal.aborted` avant toute écriture. La réponse de
mutation est validée avant réconciliation. La boucle reprend ensuite normalement,
ou immédiatement si un rafraîchissement ciblé a été demandé. Un échec réseau ou
de contrat déclenche une relecture immédiate : le serveur peut avoir enregistré
l’opération avant la perte de sa réponse. Ne jamais relancer automatiquement la
mutation elle-même.

Le démontage invalide également les mutations tardives. Les vues sont identifiées
par Project et chemin du dépôt. Le chargement des anciennes pages d’historique
Task possède en plus une révision qui invalide une page commencée avant une
suppression de Run. La branche effective reste dans Tasks. Le checkpoint reste
dans Sequences, avec une clé Project/Sequence et une annulation indépendante :
le checkpoint d’une ancienne sélection ne s’affiche jamais pour la nouvelle.

## Matrice des mutations

| Action | Réponse existante de l’API | Réconciliation immédiate | Relecture immédiate |
| --- | --- | --- | --- |
| Créer/modifier Task | `task` complète | Remplacement/ajout et tri par nom | Aucune; polling conservé |
| Supprimer Task | `success`, `queue` | Retrait de la définition et queue | Aucune; historique conservé |
| Créer/modifier Sequence | `sequence` complète | Remplacement/ajout et tri; sélection à la création | Checkpoint si la sélection change |
| Créer/modifier/supprimer/réordonner Step | `sequence` complète avec étapes ordonnées | Remplacement de la définition | Aucune |
| Supprimer Sequence | `success`, `queue` | Retrait, fermeture de la sélection et queue | Aucune; historique conservé |
| Lancer/réexécuter Task | `run` | Insertion du Run, ouverture du Sheet | `/runs` pour la queue et l’historique |
| Lancer/reprendre Sequence, reprendre checkpoint | `run` | Insertion du Run, sélection et Sheet | `/sequence-runs` pour les Steps et la queue; checkpoint sélectionné |
| Pause de Sequence | `run` | Mise à jour du Run | `/sequence-runs` et checkpoint; l’arrêt demeure vérifié par le runner |
| Récupérer bloqueur | `run`, `queue` | Queue globale | Historique du domaine; checkpoint pour Sequences |
| Supprimer Run/bloqueur | `run`, `queue` | Retrait des listes/Steps locaux et fermeture du Sheet concerné; queue | Historique, notamment pour compléter la fenêtre de 200 Runs |
| Fermer le Sheet | Pas de réponse de mutation | Fermeture locale | Historique et queue; pas les définitions |
| Annuler dans le Sheet | `run` | Le Sheet conserve son cycle existant | Polling du Sheet; historique à sa fermeture |

Les réponses de lancement, pause et reprise **ne contiennent pas** la queue.
Il faut la relire immédiatement, sans inventer un statut depuis le seul Run.
Le ciblage ne modifie pas les lectures périodiques complètes : des modifications
externes aux fichiers `.tasker` restent découvertes normalement.

`runs/use-queue-actions.ts` partage la garde concurrente, l’état occupé, l’erreur,
la requête via `queue-client.ts` et l’application de la queue. Chaque écran garde
sa confirmation, ses messages et les effets sur ses listes. `BLOCKED_PROCESS`
n’autorise aucune confirmation manuelle; `BLOCKED_RECOVERY` et
`RECOVERY_REQUIRED` exigent aussi `canRecover`. La réponse doit correspondre au
bloqueur demandé, y compris lorsqu’il appartient à un autre Project.

## Propriété de Settings

```text
ProjectSettingsForm : Project local et remontée des changements au parent
  ProjectSettingsContent : composition, remontage quand le dépôt change
    useRepositorySettings : chemin, inspection, branche, initialisation
      RepositorySettingsSection : dépôt, statut .tasker, informations Git
    inspection.isTaskerInitialized
      ExecutionSettingsSection
        useExecutionSettings : brouillon et sauvegarde exécution/Python/variables
          RuntimeSettingsSection
          EnvironmentSettingsSection
          ScriptsSettingsSection
          TimeoutSettingsSection
        usePublicationSettings : chargement et sauvegarde Git séparés
          PublicationSettingsSection
        DeleteProjectSection : dialogue et suppression locale du Project
```

Ces fichiers vivent dans `src/modules/projects/settings/`. Les brouillons
d’exécution et de publication restent montés lors d’un changement d’onglet interne.
Changer de dépôt remonte le contenu et annule les lectures de l’ancien dépôt,
même lorsque les deux dépôts sont déjà initialisés. L’initialisation réussie
invalide une inspection antérieure encore en vol.

`environment-draft.ts` crée des champs vides depuis les seuls noms/indicateurs
`configured`. Une valeur configurée laissée vide est **omise** du payload; elle
n’est pas remplacée par une chaîne vide. Une ligne retirée signifie suppression à
la sauvegarde. Une valeur saisie reste uniquement dans le brouillon et la requête;
la réponse ne la réinjecte jamais dans le formulaire.

## Mesures reproductibles et décision

Mesures du 24 septembre 2026 sous Windows, Node 24, Next.js en développement,
SQLite/dépôts jetables, un Task et une Sequence de cinq étapes par Project.
Chaque Project possède 0, 50 ou 200 Runs terminaux de chaque domaine. Trois pages
sont ouvertes simultanément. Le proxy compte les requêtes HTTP complètes, les
octets de réponse et le délai jusqu’à leur fin pendant **60 secondes**. Les routes
sont chargées avant capture; les mesures n’incluent ni événement brut ni secret.

La référence est le code des cinq vues/hooks remplacés au commit
`9993442f042a0bf3d78efea2c92d40cf4d6f04d6`, dans une copie isolée. Le backend est
identique. Les résultats ci-dessous donnent « avant → après »; les tailles sont
identiques avant et après.

| Vue / Runs | Appels définitions | Appels historique | Octets définitions / historique par réponse | Temps moyen définitions / historique, ms |
| --- | --- | --- | --- | --- |
| Tasks / 0 | 19 → 19 | 19 → 19 | 179 / 102 | 64 / 77 → 28 / 35 |
| Tasks / 50 | 19 → 19 | 19 → 19 | 179 / 43 451 | 75 / 81 → 22 / 32 |
| Tasks / 200 | 19 → 19 | 19 → 19 | 179 / 173 501 | 66 / 78 → 22 / 34 |
| Sequences / 0 | 20 → 20 | 20 → 20 | 636 / 116 | 37 / 45 → 37 / 51 |
| Sequences / 50 | 20 → 20 | 20 → 20 | 636 / 147 514 | 43 / 71 → 28 / 40 |
| Sequences / 200 | 20 → 19 | 20 → 19 | 636 / 281 464 | 41 / 69 → 38 / 63 |

19 ou 20 cycles reflètent l’alignement de la fenêtre et l’attente après réponse.
Les temps comprennent le proxy et varient avec les autres processus de
développement, dont un build pendant une capture Tasks. **Ils ne prouvent pas
une accélération du backend.** Les coûts périodiques sont volontairement conservés.
Le rendu des historiques de 200 Runs, les changements d’onglet et les dialogues
restent utilisables; aucune mesure de durée de commit React n’a été réalisée.

Les définitions changent bien moins souvent que les Runs, mais les réduire ici
n’apporterait que 3,4 Ko/minute pour Tasks et 12,7 Ko/minute pour Sequences sur ces
fixtures. L’historique domine (environ 3,3 Mo/minute pour 200 Tasks et 5,3–5,6
Mo/minute pour 200 Sequences). Les étapes des 50 Runs récents servent aux compteurs,
aux statuts certifiés et à la sélection de continuation; leur suppression aveugle
serait incorrecte. Le polling du domaine précédent cesse après changement
d’onglet de l’application; les pages du navigateur laissées ouvertes continuent.

Décision : aucune pagination ni baisse de cadence supplémentaire n’est justifiée
par ce jeu de données local. L’optimisation livrée reste la réconciliation ciblée :
une sauvegarde de définition supprime les deux GET immédiats auparavant provoqués
par `refresh`; une action de Run relit seulement son historique. Le polling complet
reste le filet de sécurité. De gros `diff`/`resolvedConfig` ou des Sequences de
centaines d’étapes exigeraient un nouveau benchmark, puis un lot API distinct.

Pour reproduire depuis la racine du dépôt :

```powershell
node --import tsx scripts/interface-benchmark.ts
# Autre terminal, référence explicitement choisie :
node --import tsx scripts/interface-benchmark.ts --baseline=9993442f042a0bf3d78efea2c92d40cf4d6f04d6
```

Ouvrir `/interface-0`, `/interface-50`, `/interface-200` sur `http://127.0.0.1:5056`
(courant) ou `http://127.0.0.1:5058` (référence), attendre les listes puis choisir
le même onglet sur les trois pages. Lancer une seule capture à la fois par serveur :

```powershell
node scripts/capture-interface-benchmark.mjs 5056 tasks-after
node scripts/capture-interface-benchmark.mjs 5058 tasks-before
# Sélectionner Sequences sur les trois pages de chaque serveur, puis :
node scripts/capture-interface-benchmark.mjs 5056 sequences-after
node scripts/capture-interface-benchmark.mjs 5058 sequences-before
```

Les rapports JSON et tous les artefacts restent sous `.test-artifacts/`, déjà
ignoré. Le processus de fixture possède le verrou runner : aucun lancement UI ne
peut démarrer Codex. Arrêter les serveurs de test avant ce processus propriétaire.
La copie de référence remplace seulement les cinq fichiers concernés; elle sert
aux comparaisons de cette phase avec un backend inchangé.

## Vérifications et limites

- TypeScript, ESLint et build de production dans une base et un répertoire séparés.
- Suite complète filesystem, SQLite, processus, queue, pause/reprise, checkpoint,
  continuation et publication : 145 tests réussis, un ignoré faute de privilège
  de lien symbolique sous Windows; aucun Run utilisateur lancé, interrompu ou modifié.
- Tests ciblés : réponse tardive après mutation/démontage, délais adaptatifs,
  invalidations concurrentes, échec de mutation, confirmations et exclusions de
  récupération, réponses invalides et conservation des variables masquées.
- Navigateur : création/édition/suppression Task avec historique conservé, mise
  en file et Sheet; création/édition Sequence et Step; historique utilisable lors
  d’un échec de chargement des définitions; changement de dépôt, initialisation et
  chargements Git/exécution, préflight Python, double sauvegarde d’une variable
  factice et sauvegarde publication; confirmation Project annulée; affichage d’un
  blocage global et annulation de sa confirmation.
- Les pauses/reprises réelles, les checkpoints distants et les suppressions de
  worktree sont couverts par les tests d’intégration existants, pas par un nouveau
  Run Codex réel. La fixture UI n’a volontairement aucun remote.
- L’audit des vues Agents/Instructions n’a pas identifié de cycle identique au
  polling des listes justifiant une abstraction supplémentaire.
- Aucun fichier devenu inaccessible à auditer : les anciennes implémentations
  sont remplacées ou déplacées, sans duplication résiduelle conservée.
