import { describe, expect, it, vi } from 'vitest';
import {
  cleanRealmMotdText,
  parseRealmMotdArguments,
  REALM_MOTD_MAX,
  REALM_MOTD_NOTICES,
  RealmMotd,
  type RealmMotdStore,
  realmMotdLine,
} from '../server/realm_motd';

type Session = { accountId: number; name: string };

type Frame = { t: string; list: { type: string; text: string; color: string }[] };

function setup(opts: { stored?: string | null; store?: Partial<RealmMotdStore> } = {}) {
  const sessions: Session[] = [
    { accountId: 1, name: 'Admin' },
    { accountId: 2, name: 'Mira' },
    { accountId: 3, name: 'Tor' },
  ];
  const sent: { to: Session; payload: string }[] = [];
  const store: RealmMotdStore = {
    load: vi.fn(async () => opts.stored ?? null),
    save: vi.fn(async () => {}),
    ...opts.store,
  };
  const motd = new RealmMotd<Session>(
    { sessions: () => sessions, sendRaw: (to, payload) => sent.push({ to, payload }) },
    store,
  );
  const textsFor = (session: Session): string[] =>
    sent
      .filter((entry) => entry.to === session)
      .flatMap((entry) => (JSON.parse(entry.payload) as Frame).list.map((ev) => ev.text));
  return { motd, store, sessions, sent, textsFor, admin: sessions[0] };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('parseRealmMotdArguments', () => {
  it('reads show, clear, quoted and bare messages', () => {
    expect(parseRealmMotdArguments('')).toEqual({ op: 'show' });
    expect(parseRealmMotdArguments('   ')).toEqual({ op: 'show' });
    expect(parseRealmMotdArguments('clear')).toEqual({ op: 'clear' });
    expect(parseRealmMotdArguments(' CLEAR ')).toEqual({ op: 'clear' });
    expect(parseRealmMotdArguments('"Maintenance at 22:00"')).toEqual({
      op: 'set',
      text: 'Maintenance at 22:00',
    });
    expect(parseRealmMotdArguments('Maintenance at 22:00')).toEqual({
      op: 'set',
      text: 'Maintenance at 22:00',
    });
  });

  it('treats a quoted "clear" as a message and keeps inner quotes of a bare message', () => {
    expect(parseRealmMotdArguments('"clear"')).toEqual({ op: 'set', text: 'clear' });
    expect(parseRealmMotdArguments('Say "hi" to the new realm')).toEqual({
      op: 'set',
      text: 'Say "hi" to the new realm',
    });
    expect(parseRealmMotdArguments('"a" and "b"')).toEqual({ op: 'set', text: '"a" and "b"' });
  });

  it('asks for usage on an empty message and refuses one over the cap', () => {
    expect(REALM_MOTD_MAX).toBe(240);
    expect(parseRealmMotdArguments('""')).toEqual({ op: 'usage' });
    expect(parseRealmMotdArguments('"   "')).toEqual({ op: 'usage' });
    expect(parseRealmMotdArguments('x'.repeat(REALM_MOTD_MAX))).toEqual({
      op: 'set',
      text: 'x'.repeat(REALM_MOTD_MAX),
    });
    expect(parseRealmMotdArguments('x'.repeat(REALM_MOTD_MAX + 1))).toEqual({ op: 'tooLong' });
    expect(parseRealmMotdArguments(`"${'x'.repeat(REALM_MOTD_MAX + 1)}"`)).toEqual({
      op: 'tooLong',
    });
  });

  it('folds control characters and whitespace runs into single spaces', () => {
    expect(cleanRealmMotdText('  line one\nline\ttwo\u0007end  ')).toBe('line one line two end');
    // Bidi overrides and zero-width marks are dropped outright.
    expect(cleanRealmMotdText('safe\u202Etxt.exe\u200B!')).toBe('safetxt.exe!');
    expect(parseRealmMotdArguments('"a\r\n\r\nb"')).toEqual({ op: 'set', text: 'a b' });
  });
});

describe('RealmMotd', () => {
  it('broadcasts a new message to every online session and confirms to the admin', async () => {
    const { motd, store, sessions, textsFor, admin } = setup();

    motd.handle(admin, { op: 'set', text: 'Double XP tonight' });

    const line = realmMotdLine('Double XP tonight');
    expect(line).toBe('Message of the day: Double XP tonight');
    for (const session of sessions) expect(textsFor(session)).toContain(line);
    expect(textsFor(admin)).toEqual([line, REALM_MOTD_NOTICES.updated]);
    expect(textsFor(sessions[1])).toEqual([line]);
    expect(motd.current).toBe('Double XP tonight');
    await flush();
    expect(store.save).toHaveBeenCalledWith('Double XP tonight', 1);
  });

  it('serializes the message once per change, not once per recipient or join', () => {
    const { motd, sent, sessions, admin } = setup();
    const stringify = vi.spyOn(JSON, 'stringify');
    // Only the event frames count: the structured logger stringifies too.
    const frames = () =>
      stringify.mock.calls.filter(([value]) => (value as { t?: string } | null)?.t === 'events')
        .length;
    try {
      motd.handle(admin, { op: 'set', text: 'Hello' });
      // One greeting payload shared by the three recipients, plus the admin's
      // own confirmation notice.
      expect(frames()).toBe(2);
      for (const session of sessions) motd.greet(session);
      expect(frames()).toBe(2);
    } finally {
      stringify.mockRestore();
    }

    const broadcast = sent.filter((entry) => entry.payload.includes('Message of the day: Hello'));
    expect(broadcast).toHaveLength(6);
    expect(new Set(broadcast.map((entry) => entry.payload)).size).toBe(1);
    expect(JSON.parse(broadcast[0].payload)).toEqual({
      t: 'events',
      list: [{ type: 'log', text: 'Message of the day: Hello', color: '#ffd100' }],
    });
  });

  it('greets a joining player with the current message and stays silent when none is set', async () => {
    const { motd, sessions, textsFor, admin } = setup();
    const joiner = sessions[2];

    motd.greet(joiner);
    expect(textsFor(joiner)).toEqual([]);

    motd.handle(admin, { op: 'set', text: 'Welcome' });
    motd.greet(joiner);
    expect(textsFor(joiner)).toEqual([realmMotdLine('Welcome'), realmMotdLine('Welcome')]);

    motd.handle(admin, { op: 'clear' });
    motd.greet(joiner);
    expect(textsFor(joiner)).toHaveLength(2);
    expect(textsFor(admin).at(-1)).toBe(REALM_MOTD_NOTICES.cleared);
    expect(motd.current).toBeNull();
  });

  it('clears without broadcasting and deletes the stored row', async () => {
    const { motd, store, sessions, textsFor, admin } = setup({ stored: 'Old news' });
    await motd.load();

    motd.handle(admin, { op: 'clear' });

    expect(textsFor(sessions[1])).toEqual([]);
    expect(textsFor(admin)).toEqual([REALM_MOTD_NOTICES.cleared]);
    await flush();
    expect(store.save).toHaveBeenCalledWith(null, 1);
  });

  it('shows the current message, the empty state, usage and the length cap to the admin only', async () => {
    const { motd, sessions, textsFor, admin } = setup();

    motd.handle(admin, { op: 'show' });
    motd.handle(admin, { op: 'usage' });
    motd.handle(admin, { op: 'tooLong' });
    motd.handle(admin, { op: 'set', text: 'Live' });
    motd.handle(admin, { op: 'show' });

    expect(textsFor(admin)).toEqual([
      REALM_MOTD_NOTICES.none,
      REALM_MOTD_NOTICES.usage,
      `The message of the day is limited to ${REALM_MOTD_MAX} characters.`,
      realmMotdLine('Live'),
      REALM_MOTD_NOTICES.updated,
      realmMotdLine('Live'),
    ]);
    expect(textsFor(sessions[1])).toEqual([realmMotdLine('Live')]);
  });

  it('restores the stored message at boot', async () => {
    const { motd, sessions, textsFor } = setup({ stored: 'Persisted' });

    await motd.load();
    motd.greet(sessions[1]);

    expect(motd.current).toBe('Persisted');
    expect(textsFor(sessions[1])).toEqual([realmMotdLine('Persisted')]);
  });

  it('keeps an edit made while the boot load is still in flight', async () => {
    let resolveLoad: (value: string | null) => void = () => {};
    const { motd, admin } = setup({
      store: { load: () => new Promise((resolve) => (resolveLoad = resolve)) },
    });

    const loading = motd.load();
    motd.handle(admin, { op: 'set', text: 'Newer' });
    resolveLoad('Stale');
    await loading;

    expect(motd.current).toBe('Newer');
  });

  it('keeps a clear made while the boot load is still in flight', async () => {
    let resolveLoad: (value: string | null) => void = () => {};
    const { motd, sessions, textsFor, admin } = setup({
      store: { load: () => new Promise((resolve) => (resolveLoad = resolve)) },
    });

    const loading = motd.load();
    motd.handle(admin, { op: 'clear' });
    resolveLoad('Stale');
    await loading;
    motd.greet(sessions[1]);

    expect(motd.current).toBeNull();
    expect(textsFor(sessions[1])).toEqual([]);
  });

  it('survives a failed boot load with no message', async () => {
    const { motd } = setup({
      store: {
        load: async () => {
          throw new Error('db down');
        },
      },
    });

    await expect(motd.load()).resolves.toBeUndefined();
    expect(motd.current).toBeNull();
  });

  it('writes edits in command order even when an earlier save is slow', async () => {
    const order: (string | null)[] = [];
    let releaseFirst: () => void = () => {};
    const save = vi.fn(async (text: string | null) => {
      if (order.length === 0 && text === 'First') {
        await new Promise<void>((resolve) => (releaseFirst = resolve));
      }
      order.push(text);
    });
    const { motd, admin } = setup({ store: { save } });

    motd.handle(admin, { op: 'set', text: 'First' });
    motd.handle(admin, { op: 'set', text: 'Second' });
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    releaseFirst();
    await flush();

    expect(order).toEqual(['First', 'Second']);
    expect(motd.current).toBe('Second');
  });

  it('keeps the message live and warns the admin when the save fails', async () => {
    const save = vi
      .fn<RealmMotdStore['save']>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(undefined);
    const { motd, sessions, textsFor, admin } = setup({ store: { save } });

    motd.handle(admin, { op: 'set', text: 'Unsaved' });
    await flush();

    expect(motd.current).toBe('Unsaved');
    expect(textsFor(admin).at(-1)).toBe(REALM_MOTD_NOTICES.saveFailed);
    expect(textsFor(sessions[1])).toEqual([realmMotdLine('Unsaved')]);

    // The failed save does not wedge the queue: the next edit still writes.
    motd.handle(admin, { op: 'set', text: 'Saved' });
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('Saved', 1);
    expect(textsFor(admin).filter((text) => text === REALM_MOTD_NOTICES.saveFailed)).toHaveLength(
      1,
    );
  });
});
