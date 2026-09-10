import { BusinessVerification } from "./components/business-verification"

export function Page() {
  return (
    <main
      className="bg-background flex min-h-svh w-full justify-center px-4 py-6 sm:px-8 sm:py-10 lg:px-10"
      aria-labelledby="page-heading"
    >
      <h1 id="page-heading" className="sr-only">
        Business verification form
      </h1>
      <BusinessVerification />
    </main>
  )
}