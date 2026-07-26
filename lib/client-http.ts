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

export function requestHeaders(
  token: string | null,
  jsonBody = false,
): Record<string, string> {
  return {
    ...(jsonBody ? { "content-type": "application/json" } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}
