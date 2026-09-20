export const RECOVERY_DELAYS_MS = [1_500, 3_000, 7_000, 15_000, 30_000] as const;
export const STANDARD_GAME_POLL_MS = 3_000;
export const LOW_RESOURCE_GAME_POLL_MS = 9_000;
export const READ_TIMEOUT_MS = 12_000;

export interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

export interface JsonReadResult<T> {
  response: Response;
  data: T | null;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

function boundedAbort(
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  aborted: Promise<never>;
  dispose: () => void;
} {
  const controller = new AbortController();
  let rejectAbort: (reason: DOMException) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    rejectAbort(abortError());
  };
  if (callerSignal?.aborted) abort();
  else callerSignal?.addEventListener("abort", abort, { once: true });
  const timer = globalThis.setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    aborted,
    dispose: () => {
      globalThis.clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abort);
    },
  };
}

export function recoveryDelayMs(attempt: number): number {
  const index = Math.max(0, Math.min(
    RECOVERY_DELAYS_MS.length - 1,
    Math.floor(Number.isFinite(attempt) ? attempt : 0),
  ));
  return RECOVERY_DELAYS_MS[index];
}

export function lowResourceConnection(
  connection: NetworkInformationLike | null | undefined,
): boolean {
  return Boolean(
    connection?.saveData
    || connection?.effectiveType === "slow-2g"
    || connection?.effectiveType === "2g",
  );
}

export function gamePollingIntervalMs(
  connection: NetworkInformationLike | null | undefined,
): number {
  return lowResourceConnection(connection)
    ? LOW_RESOURCE_GAME_POLL_MS
    : STANDARD_GAME_POLL_MS;
}

export async function fetchWithReadTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = READ_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
    init.signal?.removeEventListener("abort", forwardAbort);
  }
}

/**
 * Fetches and parses one JSON response inside a single deadline. Keeping the
 * deadline alive through `response.json()` prevents a received response with a
 * stalled body from leaving a client loading screen open forever.
 */
export async function fetchJsonWithReadTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = READ_TIMEOUT_MS,
): Promise<JsonReadResult<T>> {
  const bounded = boundedAbort(init.signal, timeoutMs);
  try {
    const response = await Promise.race([
      fetch(input, { ...init, signal: bounded.signal }),
      bounded.aborted,
    ]);
    if (
      response.status === 204
      || response.status === 205
      || response.body === null
      || response.headers.get("content-length") === "0"
    ) {
      return { response, data: null };
    }
    const data = await Promise.race([
      response.json() as Promise<T>,
      bounded.aborted,
    ]);
    return { response, data };
  } finally {
    bounded.dispose();
  }
}
