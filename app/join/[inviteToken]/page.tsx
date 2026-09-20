import type { Metadata } from "next";
import { JoinGame } from "@/app/ui/JoinGame";
import { AccountGate } from "@/app/ui/AccountGate";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function JoinPage({ params }: { params: Promise<{ inviteToken: string }> }) {
  const { inviteToken } = await params;
  return <AccountGate><JoinGame inviteToken={inviteToken} /></AccountGate>;
}
