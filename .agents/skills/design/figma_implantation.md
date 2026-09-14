# Figma implantation

Le but n'est PAS de reproduire Figma au pixel près.

Le but est de reproduire fidèlement l'intention visuelle tout en respectant l'architecture, le design system et les conventions du projet.

Le design system est toujours la source de vérité.

## Priorité des décisions

Lorsque plusieurs sources semblent entrer en conflit, respecte toujours cet ordre :

1. Les règles du projet
2. Les composants existants
3. Les design tokens (Tailwind, variables, spacing, typography, couleurs)
4. Le design Figma

Le Figma est une référence visuelle, pas une spécification technique absolue.

---

## Ne jamais faire

Ne jamais :

- hardcoder des tailles provenant directement de Figma
- créer des classes arbitraires uniquement pour reproduire un pixel
- modifier le design system pour satisfaire Figma
- contourner les composants existants
- créer de nouveaux composants génériques sans raison

Si un composant existe déjà (Heading, Text, Button, Card, etc.), il doit être utilisé.

---

## En cas de différence

Si Figma montre :

- 41 px
- 19 px
- 682 px
- 53 px

Utilise la valeur la plus proche provenant du design system.

Ne crée jamais un nouveau token pour une seule page.

---

## Scope

Implémente uniquement ce qui est demandé.

Ne pas :

- créer des pages supplémentaires
- créer du contenu futur
- modifier la navigation
- modifier le routing
- améliorer d'autres composants
- faire du refactoring non demandé

Si l'utilisateur demande uniquement un Hero, implante uniquement le Hero.

---

## Réutilisation

Avant de créer un nouveau composant :

1. Chercher un composant existant.
2. Vérifier si celui-ci peut être réutilisé.
3. Seulement s'il est impossible de le réutiliser, créer un nouveau composant générique.

Ne jamais créer un composant spécifique à une seule page.

---

## Mobile first

Toujours développer en mobile-first.

La version desktop est une adaptation de la version mobile, jamais l'inverse.

---

## Si un doute existe

En cas de conflit entre Figma et le projet :

Le projet gagne toujours.

Choisir la solution :

- la plus simple
- la plus maintenable
- la plus cohérente avec l'ensemble de l'application

même si elle diffère légèrement du design Figma.

---

## À la fin

Fournir uniquement :

- les fichiers créés
- les fichiers modifiés
- les décisions importantes prises lorsque Figma ne correspondait pas au design system

Ne pas justifier chaque choix de spacing ou de typographie.
