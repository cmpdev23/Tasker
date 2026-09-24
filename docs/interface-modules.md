# Architecture modulaire de l’interface

## Situation actuelle

L’interface AgentTasker est organisée par domaines sous `src/modules/`. Les routes Next.js restent dans `src/app/` et les services exécutables côté serveur dans `backend/`.

## Problème précis

Les vues, dialogues et utilitaires étaient auparavant mêlés dans `src/components/`. L’emplacement d’un fichier n’indiquait pas son propriétaire, et un utilitaire mélangeait le calendrier des Tasks, les statuts de Runs et les requêtes HTTP.

## Situation visée

La structure livrée donne un propriétaire local à chaque fonctionnalité et laisse les contrats UI/API/serveur à un emplacement neutre. Les URL, contrats API et règles du runner ne dépendent pas de cette organisation de l’interface.

## Propriété des fichiers

| Emplacement | Responsabilité |
| --- | --- |
| `src/modules/app-shell/` | Navigation et structure de l’application |
| `src/modules/projects/` | Contexte, liste et composition Project, création et Settings |
| `src/modules/tasks/` | Liste, édition, historique, chargement et présentation des Tasks |
| `src/modules/sequences/` | Liste, édition, chargement et présentation des Sequences |
| `src/modules/runs/` | Sheet, queue, statuts, dates et Run Inspector communs |
| `src/modules/agents/`, `src/modules/instructions/` | Interfaces propres au projet |
| `src/components/ui/`, `src/components/reui/` | Primitives partagées et alias de `components.json` |
| `src/hooks/`, `src/lib/` | Code réellement transversal; `client-request.ts` fournit les requêtes et erreurs communes |
| `src/types/` | Contrats actuellement importés par l’UI, les API, `backend/` et les tests |

Un module conserve ses composants, hooks et fonctions près de leur domaine. Un sous-dossier local est créé seulement lorsque le volume le rend utile. Le module Projects compose les vues; l’App Shell dépend du contexte Projects pour sa navigation; Tasks et Sequences utilisent Runs. Tasks et Sequences ne s’importent pas entre eux. Aucun module client n’importe un service serveur exécutable.

Les vues Tasks et Sequences gardent les confirmations, mutations et retours utilisateur liés à leur interface. Leurs hooks locaux portent le chargement, les erreurs et le polling. Leurs fonctions locales de présentation portent les horaires, états et préfixes d’étapes certifiés. Les opérations communes de récupération et suppression d’un Run bloquant passent par `src/modules/runs/queue-client.ts`.

`src/components/theme-provider.tsx` et `src/components/dev/` sont transversaux ou destinés au développement. Les anciens exemples sans entrée depuis les routes sont recensés dans `branch_doc/dead_code.md` pour audit avant suppression.
