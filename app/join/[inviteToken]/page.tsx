import { JoinGame } from "@/app/ui/JoinGame";
import { requirePlayableAccount } from "@/app/chatgpt-auth";

export default async function JoinPage({ params }: { params: Promise<{ inviteToken: string }> }) {
  const { inviteToken } = await params;
  const account = await requirePlayableAccount(`/join/${inviteToken}`);
  return <JoinGame inviteToken={inviteToken} displayName={account.displayName} />;
}
