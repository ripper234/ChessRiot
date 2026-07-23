import type { GameSnapshot } from "./game-types";

const RECENT_KEY = "chessriot:recent";
const STORAGE_TEST_KEY = "chessriot:storage-test";

export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generateUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function playerKey(gameId: string): string {
  return `chessriot:player:${gameId}`;
}

export function inviteKey(gameId: string): string {
  return `chessriot:invite:${gameId}`;
}

export function canUseGameStorage(): boolean {
  try {
    localStorage.setItem(STORAGE_TEST_KEY, "ok");
    localStorage.removeItem(STORAGE_TEST_KEY);
    return true;
  } catch {
    return false;
  }
}

export interface RecentGame {
  id: string;
  label: string;
  color: "w" | "b";
  updatedAt: string;
}

export function readRecentGames(): RecentGame[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is RecentGame =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as RecentGame).id === "string" &&
            typeof (item as RecentGame).label === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function rememberGame(game: GameSnapshot): void {
  const opponent = game.you.color === "w" ? game.players.black?.name : game.players.white.name;
  const next: RecentGame = {
    id: game.id,
    label: opponent ? `vs ${opponent}` : "Waiting for Player 2",
    color: game.you.color,
    updatedAt: game.updatedAt,
  };
  const games = [next, ...readRecentGames().filter((item) => item.id !== game.id)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(games));
  } catch {
    // Recent games are a convenience. Losing this index must not break gameplay.
  }
}
