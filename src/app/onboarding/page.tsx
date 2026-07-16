import { redirect } from 'next/navigation';
import { requireUser } from '@/auth/session';
import { prisma } from '@/auth/prisma';
import { OnboardingForm } from './Form';

export default async function OnboardingPage() {
  const user = await requireUser();
  const existing = await prisma.profile.findUnique({ where: { googleSub: user.id } });
  if (existing) redirect('/');
  return <section className="card stack"><h1>Choose your ChessRiot username.</h1><p className="muted">Usernames are globally unique and required before accessing games or friends.</p><OnboardingForm /></section>;
}
