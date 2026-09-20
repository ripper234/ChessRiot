import { openAiApiKey } from "./runtime";

export const OPENAI_SMOKE_MODEL = "gpt-5.6-luna";
export const OPENAI_SMOKE_MARKER = "CHESSRIOT_OK";

export interface OpenAiSmokeResult {
  ok: boolean;
  model: typeof OPENAI_SMOKE_MODEL;
  status: number;
  requestId: string | null;
  error: "missing_key" | "network_error" | "provider_error" | "unexpected_output" | null;
}

function outputText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const direct = (value as { output_text?: unknown }).output_text;
  if (typeof direct === "string") return direct.trim();
  const output = (value as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => (
      part
      && typeof part === "object"
      && typeof (part as { text?: unknown }).text === "string"
        ? [(part as { text: string }).text]
        : []
    ));
  }).join("").trim();
}

export async function runOpenAiSmoke(
  apiKey = openAiApiKey(),
): Promise<OpenAiSmokeResult> {
  if (!apiKey) {
    return {
      ok: false,
      model: OPENAI_SMOKE_MODEL,
      status: 503,
      requestId: null,
      error: "missing_key",
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_SMOKE_MODEL,
        input: `Reply with exactly ${OPENAI_SMOKE_MARKER}`,
        reasoning: { effort: "none" },
        max_output_tokens: 16,
        store: false,
      }),
      signal: controller.signal,
    });
    const requestId = response.headers.get("x-request-id");
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        model: OPENAI_SMOKE_MODEL,
        status: response.status,
        requestId,
        error: "provider_error",
      };
    }
    const ok = outputText(payload) === OPENAI_SMOKE_MARKER;
    return {
      ok,
      model: OPENAI_SMOKE_MODEL,
      status: response.status,
      requestId,
      error: ok ? null : "unexpected_output",
    };
  } catch {
    return {
      ok: false,
      model: OPENAI_SMOKE_MODEL,
      status: 502,
      requestId: null,
      error: "network_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}
