import type { Metadata } from "next";
import { GameRoom } from "@/app/ui/GameRoom";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameRoom gameId={id} />;
}
