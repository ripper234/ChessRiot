import type { GameSnapshot } from "./game-types";

export type GameEntryNotice = "challenge-sent" | "invitation-created";

export interface ConsumedGameEntryNotice {
  notice: GameEntryNotice | null;
  path: string;
}

export function consumeGameEntryNotice(input: URL): ConsumedGameEntryNotice {
  const url = new URL(input.href);
  const challengeSent = url.searchParams.get("challenge") === "sent";
  const invitationCreated = url.searchParams.get("invitation") === "created";
  const notice = challengeSent
    ? "challenge-sent"
    : invitationCreated
      ? "invitation-created"
      : null;

  if (challengeSent) {
    url.searchParams.delete("challenge");
    url.searchParams.delete("opponent");
  }
  if (invitationCreated) url.searchParams.delete("invitation");

  return {
    notice,
    path: `${url.pathname}${url.search}${url.hash}`,
  };
}

export function waitingUiBecameStale(
  previousStatus: GameSnapshot["status"] | null,
  nextStatus: GameSnapshot["status"],
  entryNoticeActive: boolean,
): boolean {
  return (
    previousStatus === "waiting" && nextStatus === "active"
  ) || (
    entryNoticeActive && nextStatus !== "waiting"
  );
}
