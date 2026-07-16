import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from './options';
import { prisma } from './prisma';

export async function requireUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/sign-in');
  return session.user;
}

export async function requireOnboardedUser() {
  const user = await requireUser();
  const profile = await prisma.profile.findUnique({ where: { googleSub: user.id } });
  if (!profile) redirect('/onboarding');
  return { user, profile };
}
