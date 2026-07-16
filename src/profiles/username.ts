export type UsernameValidation =
  | { ok: true; username: string }
  | { ok: false; message: string };

const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

export function validateUsername(input: FormDataEntryValue | null): UsernameValidation {
  if (typeof input !== 'string') return { ok: false, message: 'Username is required.' };
  const username = input.trim().toLowerCase();
  if (username.length < 3) return { ok: false, message: 'Username must be at least 3 characters.' };
  if (username.length > 24) return { ok: false, message: 'Username must be at most 24 characters.' };
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, message: 'Username may only contain letters, numbers, and underscores.' };
  }
  return { ok: true, username };
}
