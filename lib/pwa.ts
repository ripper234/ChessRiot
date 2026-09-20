import type { GameSnapshot, PublicMove } from "./game-types";

export const RELEASE_SEEN_KEY = "chessriot:release-seen";
export const MOVE_NOTIFICATIONS_KEY = "chessriot:move-notifications";
export const TURN_ALERT_OFFER_SEEN_PREFIX = "chessriot:turn-alert-offer-seen:v1:";
export const NOTIFICATION_OFFER_DECISION_PREFIX = "chessriot:notification-offer:v2:";
export const PUSH_DEVICE_OWNER_KEY = "chessriot:push-device-owner:v1";
export const RELEASE_CHECK_INTERVAL_MS = 5 * 60 * 1_000;
export const MOVE_CHECK_INTERVAL_MS = 15_000;

export interface WatchedAccountGame {
  id: string;
  mode: "solo" | "multiplayer";
  status: "waiting" | "active" | "completed";
  color: "w" | "b";
  opponent: string | null;
  turn: "w" | "b";
  plyCount: number;
  updatedAt: string;
}

export function releaseTarget(currentVersion: string, availableVersion: string | null): string {
  return availableVersion && availableVersion !== currentVersion
    ? availableVersion
    : currentVersion;
}

export function hasUnseenRelease(
  currentVersion: string,
  seenVersion: string | null,
  availableVersion: string | null,
): boolean {
  if (!seenVersion) return false;
  return seenVersion !== releaseTarget(currentVersion, availableVersion);
}

export function parseEnabledPreference(value: string | null): boolean {
  return value === "true";
}

export function mayClearTurnNotification(
  visibility: DocumentVisibilityState,
  focused: boolean,
): boolean {
  return visibility === "visible" && focused;
}

export function shouldOfferTurnAlerts(input: {
  hasActiveGame: boolean;
  gameMode: "solo" | "multiplayer" | null;
  gameStatus: "waiting" | "active" | "completed" | null;
  pushReady: boolean;
  pushConfigured: boolean;
  turnAlertsEnabled: boolean;
  offerSeen: boolean;
}): boolean {
  return input.hasActiveGame
    && input.gameMode === "multiplayer"
    && input.gameStatus === "active"
    && input.pushReady
    && input.pushConfigured
    && !input.turnAlertsEnabled
    && !input.offerSeen;
}

export function notificationOfferDecisionKey(username: string): string {
  return `${NOTIFICATION_OFFER_DECISION_PREFIX}${encodeURIComponent(username.normalize("NFKC"))}`;
}

export function shouldBadgeAccountNotificationSettings(input: {
  activeGameId: string | null;
  mobile: boolean;
  signedInUsername: string | null;
  pushReady: boolean;
  pushConfigured: boolean;
  pushSupported: boolean;
  permission: NotificationPermission | "unsupported";
  enabled: boolean;
  decision: string | null;
}): boolean {
  const permissionBlocked = input.permission === "denied"
    && input.decision !== "disabled"
    && input.decision !== "dismissed";
  const needsRecovery = input.decision === "setup-failed"
    || input.decision === "onboarding"
    || input.decision === "setup-pending"
    || input.decision === "enabled"
    || permissionBlocked;
  return (Boolean(input.activeGameId) || needsRecovery)
    && input.mobile
    && Boolean(input.signedInUsername)
    && input.pushReady
    && (input.pushConfigured || needsRecovery)
    && input.pushSupported
    && input.permission !== "unsupported"
    && !input.enabled
    && (input.decision === null || needsRecovery);
}

export function accountNotificationTogglePresentation(
  enabled: boolean,
  legacyEnabled: boolean,
): { checked: boolean; detail: string; status: "ON" | "LIMITED" | "OFF" } {
  if (enabled) return { checked: true, detail: "This device", status: "ON" };
  if (legacyEnabled) {
    return {
      checked: true,
      detail: "Older game alerts only",
      status: "LIMITED",
    };
  }
  return { checked: false, detail: "This device", status: "OFF" };
}

export function gameIdFromPathname(pathname: string): string | null {
  const match = /^\/g\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function newestOpponentMoveAfter(
  game: Pick<GameSnapshot, "moves" | "you">,
  afterPly: number,
): PublicMove | null {
  return game.moves
    .filter((move) => move.ply > afterPly && move.color !== game.you.color)
    .at(-1) ?? null;
}

export function shouldNotifyForOpponentMove(
  game: Pick<GameSnapshot, "moves" | "you">,
  afterPly: number | null,
  pageVisibleAndFocused: boolean,
): boolean {
  if (afterPly === null || pageVisibleAndFocused) return false;
  return newestOpponentMoveAfter(game, afterPly) !== null;
}

export function opponentMovedSince(
  previous: WatchedAccountGame | undefined,
  current: WatchedAccountGame,
): boolean {
  if (
    !previous
    || current.mode !== "multiplayer"
    || current.plyCount <= previous.plyCount
  ) return false;
  const lastMover = current.plyCount % 2 === 1 ? "w" : "b";
  return lastMover !== current.color;
}
