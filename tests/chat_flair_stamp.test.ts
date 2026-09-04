// The events batch's chat-flair prologue (server/chat_flair_stamp.ts), pinned
// directly as the pure function it is. The end-to-end encoding it produces is
// pinned through the real server in tests/chat_flair.test.ts; these cases own
// the rules the extraction must not lose: chat-only, one resolve per EVENT,
// the staff-role gate, and the compose-both shape.

import { describe, expect, it, vi } from 'vitest';
import { type ChatFlairSources, stampChatSenderFlair } from '../server/chat_flair_stamp';
import type { ChatSenderFlair } from '../src/sim/account_flair';
import type { SimEvent } from '../src/sim/types';

function chat(fromPid: number, text = 'hi'): SimEvent {
  return {
    type: 'chat',
    channel: 'say',
    fromPid,
    from: `P${fromPid}`,
    text,
  } as unknown as SimEvent;
}

function sources(
  flair: Record<number, ChatSenderFlair | undefined>,
  roles: Record<number, string | undefined> = {},
): ChatFlairSources {
  return {
    flairForPid: (pid) => flair[pid],
    discordRoleForPid: (pid) => roles[pid],
  };
}

describe('stampChatSenderFlair', () => {
  it('leaves an ordinary sender bare: no flair key on the event at all', () => {
    const ev = chat(1);
    stampChatSenderFlair([ev], sources({}));
    expect(ev).not.toHaveProperty('flair');
  });

  it('stamps the account flair of the SENDER', () => {
    const ev = chat(1);
    stampChatSenderFlair([ev], sources({ 1: { ai: true } }));
    expect((ev as { flair?: ChatSenderFlair }).flair).toEqual({ ai: true });
  });

  it('composes a staff role WITH the account flair', () => {
    const ev = chat(1);
    stampChatSenderFlair([ev], sources({ 1: { ai: true } }, { 1: 'coredevs' }));
    expect((ev as { flair?: ChatSenderFlair }).flair).toEqual({ ai: true, role: 'coredevs' });
  });

  it('stamps a role-only sender as a clean { role } object', () => {
    const ev = chat(1);
    stampChatSenderFlair([ev], sources({}, { 1: 'coredevs' }));
    expect((ev as { flair?: ChatSenderFlair }).flair).toEqual({ role: 'coredevs' });
  });

  it('never stamps a COMMUNITY role: the chat tag stays a staff authority signal', () => {
    const ev = chat(1);
    stampChatSenderFlair([ev], sources({}, { 1: 'artists' }));
    expect(ev).not.toHaveProperty('flair');
  });

  it('touches nothing but chat events', () => {
    const damage = { type: 'damage', sourceId: 1, targetId: 2, amount: 5 } as unknown as SimEvent;
    stampChatSenderFlair([damage], sources({ 1: { ai: true } }, { 1: 'coredevs' }));
    expect(damage).not.toHaveProperty('flair');
  });

  it('resolves each chat event once, whatever the recipient count would be', () => {
    // The cost claim the extraction preserves: this runs per EVENT, before the
    // per-session fan-out, so two chat lines cost two lookups per source.
    const flairForPid = vi.fn<(pid: number) => ChatSenderFlair | undefined>(() => ({ ai: true }));
    const discordRoleForPid = vi.fn<(pid: number) => string | undefined>(() => undefined);
    stampChatSenderFlair([chat(1), chat(1), { type: 'death' } as unknown as SimEvent], {
      flairForPid,
      discordRoleForPid,
    });
    expect(flairForPid).toHaveBeenCalledTimes(2);
    expect(discordRoleForPid).toHaveBeenCalledTimes(2);
  });
});
