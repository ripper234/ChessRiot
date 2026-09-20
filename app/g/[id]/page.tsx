import type { Metadata } from "next";
import { GameRoom } from "@/app/ui/GameRoom";
import { AccountGate } from "@/app/ui/AccountGate";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccountGate><GameRoom key={id} gameId={id} /></AccountGate>;
}
