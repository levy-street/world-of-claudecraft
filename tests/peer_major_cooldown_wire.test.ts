import { describe, expect, it } from 'vitest';
import { SPENT_COOLDOWN_UNKNOWN_REMAINING } from '../src/net/peer_major_cooldown_wire';
import { STABLE_TIMER_WIRE_VERSION } from '../src/world_api';
import { bareClient } from './helpers/bare_client';
import { expectDefined } from './helpers/defined';

const MEDALLION = 'trinket:medallion_of_defiance';
const FACT = 'system_medallion_use';

function player(id: number) {
  return {
    id,
    k: 'player',
    tid: 'warrior',
    nm: `Player${id}`,
    lv: 20,
    x: 0,
    y: 0,
    z: 0,
    f: 0,
    hp: 100,
    mhp: 100,
  };
}

function fixture() {
  const world = bareClient(1);
  const wire = world as unknown as {
    applySnapshot(snapshot: unknown): void;
    onMessage(raw: string): void;
  };
  const apply = (
    time: number,
    self: Record<string, unknown>,
    ents: unknown[] = [],
    keep: number[] = [],
  ) => wire.applySnapshot({ t: 'snap', tw: STABLE_TIMER_WIRE_VERSION, time, self, ents, keep });
  const spectate = (name: string | null) => wire.onMessage(JSON.stringify({ t: 'spectate', name }));
  const cooldowns = (id: number) => expectDefined(world.entities.get(id)).cooldowns;
  return { world, apply, spectate, cooldowns };
}

describe('peer cooldown ownership through ClientWorld snapshots', () => {
  it.each(['null', 'missing', 'replacement'] as const)(
    'replaces former self cooldowns on a whole peer %s channel across spectate and exit',
    (mode) => {
      const { world, apply, spectate, cooldowns } = fixture();
      apply(1000, {
        ...player(1),
        auras: [],
        mcd: null,
        cds: {
          avatar: 1042,
          recklessness: 1120,
          mortal_strike: 1008,
          system_unstuck: 1300,
          [MEDALLION]: 1100,
          [FACT]: 1100,
        },
      });
      expect(cooldowns(1).get('avatar')).toBe(42);
      expect(cooldowns(1).get('recklessness')).toBe(120);

      spectate('Player2');
      const incoming = mode === 'missing' ? {} : { mcd: mode === 'null' ? null : ['avatar'] };
      apply(
        1001,
        {
          ...player(2),
          auras: [],
          mcd: null,
          cds: {
            avatar: 1081,
            recklessness: 1141,
            mortal_strike: 1101,
            system_unstuck: 1301,
            [MEDALLION]: 1111,
            [FACT]: 1111,
          },
        },
        [{ ...player(1), auras: [], ...incoming }],
      );
      expect(world.playerId).toBe(2);
      expect(cooldowns(1).has('recklessness')).toBe(false);
      expect(cooldowns(1).get('avatar')).toBe(
        mode === 'replacement' ? SPENT_COOLDOWN_UNKNOWN_REMAINING : undefined,
      );
      expect(cooldowns(1).has(MEDALLION)).toBe(false);
      expect(cooldowns(1).has(FACT)).toBe(false);
      // Other mirror consumers may still own nontracked ability/system keys.
      expect(cooldowns(1).get('mortal_strike')).toBe(8);
      expect(cooldowns(1).get('system_unstuck')).toBe(300);
      expect(cooldowns(2).get('avatar')).toBe(80);
      expect(cooldowns(2).get(FACT)).toBe(110);

      // A lite record, even with an mcd field, does not replace the aura channel.
      apply(1011, { id: 2 }, [{ id: 1, x: 1, mcd: null }]);
      expect(cooldowns(1).get('avatar')).toBe(
        mode === 'replacement' ? SPENT_COOLDOWN_UNKNOWN_REMAINING : undefined,
      );
      apply(1021, { id: 2 }, [], [1]);
      expect(cooldowns(1).get('avatar')).toBe(
        mode === 'replacement' ? SPENT_COOLDOWN_UNKNOWN_REMAINING : undefined,
      );
      expect(cooldowns(1).has('recklessness')).toBe(false);
      expect(cooldowns(2).get('avatar')).toBe(60);
      expect(cooldowns(2).get('recklessness')).toBe(120);
      expect(cooldowns(2).get(FACT)).toBe(90);

      spectate(null);
      expect(world.playerId).toBe(1);
      apply(
        1022,
        {
          ...player(1),
          auras: [],
          mcd: null,
          cds: {
            avatar: 1182,
            recklessness: 1242,
            mortal_strike: 1030,
            system_unstuck: 1322,
            [MEDALLION]: 1142,
            [FACT]: 1142,
          },
        },
        [{ ...player(2), auras: [], mcd: ['recklessness'] }],
      );
      expect(world.spectating).toBeNull();
      expect(cooldowns(1).get('avatar')).toBe(160);
      expect(cooldowns(1).get('recklessness')).toBe(220);
      expect(cooldowns(1).get(FACT)).toBe(120);
      expect(cooldowns(2).has('avatar')).toBe(false);
      expect(cooldowns(2).get('recklessness')).toBe(SPENT_COOLDOWN_UNKNOWN_REMAINING);
      expect(cooldowns(2).has(MEDALLION)).toBe(false);
      expect(cooldowns(2).has(FACT)).toBe(false);
      expect(cooldowns(2).get('mortal_strike')).toBe(80);
      expect(cooldowns(2).get('system_unstuck')).toBe(280);
      apply(1032, { id: 1, auras: [], mcd: null }, [], [2]);
      expect(cooldowns(1).get('avatar')).toBe(150);
      expect(cooldowns(1).get('recklessness')).toBe(210);
      expect(cooldowns(1).get(FACT)).toBe(110);
      expect(cooldowns(2).get('recklessness')).toBe(SPENT_COOLDOWN_UNKNOWN_REMAINING);
      expect(cooldowns(2).has('avatar')).toBe(false);
      // No peer deadline exists: only an explicit whole channel ends a spent state.
      apply(1060, { id: 1 }, [{ id: 2, x: 2 }]);
      expect(cooldowns(2).get('recklessness')).toBe(SPENT_COOLDOWN_UNKNOWN_REMAINING);
      apply(1061, { id: 1 }, [{ id: 2, auras: [], mcd: null }]);
      expect(cooldowns(2).has('avatar')).toBe(false);
      expect(cooldowns(2).has('recklessness')).toBe(false);
      expect(cooldowns(2).get('mortal_strike')).toBe(80);
      expect(cooldowns(2).get('system_unstuck')).toBe(280);
    },
  );

  it('cleans tracked keys when switching between watched selves, before exiting', () => {
    const { world, apply, spectate, cooldowns } = fixture();
    apply(1000, { ...player(1), auras: [], cds: { avatar: 1080 } });
    spectate('Player2');
    apply(1001, { ...player(2), auras: [], cds: { avatar: 1043, recklessness: 1121 } }, [
      { ...player(1), auras: [], mcd: null },
    ]);
    expect(world.playerId).toBe(2);
    expect(cooldowns(2).get('avatar')).toBe(42);
    spectate('Player3');
    apply(
      1002,
      { ...player(3), auras: [], cds: { avatar: 1072, recklessness: 1092 } },
      [{ ...player(2), auras: [], mcd: ['recklessness'] }],
      [1],
    );
    expect(world.playerId).toBe(3);
    expect(cooldowns(2).has('avatar')).toBe(false);
    expect(cooldowns(2).get('recklessness')).toBe(SPENT_COOLDOWN_UNKNOWN_REMAINING);
    expect(cooldowns(3).get('avatar')).toBe(70);
    spectate(null);
    apply(
      1003,
      { ...player(1), auras: [], cds: { avatar: 1083 } },
      [{ ...player(3), auras: [], mcd: null }],
      [2],
    );
    expect(world.playerId).toBe(1);
    expect(world.spectating).toBeNull();
    expect(cooldowns(1).get('avatar')).toBe(80);
    expect(cooldowns(3).has('avatar')).toBe(false);
    expect(cooldowns(3).has('recklessness')).toBe(false);
    apply(1013, { id: 1 }, [], [2, 3]);
    expect(cooldowns(2).get('recklessness')).toBe(SPENT_COOLDOWN_UNKNOWN_REMAINING);
    expect(cooldowns(3).size).toBe(0);
    expect(cooldowns(1).get('avatar')).toBe(70);
  });

  it('keeps missing mcd on a legacy whole peer record as empty truth', () => {
    const world = bareClient(1);
    const wire = world as unknown as {
      applySnapshot(snapshot: unknown): void;
      onMessage(raw: string): void;
    };
    wire.applySnapshot({
      t: 'snap',
      ents: [],
      self: {
        ...player(1),
        auras: [],
        cds: { avatar: 42, recklessness: 120, mortal_strike: 7, [MEDALLION]: 80, [FACT]: 80 },
      },
    });
    wire.onMessage(JSON.stringify({ t: 'spectate', name: 'Player2' }));
    wire.applySnapshot({
      t: 'snap',
      ents: [{ ...player(1), auras: [] }],
      self: { ...player(2), auras: [], cds: { avatar: 12, recklessness: 90 } },
    });
    expect(Object.fromEntries(expectDefined(world.entities.get(1)).cooldowns)).toEqual({
      mortal_strike: 7,
    });
    expect(Object.fromEntries(expectDefined(world.entities.get(2)).cooldowns)).toEqual({
      avatar: 12,
      recklessness: 90,
    });
  });
});
