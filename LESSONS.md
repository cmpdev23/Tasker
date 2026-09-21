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
- Sous Windows, ne jamais conclure qu’un runtime utilisateur est absent à partir
  d’un terminal sandboxé ou de service : comparer d’abord l’identité Windows, le
  profil et le `PATH` du processus qui exécutera réellement le Run. Un interpréteur
  installé dans un autre profil peut exister tout en étant inaccessible au worker.
- Toute suite de tests doit définir une base temporaire avant l’import d’un module
  backend, y compris les imports transitifs. Le lanceur de suite doit aussi fournir
  une base jetable par défaut afin qu’un nouveau test ne puisse pas écrire dans la
  base utilisateur.
- Les commandes des projets ne doivent pas hériter du mode Node/Next du serveur
  AgentTasker. Vérifier leur environnement avec un hôte en développement et en
  production, puis confirmer les incidents de build sur le contenu réellement échoué.
- Pour un menu portaled, appliquer le `z-index` au conteneur de positionnement,
  pas seulement au popup enfant : un enfant ne peut pas sortir du contexte
  d’empilement de son parent et peut sinon passer derrière la sidebar fixe.
- Ne jamais imposer une stratégie unique de publication aux Sequences. Le choix
  entre une PR finale et des PR distinctes par étape est une configuration
  versionnée de la Sequence; les publications d’étapes déjà réussies doivent
  rester récupérables lorsqu’une étape suivante échoue.
- Après une modification d’un worker démarré par `instrumentation.ts`, redémarrer
  le serveur avant un test réel. Le rechargement à chaud peut actualiser l’API et
  afficher une sauvegarde réussie tout en laissant le worker de fond sur l’ancien
  code; vérifier l’événement d’environnement et le snapshot du Run.
- Lorsqu’AgentTasker remplace la sandbox d’un Run par un profil de permissions
  nommé pour exposer des runtimes externes en lecture seule, recopier explicitement
  la permission réseau résolue. Un profil étendant `:workspace` garde le réseau
  désactivé par défaut, même si `sandbox_workspace_write.network_access` vaut vrai.
