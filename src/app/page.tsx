import { requireOnboardedUser } from '@/auth/session';
import { SignOutButton } from '@/components/AuthButtons';

export default async function HomePage() {
  const { profile } = await requireOnboardedUser();
  return <section className="card stack"><p className="muted">Signed in as @{profile.username}</p><h1>ChessRiot home</h1><p>App shell ready for the next MVP phase: friends, game invites, chess rules, and notifications.</p><SignOutButton /></section>;
}
