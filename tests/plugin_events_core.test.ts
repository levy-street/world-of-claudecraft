import { describe, expect, it } from 'vitest';
import { type SimEvent, xpForLevel } from '../src/sim/types';
import {
  buildPlayerSnapshot,
  mapSimEventForPlugins,
  type PluginPlayerSource,
} from '../src/ui/plugins/plugin_events_core';

describe('mapSimEventForPlugins', () => {
  it('maps damage to combat with outcome taken from ev.kind', () => {
    const ev: SimEvent = {
      type: 'damage',
      sourceId: 1,
      targetId: 2,
      amount: 34,
      crit: true,
      school: 'fire',
      ability: 'fireball',
      kind: 'hit',
    };
    expect(mapSimEventForPlugins(ev)).toEqual({
      type: 'combat',
      data: {
        kind: 'damage',
        sourceId: 1,
        targetId: 2,
        amount: 34,
        crit: true,
        school: 'fire',
        ability: 'fireball',
        outcome: 'hit',
      },
    });
    const dodged: SimEvent = { ...ev, kind: 'dodge', crit: false, ability: null };
    expect(mapSimEventForPlugins(dodged)?.data.outcome).toBe('dodge');
  });

  it('maps heal and death to combat', () => {
    expect(mapSimEventForPlugins({ type: 'heal', targetId: 5, amount: 120 })).toEqual({
      type: 'combat',
      data: { kind: 'heal', targetId: 5, amount: 120 },
    });
    expect(mapSimEventForPlugins({ type: 'death', entityId: 9, killerId: 3 })).toEqual({
      type: 'combat',
      data: { kind: 'death', entityId: 9, killerId: 3 },
    });
  });

  it('maps xp (rested defaults to 0) and levelup', () => {
    expect(mapSimEventForPlugins({ type: 'xp', amount: 250, rested: 50 })).toEqual({
      type: 'xp',
      data: { amount: 250, rested: 50 },
    });
    expect(mapSimEventForPlugins({ type: 'xp', amount: 80 })).toEqual({
      type: 'xp',
      data: { amount: 80, rested: 0 },
    });
    expect(mapSimEventForPlugins({ type: 'levelup', level: 7 })).toEqual({
      type: 'levelup',
      data: { level: 7 },
    });
  });

  it('maps both loot kinds: text and lootRoll', () => {
    expect(
      mapSimEventForPlugins({ type: 'loot', text: 'You receive loot: [Worn Sword].' }),
    ).toEqual({
      type: 'loot',
      data: { kind: 'text', text: 'You receive loot: [Worn Sword].' },
    });
    const roll: SimEvent = {
      type: 'lootRoll',
      rollId: 4,
      itemId: 'iron_axe',
      itemName: 'Iron Axe',
      quality: 'rare',
      expiresAt: 1234,
    };
    expect(mapSimEventForPlugins(roll)).toEqual({
      type: 'loot',
      data: { kind: 'roll', itemId: 'iron_axe', itemName: 'Iron Axe', quality: 'rare' },
    });
  });

  it('maps chat, defaulting a missing channel to say', () => {
    const whisper: SimEvent = {
      type: 'chat',
      fromPid: 7,
      from: 'Aki',
      text: 'psst',
      channel: 'whisper',
    };
    expect(mapSimEventForPlugins(whisper)).toEqual({
      type: 'chat',
      data: { from: 'Aki', fromPid: 7, channel: 'whisper', text: 'psst' },
    });
    const bare: SimEvent = { type: 'chat', fromPid: 7, from: 'Aki', text: 'hello' };
    expect(mapSimEventForPlugins(bare)?.data.channel).toBe('say');
  });

  it('maps the four quest events to their stages', () => {
    expect(mapSimEventForPlugins({ type: 'questAccepted', questId: 'q1' })).toEqual({
      type: 'quest',
      data: { stage: 'accepted', questId: 'q1' },
    });
    const progress: SimEvent = {
      type: 'questProgress',
      questId: 'q1',
      objectiveIndex: 1,
      current: 3,
      required: 8,
      text: 'Boars slain: 3/8',
    };
    expect(mapSimEventForPlugins(progress)).toEqual({
      type: 'quest',
      data: { stage: 'progress', questId: 'q1', objectiveIndex: 1, current: 3, required: 8 },
    });
    expect(mapSimEventForPlugins({ type: 'questReady', questId: 'q1' })).toEqual({
      type: 'quest',
      data: { stage: 'ready', questId: 'q1' },
    });
    expect(mapSimEventForPlugins({ type: 'questDone', questId: 'q1' })).toEqual({
      type: 'quest',
      data: { stage: 'done', questId: 'q1' },
    });
  });

  it('maps playerDeath to death, respawn, and deedUnlocked with a boolean retro flag', () => {
    expect(mapSimEventForPlugins({ type: 'playerDeath' })).toEqual({ type: 'death', data: {} });
    expect(mapSimEventForPlugins({ type: 'respawn' })).toEqual({ type: 'respawn', data: {} });
    expect(mapSimEventForPlugins({ type: 'deedUnlocked', deedId: 'first_blood' })).toEqual({
      type: 'deed',
      data: { deedId: 'first_blood', retro: false },
    });
    expect(
      mapSimEventForPlugins({ type: 'deedUnlocked', deedId: 'first_blood', retro: true }),
    ).toEqual({ type: 'deed', data: { deedId: 'first_blood', retro: true } });
  });

  it('returns null for events outside the v1 vocabulary', () => {
    const unmapped: SimEvent[] = [
      { type: 'aura', targetId: 2, name: 'Rend', gained: true },
      { type: 'castStart', entityId: 1, ability: 'fireball', time: 1.5 },
      { type: 'vendor', action: 'buy', itemId: 'worn_sword' },
      { type: 'mailArrived', senderName: 'Postmaster' },
      { type: 'comboPoint', points: 3 },
    ];
    for (const ev of unmapped) expect(mapSimEventForPlugins(ev)).toBeNull();
  });
});

describe('buildPlayerSnapshot', () => {
  function source(): PluginPlayerSource {
    return {
      player: {
        id: 5,
        name: 'Aki',
        level: 7,
        hp: 88,
        maxHp: 120,
        pos: { x: 12.34, y: 3.7, z: -7.777 },
      },
      xp: 450,
      copper: 12345,
    };
  }

  it('reads the source fields, xpNext from xpForLevel, and rounds x/z to one decimal', () => {
    expect(buildPlayerSnapshot(source())).toEqual({
      id: 5,
      name: 'Aki',
      level: 7,
      hp: 88,
      hpMax: 120,
      xp: 450,
      xpNext: xpForLevel(7),
      copper: 12345,
      x: 12.3,
      z: -7.8,
    });
  });

  it('returns a fresh object each call: mutating one affects neither the source nor the next', () => {
    const src = source();
    const first = buildPlayerSnapshot(src);
    const second = buildPlayerSnapshot(src);
    expect(second).not.toBe(first);
    first.hp = 1;
    first.name = 'Mallory';
    expect(src.player.hp).toBe(88);
    expect(src.player.name).toBe('Aki');
    expect(buildPlayerSnapshot(src)).toEqual(second);
  });
});
