'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { completeOnboarding } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="button" disabled={pending}>{pending ? 'Saving…' : 'Save username'}</button>;
}

export function OnboardingForm() {
  const [error, action] = useFormState(completeOnboarding, null);
  return <form className="stack" action={action}><label className="stack">Username<input className="input" name="username" autoComplete="username" minLength={3} maxLength={24} required /></label>{error ? <p className="error">{error}</p> : null}<SubmitButton /></form>;
}
