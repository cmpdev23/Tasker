export async function taskRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Requête impossible (HTTP ${response.status}).`);
  }
  return data as T;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Une erreur est survenue.";
}
