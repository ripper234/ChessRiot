export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function apiError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, { status });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const maximumBytes = 8_192;
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) return null;
  try {
    if (!request.body) return null;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  return match?.[1] ?? null;
}

export const dynamic = "force-dynamic";
