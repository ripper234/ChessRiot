'use server';

import { redirect } from 'next/navigation';
import { requireUser } from '@/auth/session';
import { prisma } from '@/auth/prisma';
import { validateUsername } from '@/profiles/username';

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

export async function completeOnboarding(_prevState: string | null, formData: FormData) {
  const user = await requireUser();
  const result = validateUsername(formData.get('username'));
  if (!result.ok) return result.message;
  if (!user.email) return 'Google account email is required.';
  try {
    await prisma.profile.create({ data: { googleSub: user.id, email: user.email, username: result.username, displayName: user.name } });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return 'That username is already taken.';
    }
    throw error;
  }
  redirect('/');
}
