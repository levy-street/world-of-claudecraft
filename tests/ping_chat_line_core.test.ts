// The chat callout a ping writes, pure half (src/ui/hud/pings/ping_chat_line_core.ts):
// the parts (sender, callout in the kind colour, unit name in its reaction
// colour), the kind classes that carry the --color-ping-* tokens, the unit
// reaction rule, and a locale's own word order (Japanese puts the unit first).

import { afterEach, describe, expect, it } from 'vitest';
import {
  type PartyPing,
  PING_ASSIST,
  PING_ATTACK,
  PING_KIND_COUNT,
  PING_LOOK,
  PING_ON_MY_WAY,
  PING_WARNING,
} from '../src/sim/social/party_pings';
import {
  pingChatLineModel,
  pingKindClass,
  pingTargetReaction,
} from '../src/ui/hud/pings/ping_chat_line_core';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

setLanguage('en');

const p = (over: Partial<PartyPing> = {}) => ({
  kind: PING_LOOK,
  fromName: 'Jose',
  target: null as number | null,
  ...over,
});

describe('ping chat line: the parts', () => {
  it('a unit ping: sender, the callout words, then the unit with its reaction', () => {
    const m = pingChatLineModel(p({ kind: PING_ATTACK, target: 7 }), {
      name: 'Training Effigy',
      reaction: 'neutral',
    });
    expect(m.plain).toBe('Jose: Attack Training Effigy');
    expect(m.kindClass).toBe('ping-kind-1');
    expect(m.parts).toEqual([
      { part: 'sender', text: 'Jose' },
      { part: 'text', text: ': ' },
      { part: 'callout', text: 'Attack ' },
      { part: 'target', text: 'Training Effigy', reaction: 'neutral' },
    ]);
  });

  it('a ground ping: the sender and the kind, nothing else', () => {
    const m = pingChatLineModel(p(), null);
    expect(m.plain).toBe('Jose: Look Here');
    expect(m.parts).toEqual([
      { part: 'sender', text: 'Jose' },
      { part: 'text', text: ': ' },
      { part: 'callout', text: 'Look Here' },
    ]);
  });

  it('each kind reads its own callout on a unit', () => {
    const line = (kind: number) =>
      pingChatLineModel(p({ kind, target: 2 }), { name: 'Bet', reaction: 'friendly' }).plain;
    expect(line(PING_ATTACK)).toBe('Jose: Attack Bet');
    expect(line(PING_ASSIST)).toBe('Jose: Assist Bet');
    expect(line(PING_WARNING)).toBe('Jose: Warning, Bet');
    expect(line(PING_ON_MY_WAY)).toBe('Jose: On my way to Bet');
    expect(line(PING_LOOK)).toBe('Jose: Look at Bet');
  });

  it('a unit this client cannot name reads as the plain callout', () => {
    expect(pingChatLineModel(p({ kind: PING_ATTACK, target: 2 }), null).plain).toBe('Jose: Attack');
    expect(
      pingChatLineModel(p({ kind: PING_ATTACK, target: 2 }), { name: '', reaction: 'hostile' })
        .plain,
    ).toBe('Jose: Attack');
  });

  it('every kind has its own colour class, an unknown kind falls back to Look Here', () => {
    const classes = new Set<string>();
    for (let k = 0; k < PING_KIND_COUNT; k++) classes.add(pingKindClass(k));
    expect([...classes]).toEqual([
      'ping-kind-0',
      'ping-kind-1',
      'ping-kind-2',
      'ping-kind-3',
      'ping-kind-4',
    ]);
    expect(pingKindClass(99)).toBe('ping-kind-0');
  });
});

describe('ping chat line: the unit reaction', () => {
  it('a live unit answers for itself', () => {
    expect(pingTargetReaction('mob', { attackable: true, hostile: true })).toBe('hostile');
    // Attackable but not wild hostile: a training dummy, a critter.
    expect(pingTargetReaction('mob', { attackable: true, hostile: false })).toBe('neutral');
    // A friendly pet or escort.
    expect(pingTargetReaction('mob', { attackable: false, hostile: false })).toBe('friendly');
    expect(pingTargetReaction('player', { attackable: true, hostile: false })).toBe('hostile');
    expect(pingTargetReaction('player', { attackable: false, hostile: false })).toBe('friendly');
    expect(pingTargetReaction('npc', { attackable: false, hostile: false })).toBe('friendly');
    expect(pingTargetReaction('object', { attackable: false, hostile: false })).toBe('neutral');
  });

  it('a unit out of view is guessed from its kind', () => {
    expect(pingTargetReaction('mob', null)).toBe('hostile');
    expect(pingTargetReaction('player', null)).toBe('friendly');
    expect(pingTargetReaction('npc', null)).toBe('friendly');
    expect(pingTargetReaction('object', null)).toBe('neutral');
  });
});

describe('ping chat line: a locale keeps its word order', () => {
  afterEach(() => setLanguage('en'));

  it('Japanese puts the unit before the verb, and the colon is its own', async () => {
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const m = pingChatLineModel(p({ kind: PING_ATTACK, target: 7 }), {
      name: 'ウルフ',
      reaction: 'hostile',
    });
    expect(m.parts).toEqual([
      { part: 'sender', text: 'Jose' },
      { part: 'text', text: '：' },
      { part: 'target', text: 'ウルフ', reaction: 'hostile' },
      { part: 'callout', text: 'を攻撃' },
    ]);
  });
});
