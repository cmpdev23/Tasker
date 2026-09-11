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
- Avant de lancer les tests SQLite, utiliser le runtime Node correspondant au module
  natif `better-sqlite3` installé, idéalement celui du serveur de développement déjà
  actif. Une série d’erreurs `NODE_MODULE_VERSION` indique un mauvais runtime de
  test, pas des régressions applicatives.
- Toute suite de tests doit définir une base temporaire avant l’import d’un module
  backend, y compris les imports transitifs. Le lanceur de suite doit aussi fournir
  une base jetable par défaut afin qu’un nouveau test ne puisse pas écrire dans la
  base utilisateur.
- Les commandes des projets ne doivent pas hériter du mode Node/Next du serveur
  AgentTasker. Vérifier leur environnement avec un hôte en développement et en
  production, puis confirmer les incidents de build sur le contenu réellement échoué.
