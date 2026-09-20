import { CreateGame } from "@/app/ui/CreateGame";
import { AccountGate } from "@/app/ui/AccountGate";

export default function AppHomePage() {
  return <AccountGate><CreateGame /></AccountGate>;
}
