export function apiErrorMessage(data: unknown, fallback: string): string {
  if (
    typeof data === "object"
    && data !== null
    && typeof (data as { error?: { message?: unknown } }).error?.message === "string"
  ) {
    return (data as { error: { message: string } }).error.message;
  }
  return fallback;
}

export async function readApiJson(response: Response): Promise<Record<string, unknown> | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    const value: unknown = await response.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function requestHeaders(
  token: string | null,
  jsonBody = false,
): Record<string, string> {
  return {
    ...(jsonBody ? { "content-type": "application/json" } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}
