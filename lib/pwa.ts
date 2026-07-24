import type { GameSnapshot, PublicMove } from "./game-types";

export const RELEASE_SEEN_KEY = "chessriot:release-seen";
export const MOVE_NOTIFICATIONS_KEY = "chessriot:move-notifications";
export const RELEASE_CHECK_INTERVAL_MS = 5 * 60 * 1_000;
export const MOVE_CHECK_INTERVAL_MS = 3_000;

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

