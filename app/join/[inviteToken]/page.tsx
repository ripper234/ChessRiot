import { JoinGame } from "@/app/ui/JoinGame";

export default async function JoinPage({ params }: { params: Promise<{ inviteToken: string }> }) {
  const { inviteToken } = await params;
  return <JoinGame inviteToken={inviteToken} />;
}
