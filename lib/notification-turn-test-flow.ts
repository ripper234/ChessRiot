import { turnTestReceiptOpened, turnTestRoundPassed, type TurnTestReceipt } from "./notification-turn-test-client";

export type NotificationTestPhase = "ready" | "waiting" | "confirm" | "complete" | "blocked" | "checking";

export function notificationTestFlow(input: {
  version: number;
  pendingReply: boolean;
  completed: boolean;
  expired: boolean;
  deviceEnabled?: boolean;
  deviceIssue?: string;
  deliveryFailed?: boolean;
  receipts: Record<number, TurnTestReceipt>;
}): { phase: NotificationTestPhase; round: number; passed: number; reason?: string } {
  const passed = [2, 4, 6, 8].filter((v) => turnTestRoundPassed(input.receipts[v])).length;
  const round = Math.min(4, Math.floor((input.version + 1) / 2) || 1);
  const result = (phase: NotificationTestPhase, reason?: string) => ({ phase, round, passed, reason });
  if (passed === 4) return result("complete");
  if (input.deviceIssue) return result("blocked", input.deviceIssue);
  if (input.expired) return result("blocked", "This test expired. Start a fresh one.");
  if (input.completed) return result("blocked", "The game ended before all four rounds were verified.");
  if (input.deviceEnabled === false) return result("blocked", "Notifications were turned off for this phone. Start again to enable them.");
  const receipt = input.receipts[round * 2];
  if (receipt?.showRejectedAt) return result("blocked", "Your browser could not display the notification. Check notification permissions before restarting.");
  if (receipt?.receivedAt && receipt.visibleClients !== 0) return result("blocked", receipt.visibleClients
    ? "ChessRiot was still on screen when the notification arrived. Restart, then leave the app when prompted."
    : "We could not verify that ChessRiot was off screen. Restart to check again.");
  if (input.deviceEnabled === undefined) return result("checking");
  // A committed move is already in flight even while the game snapshot refreshes.
  if (input.pendingReply) return result("waiting");
  if (input.version === 0 || turnTestRoundPassed(input.receipts[input.version])) {
    if (input.version >= 8 || [2, 4, 6, 8].some((v) => v <= input.version && !turnTestRoundPassed(input.receipts[v]))) {
      return result("blocked", "An earlier round’s saved result is missing. Restart to verify all four rounds together.");
    }
    return { phase: "ready", round: input.version / 2 + 1, passed };
  }
  if (turnTestReceiptOpened(receipt)) return result("confirm");
  if (receipt?.clickedAt && receipt.openedAt) return result("blocked", "The notification evidence is incomplete or out of order. Restart to verify a fresh notification.");
  if (input.deliveryFailed) return result("blocked", "The notification could not be delivered to this phone. Restart to reconnect it.");
  return result("waiting");
}
