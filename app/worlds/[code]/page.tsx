import { AccountGate } from "@/app/ui/AccountGate";
import { WorldDetail } from "@/app/ui/WorldBrowser";

export default async function WorldPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <AccountGate><WorldDetail code={code} /></AccountGate>;
}
