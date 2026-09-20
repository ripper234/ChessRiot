import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findPublicGameRecap } from "@/lib/game-recaps";
import { RecapViewer } from "@/app/ui/RecapViewer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared match recap | ChessRiot",
  description: "Replay a completed ChessRiot match move by move.",
  robots: { index: false, follow: false },
};

export default async function RecapPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const recap = await findPublicGameRecap(shareId);
  if (!recap) notFound();
  return <RecapViewer recap={recap} />;
}
