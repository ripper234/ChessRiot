import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { SignInButton } from '@/components/AuthButtons';
import { authOptions } from '@/auth/options';

export default async function SignInPage() {
  const session = await getServerSession(authOptions);
  if (session?.user) redirect('/');
  return <section className="card stack"><p className="muted">ChessRiot MVP</p><h1>Sign in to play async chess with friends.</h1><p>Google sign-in is required before choosing a unique username.</p><SignInButton /></section>;
}
