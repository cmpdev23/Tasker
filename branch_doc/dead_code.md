# Dead Code Log

## Removed Files

- `src/app/cmt/page.tsx`: Replaced by dynamic route `src/app/[projectSlug]/page.tsx` to handle any project slug dynamically (including `cmt`).

## Fichiers sans entrée applicative confirmée, à auditer avant suppression

- `src/modules/app-shell/page.tsx` : ancienne page de démonstration hors de `src/app/`, jamais importée par une route.
- `src/modules/app-shell/components/search-form.tsx` et `spending-limit.tsx` : composants de démonstration sans import entrant depuis l’App Shell ou une route.
- `src/components/blocks/form-6/` : exemple de formulaire autonome; son `page.tsx` n’est pas une route Next.js et aucun fichier applicatif ne l’importe.
- `src/components/ui/svgs/paypalWordmark.tsx` et `stripeWordmark.tsx` : utilisés uniquement par l’exemple `form-6` ci-dessus.
