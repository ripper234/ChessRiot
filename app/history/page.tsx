import { AccountGate } from "@/app/ui/AccountGate";
import { GameHistory } from "@/app/ui/GameHistory";

export default function HistoryPage() {
  return <AccountGate><GameHistory /></AccountGate>;
}

