import { clearGamePrefetch } from "./game-prefetch";
import { fetchJsonWithReadTimeout } from "./client-recovery";
export const AUTH_SESSION_CHANGED_EVENT = "chessriot:auth-session-changed";
export const AUTH_SESSION_INVALIDATED_EVENT = "chessriot:auth-session-invalidated";

export interface AuthSessionChangedDetail {
  signedIn: boolean;
}

export function publishAuthSessionChanged(signedIn: boolean, preserveRead = false): void {
  if (!preserveRead) invalidateAuthSessionRead();
  window.dispatchEvent(new CustomEvent<AuthSessionChangedDetail>(
    AUTH_SESSION_CHANGED_EVENT,
    { detail: { signedIn } },
  ));
}

export function publishAuthSessionInvalidated(): void {
  invalidateAuthSessionRead();
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_INVALIDATED_EVENT));
}

let sessionGeneration = 0;
let sharedRead: { generation: number; expires: number; promise: Promise<{ response: Response; data: unknown }> } | null = null;

function invalidateAuthSessionRead(): void {
  sessionGeneration += 1;
  clearGamePrefetch();
  sharedRead = null;
}

// Memory only, shared by account gate and settings. No authenticated response
// is persisted in Cache Storage or reused across an account change.
export async function readAuthSession<T>(): Promise<{ response: Response; data: T | null }> {
  if (!sharedRead || sharedRead.generation !== sessionGeneration || sharedRead.expires < Date.now()) {
    const generation = sessionGeneration;
    const promise = fetchJsonWithReadTimeout<unknown>("/api/auth/session", {
      cache: "no-store", credentials: "same-origin",
    });
    const entry = { generation, expires: Infinity, promise };
    sharedRead = entry;
    promise.then(() => { entry.expires = Date.now() + 500; }, () => {
      if (sharedRead === entry) sharedRead = null;
    });
  }
  const entry = sharedRead;
  let result;
  try { result = await entry.promise; }
  catch (error) {
    if (entry.generation !== sessionGeneration) return readAuthSession<T>();
    throw error;
  }
  if (entry.generation !== sessionGeneration) return readAuthSession<T>();
  return result as { response: Response; data: T | null };
}
