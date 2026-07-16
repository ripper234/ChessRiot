'use client';

import { signIn, signOut } from 'next-auth/react';

export function SignInButton() {
  return <button className="button" onClick={() => signIn('google', { callbackUrl: '/' })}>Continue with Google</button>;
}

export function SignOutButton() {
  return <button className="button" onClick={() => signOut({ callbackUrl: '/sign-in' })}>Sign out</button>;
}
