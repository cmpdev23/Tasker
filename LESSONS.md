# Leçons opérationnelles

- Sous Windows, le nettoyage des fixtures ayant lancé des arbres de processus doit
  utiliser `fs.rm` avec `maxRetries` et `retryDelay`; la libération d’un handle peut
  être légèrement différée même après une terminaison vérifiée. Toujours confirmer
  une correction de ce type avec la suite complète, pas seulement le test ciblé.
- Avant d’arrêter ou de redémarrer le serveur AgentTasker, vérifier en base qu’aucun
  Run n’est `PREPARING`, `RUNNING` ou `VALIDATING`. Un build ne justifie jamais
  d’interrompre un Run utilisateur; attendre sa fin ou obtenir une autorisation
  explicite avant toute annulation.
- Après une mutation de Task, de Run ou de récupération, retourner et réconcilier
  immédiatement l’état global dépendant de la queue; ne pas compter uniquement sur
  un rafraîchissement manuel ou sur le prochain polling. Distinguer un pipeline
  réellement bloqué avec des Runs en attente d’une récupération préventive lorsqu’il
  n’y en a aucun.
- Une action destinée à sortir d’un blocage doit être visible à l’endroit où le
  blocage est expliqué. Ne pas cacher « Supprimer » derrière une confirmation
  préalable qui fait disparaître la garde UI; offrir le parcours combiné lorsque
  les mêmes conditions de sécurité peuvent être confirmées en une seule action.
