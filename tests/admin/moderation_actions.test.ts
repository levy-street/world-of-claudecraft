import { describe, expect, it } from 'vitest';
import {
  addNote,
  banAccount,
  chatMuteCustom,
  chatMuteHours,
  forceRename,
  liftChatMute,
  resetPassword,
  suspendCustom,
  suspendHours,
  unbanAccount,
  unsuspendAccount,
} from '../../src/admin/moderation_actions';

// Pure validation + endpoint/body shaping for the moderation actions. Runs in the
// default Node env (no DOM): exercises the note-required and custom-expiry guards and
// pins the request each action sends.

describe('moderation_actions', () => {
  it('requires a note for suspend/ban/unban/chat-mute/force-rename', () => {
    expect(suspendHours(5, 24, '')).toEqual({ errorKey: 'alert.noteRequired' });
    expect(banAccount(5, '')).toEqual({ errorKey: 'alert.noteRequired' });
    expect(unbanAccount(5, '')).toEqual({ errorKey: 'alert.noteRequired' });
    expect(unsuspendAccount(5, '')).toEqual({ errorKey: 'alert.noteRequired' });
    expect(chatMuteHours(5, 1, '')).toEqual({ errorKey: 'alert.noteRequired' });
    expect(liftChatMute(5, '')).toEqual({ errorKey: 'alert.noteRequired' });
    expect(forceRename(9, 'Foo', '')).toEqual({ errorKey: 'alert.noteRequired' });
  });

  it('builds a suspend request with the right endpoint, reason, and future expiry', () => {
    const built = suspendHours(42, 24, 'harassment');
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.endpoint).toBe('/admin/api/moderation/accounts/42/suspend');
    const body = built.pending.body as { reason: string; expiresAt: string };
    expect(body.reason).toBe('harassment');
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(built.pending.danger).toBeUndefined();
  });

  it('marks ban as danger and posts to the ban endpoint', () => {
    const built = banAccount(42, 'cheating');
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.endpoint).toBe('/admin/api/moderation/accounts/42/ban');
    expect(built.pending.danger).toBe(true);
  });

  it('builds an unsuspend request without changing ban state', () => {
    const built = unsuspendAccount(42, 'appeal accepted');
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.endpoint).toBe('/admin/api/moderation/accounts/42/unsuspend');
    expect(built.pending.body).toEqual({ reason: 'appeal accepted' });
  });

  it('validates custom suspend expiry: required then must be in the future', () => {
    expect(suspendCustom(7, '', 'note')).toEqual({ errorKey: 'alert.customExpiryRequired' });
    expect(suspendCustom(7, 'not-a-date', 'note')).toEqual({
      errorKey: 'alert.customExpiryRequired',
    });
    // datetime-local values are local-time strings; use unambiguous far past/future.
    expect(suspendCustom(7, '2000-01-01T00:00', 'note')).toEqual({
      errorKey: 'alert.customExpiryFuture',
    });
    const ok = suspendCustom(7, '2999-01-01T00:00', 'note');
    expect('pending' in ok).toBe(true);
  });

  it('uses the chat-mute custom-required key for custom chat mute', () => {
    expect(chatMuteCustom(7, '', 'note')).toEqual({ errorKey: 'alert.customChatMuteRequired' });
  });

  it('builds an audited chat unmute request', () => {
    const built = liftChatMute(42, 'appeal accepted');
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.endpoint).toBe('/admin/api/moderation/accounts/42/lift-mute');
    expect(built.pending.body).toEqual({ reason: 'appeal accepted' });
  });

  it('requires text for a note', () => {
    expect(addNote(42, '')).toEqual({ errorKey: 'alert.noteRequired' });
  });

  it('builds a non-punitive note request with the note carried in reason', () => {
    const built = addNote(42, 'spoke to player, watching for repeat behavior');
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.endpoint).toBe('/admin/api/moderation/accounts/42/note');
    expect(built.pending.body).toEqual({
      reason: 'spoke to player, watching for repeat behavior',
    });
    expect(built.pending.danger).toBeUndefined();
  });

  it('requires a note and an in-bounds password for a password reset', () => {
    expect(resetPassword(42, 'newpass123', '')).toEqual({ errorKey: 'alert.noteRequired' });
    expect(resetPassword(42, 'abc', 'lost account')).toEqual({
      errorKey: 'alert.passwordLength',
    });
    expect(resetPassword(42, 'x'.repeat(129), 'lost account')).toEqual({
      errorKey: 'alert.passwordLength',
    });
  });

  it('marks password reset as danger and never renders the password in a row', () => {
    const built = resetPassword(42, 'newpass123', 'owner verified over email');
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.endpoint).toBe('/admin/api/accounts/42/reset-password');
    expect(built.pending.body).toEqual({
      password: 'newpass123',
      reason: 'owner verified over email',
    });
    expect(built.pending.danger).toBe(true);
    for (const row of built.pending.rows) {
      expect(row.value).not.toContain('newpass123');
    }
  });

  it('force-rename posts to the character endpoint', () => {
    const built = forceRename(13, 'Badname', 'offensive');
    if (!('pending' in built)) throw new Error('expected pending');
    expect(built.pending.endpoint).toBe('/admin/api/moderation/characters/13/force-rename');
    expect((built.pending.body as { reason: string }).reason).toBe('offensive');
  });
});
