# Leçons opérationnelles

- Sous Windows, le nettoyage des fixtures ayant lancé des arbres de processus doit
  utiliser `fs.rm` avec `maxRetries` et `retryDelay`; la libération d’un handle peut
  être légèrement différée même après une terminaison vérifiée. Toujours confirmer
  une correction de ce type avec la suite complète, pas seulement le test ciblé.
- Avant d’arrêter ou de redémarrer le serveur AgentTasker, vérifier en base qu’aucun
  Run n’est `PREPARING`, `RUNNING` ou `VALIDATING`. Un build ne justifie jamais
  d’interrompre un Run utilisateur; attendre sa fin ou obtenir une autorisation
  explicite avant toute annulation.
