import { AccountGate } from "@/app/ui/AccountGate";
import { WorldBrowser } from "@/app/ui/WorldBrowser";

export default function WorldsPage() {
  return <AccountGate><WorldBrowser /></AccountGate>;
}
