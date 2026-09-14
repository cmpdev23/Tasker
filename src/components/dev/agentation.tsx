"use client";

import dynamic from "next/dynamic";

/**
 * Development-only visual annotation tool.
 *
 * The conditional is statically inlined by Next.js, so Agentation's dynamic
 * import is removed from production bundles.
 */
const Agentation =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("agentation").then((mod) => mod.Agentation), {
        ssr: false,
      })
    : null;

export function DevAgentation() {
  if (!Agentation) return null;

  return (
    <Agentation
      endpoint="http://localhost:4747"
      onSessionCreated={(sessionId) => {
        console.log("[agentation] session:", sessionId);
      }}
    />
  );
}
