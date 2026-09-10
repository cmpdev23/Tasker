import { ConflictError, NotFoundError, ValidationError } from "../errors";

export function errorResponse(error: unknown): Response {
  const status = error instanceof NotFoundError ? 404 : error instanceof ConflictError ? 409
    : error instanceof ValidationError || error instanceof SyntaxError ? 400 : 500;
  if (status === 500) console.error("AgentTasker API:", error);
  return Response.json({ error: status === 500 ? "Internal server error." : (error as Error).message }, { status });
}

// Local execution endpoints must not accept cross-origin browser requests.
export function assertLocalRequest(request: Request) {
  const origin = request.headers.get("origin");
  // Next may normalize request.url to localhost even when the browser used 127.0.0.1.
  const host = request.headers.get("host") || new URL(request.url).host;
  const hostname = new URL(`http://${host}`).hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
      (origin && new URL(origin).host !== host) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ValidationError("Cross-origin requests are not allowed.");
  }
}
