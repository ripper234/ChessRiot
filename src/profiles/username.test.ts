import { describe, expect, it } from 'vitest';
import { validateUsername } from './username';

describe('validateUsername', () => {
  it('normalizes valid usernames', () => {
    expect(validateUsername(' Riot_Player ')).toEqual({ ok: true, username: 'riot_player' });
  });

  it('rejects short usernames', () => {
    expect(validateUsername('ab')).toMatchObject({ ok: false, message: 'Username must be at least 3 characters.' });
  });

  it('rejects unsafe characters', () => {
    expect(validateUsername('riot@example.com')).toMatchObject({ ok: false, message: 'Username may only contain letters, numbers, and underscores.' });
  });
});
