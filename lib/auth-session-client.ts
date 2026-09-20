export const AUTH_SESSION_CHANGED_EVENT = "chessriot:auth-session-changed";
export const AUTH_SESSION_INVALIDATED_EVENT = "chessriot:auth-session-invalidated";

export interface AuthSessionChangedDetail {
  signedIn: boolean;
}

export function publishAuthSessionChanged(signedIn: boolean): void {
  window.dispatchEvent(new CustomEvent<AuthSessionChangedDetail>(
    AUTH_SESSION_CHANGED_EVENT,
    { detail: { signedIn } },
  ));
}

export function publishAuthSessionInvalidated(): void {
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_INVALIDATED_EVENT));
}
