// @vitest-environment happy-dom
// The Smith's Heart's one tank swap alert (Jose's rule of 2026-11-24): the
// sim's swap table (encounters/smith_heart/tank_swap_ids.ts: which debuff, at
// how many stacks, per boss and tier), the pure view core
// (src/ui/hud/dungeon/tank_swap_alert_view.ts: Swap for the tank carrying it,
// nothing for anyone else, the other tank included) and the composer's mount
// (DungeonPrompts: every hints setting, off the shared slot).

import { afterEach, describe, expect, it } from 'vitest';
import { BREATH_AURAS, BREATH_DIFFICULTY } from '../src/sim/encounters/smith_heart/breath_ids';
import { COUNCIL_AURAS, COUNCIL_TUNING } from '../src/sim/encounters/smith_heart/council_ids';
import { ELEMENT_TUNING, STRIKE_AURAS } from '../src/sim/encounters/smith_heart/final_elements_ids';
import { HEAT_AURAS, HEAT_TUNING } from '../src/sim/encounters/smith_heart/heat_ids';
import { QUENCH_AURAS, QUENCH_DIFFICULTY } from '../src/sim/encounters/smith_heart/quench_ids';
import {
  HEART_TANK_SWAPS,
  heartTankSwapAt,
  heartTankSwapOf,
} from '../src/sim/encounters/smith_heart/tank_swap_ids';
import { DungeonPrompts, type DungeonPromptsFrame } from '../src/ui/hud/dungeon/dungeon_prompts';
import {
  buildTankSwapAlertView,
  type TankSwapAlertInput,
  type TankSwapAura,
  type TankSwapBody,
} from '../src/ui/hud/dungeon/tank_swap_alert_view';
import { setLanguage } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';

setLanguage('en');

const TIERS = ['normal', 'heroic', 'mythic'] as const;
const BOSS = 900;
const TANK_A = 1;
const TANK_B = 2;
const HEALER = 3;

/** The swap count each boss asks for, per tier: the table the brief lists. */
const EXPECTED: Record<string, Record<(typeof TIERS)[number], number>> = {
  council: { normal: 1, heroic: 1, mythic: 1 },
  breath: { normal: 4, heroic: 3, mythic: 3 },
  heat: { normal: 5, heroic: 5, mythic: 5 },
  quench: { normal: 4, heroic: 3, mythic: 3 },
  final: { normal: 4, heroic: 4, mythic: 4 },
};

/** One boss's swap debuff on a body, as the sim writes it for `tier`. */
function swapAura(
  boss: keyof typeof EXPECTED,
  tier: (typeof TIERS)[number],
  stacks: number,
  over: Partial<TankSwapAura> = {},
): TankSwapAura {
  const base = { stacks, remaining: 15, duration: 30, sourceId: BOSS };
  switch (boss) {
    case 'council':
      return { id: COUNCIL_AURAS.weight, ...base, stacks: undefined, ...over };
    case 'breath':
      return {
        id: BREATH_AURAS.battered,
        ...base,
        value3: BREATH_DIFFICULTY[tier].blowSwap,
        ...over,
      };
    case 'heat':
      return { id: HEAT_AURAS.grip, ...base, ...over };
    case 'quench':
      return {
        id: QUENCH_AURAS.tempered,
        ...base,
        value3: QUENCH_DIFFICULTY[tier].temperSwap,
        ...over,
      };
    default:
      return { id: STRIKE_AURAS.heat, ...base, ...over };
  }
}

/** A raid of two tanks and a healer, the boss on `bossOn`. */
function world(
  a: TankSwapAura[],
  b: TankSwapAura[] = [],
  bossOn: number | null = TANK_A,
  h: TankSwapAura[] = [],
) {
  const bodies = new Map<number, TankSwapBody>([
    [TANK_A, { id: TANK_A, auras: a }],
    [TANK_B, { id: TANK_B, auras: b }],
    [HEALER, { id: HEALER, auras: h }],
    [BOSS, { id: BOSS, auras: [], aggroTargetId: bossOn }],
  ]);
  const view = (selfId: number, over: Partial<TankSwapAlertInput> = {}) =>
    buildTankSwapAlertView({
      self: bodies.get(selfId) as TankSwapBody,
      entity: (id) => bodies.get(id),
      ...over,
    });
  return { bodies, view };
}

describe("the Smith's Heart's swap table (the sim's data)", () => {
  it('names every boss once (the Breath twice: its two halves; the Heat twice: Cinder Grip and Wellspring Brand) and only swap debuffs', () => {
    expect(HEART_TANK_SWAPS.map((s) => s.boss)).toEqual([
      'council',
      'breath',
      'breath',
      'heat',
      'heat',
      'quench',
      'final',
    ]);
    expect(heartTankSwapOf(COUNCIL_AURAS.weight)?.boss).toBe('council');
    expect(heartTankSwapOf(BREATH_AURAS.battered)?.boss).toBe('breath');
    expect(heartTankSwapOf(BREATH_AURAS.thunderLaden)?.boss).toBe('breath');
    expect(heartTankSwapOf(HEAT_AURAS.grip)?.boss).toBe('heat');
    expect(heartTankSwapOf(HEAT_AURAS.brand)?.boss).toBe('heat');
    expect(heartTankSwapOf(HEAT_AURAS.brand)?.swapAt).toBe(1);
    expect(heartTankSwapOf(QUENCH_AURAS.tempered)?.boss).toBe('quench');
    for (const id of Object.values(STRIKE_AURAS)) expect(heartTankSwapOf(id)?.boss).toBe('final');
    // The Elemental Strike's four debuffs are ONE family (a strike re-forges them).
    expect(new Set(Object.values(STRIKE_AURAS).map(heartTankSwapOf)).size).toBe(1);
    expect(heartTankSwapOf(BREATH_AURAS.blowMark)).toBeNull();
    expect(heartTankSwapOf(QUENCH_AURAS.cold)).toBeNull();
  });

  it('pins the fixed counts and leaves the tiered ones to the aura (value3)', () => {
    expect(COUNCIL_TUNING.weightSwap).toBe(1);
    expect(HEAT_TUNING.gripSwap).toBe(5);
    expect(HEAT_TUNING.gripSwap).toBeLessThanOrEqual(HEAT_TUNING.gripMaxStacks);
    expect(ELEMENT_TUNING.swapAt).toBe(4);
    expect(ELEMENT_TUNING.swapAt).toBeLessThanOrEqual(ELEMENT_TUNING.stackCap);
    const by = (id: string) => heartTankSwapOf(id);
    expect(by(BREATH_AURAS.battered)?.swapAt).toBeNull();
    expect(by(QUENCH_AURAS.tempered)?.swapAt).toBeNull();
    for (const tier of TIERS) {
      expect(BREATH_DIFFICULTY[tier].blowSwap, tier).toBe(EXPECTED.breath[tier]);
      expect(BREATH_DIFFICULTY[tier].thunderSwap, tier).toBe(EXPECTED.breath[tier]);
      expect(QUENCH_DIFFICULTY[tier].temperSwap, tier).toBe(EXPECTED.quench[tier]);
    }
  });

  it('reads the count: the fixed one first, else the value3 (none: never due)', () => {
    const council = heartTankSwapOf(COUNCIL_AURAS.weight);
    const breath = heartTankSwapOf(BREATH_AURAS.battered);
    if (!council || !breath) throw new Error('no swap');
    expect(heartTankSwapAt(council, 9)).toBe(1);
    expect(heartTankSwapAt(breath, 3)).toBe(3);
    expect(heartTankSwapAt(breath, undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(heartTankSwapAt(breath, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('the tank swap alert: who sees what, per boss and tier', () => {
  for (const boss of Object.keys(EXPECTED) as (keyof typeof EXPECTED)[]) {
    for (const tier of TIERS) {
      const at = EXPECTED[boss][tier];
      it(`${boss} ${tier}: Swap at ${at} for the tank, nothing for anyone else`, () => {
        // At the count: the tank carrying it reads Swap with the stacks.
        const due = world([swapAura(boss, tier, at)]);
        const mine = due.view(TANK_A);
        if (!mine.visible) throw new Error('hidden');
        expect(mine.kind).toBe('swap');
        expect(mine.title).toBe(`Swap x${at}`);
        expect(mine.progress).toBeCloseTo(0.5);
        expect(mine.line).toBe('');
        expect(mine.pressable).toBe(false);
        // The other tank reads nothing (no Taunt prompt: Jose, 2026-11-24).
        expect(due.view(TANK_B).visible).toBe(false);
        // A healer reads nothing.
        expect(due.view(HEALER).visible).toBe(false);
        if (at > 1) {
          // One under the count: nothing for anyone.
          const under = world([swapAura(boss, tier, at - 1)]);
          for (const id of [TANK_A, TANK_B, HEALER])
            expect(under.view(id).visible, `${id}`).toBe(false);
        }
      });
    }
  }

  it('the Breath reads both halves: Thunder-Laden calls the swap like Wind-Battered', () => {
    const w = world([
      {
        id: BREATH_AURAS.thunderLaden,
        stacks: 3,
        value3: BREATH_DIFFICULTY.heroic.thunderSwap,
        remaining: 5,
        duration: 25,
        sourceId: BOSS,
      },
    ]);
    const v = w.view(TANK_A);
    expect(v.visible && v.kind).toBe('swap');
    expect(w.view(TANK_B).visible).toBe(false);
  });

  it('once the boss turns to the other tank, both cues go', () => {
    const w = world([swapAura('final', 'heroic', 5)], [], TANK_B);
    expect(w.view(TANK_A).visible).toBe(false);
    expect(w.view(TANK_B).visible).toBe(false);
    // The boss on the healer (a loose boss): the carrier is no longer tanking.
    expect(world([swapAura('heat', 'normal', 6)], [], HEALER).view(TANK_A).visible).toBe(false);
  });

  it('a boss that is out of view or has no target keeps the cue (never hidden on doubt)', () => {
    const lost = world([swapAura('quench', 'heroic', 3, { sourceId: 4242 })]);
    expect(lost.view(TANK_A).visible).toBe(true);
    const free = world([swapAura('quench', 'heroic', 3)], [], null);
    expect(free.view(TANK_A).visible).toBe(true);
  });

  it('the carrier needs no role or group, and the dead read nothing', () => {
    const w = world([swapAura('breath', 'normal', 4)]);
    expect(w.view(TANK_A).visible).toBe(true);
    const dead = w.bodies.get(TANK_A) as TankSwapBody;
    dead.dead = true;
    expect(w.view(TANK_A).visible).toBe(false);
  });

  it('reads a mirror-shaped aura (no stacks for one, no duration) without NaN', () => {
    const w = world([{ id: COUNCIL_AURAS.weight, remaining: 12 }]);
    const v = w.view(TANK_A);
    if (!v.visible) throw new Error('hidden');
    expect(v.title).toBe('Swap x1');
    expect(Number.isFinite(v.progress)).toBe(true);
    expect(v.progressAria).not.toMatch(/\{\w+\}|NaN/);
  });
});

describe('DungeonPrompts: the tank swap alert mounts on every hints setting, off the slot', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function rig(auras: DungeonPromptsFrame['player']['auras'], hints: boolean) {
    const layer = document.createElement('div');
    document.body.appendChild(layer);
    const writers = makeWriterFacet(
      new Map(),
      new WeakMap(),
      new WeakMap(),
      new WeakMap(),
      () => {},
      () => {},
    );
    const prompts = new DungeonPrompts({ layer: () => layer, writers, onPress: () => {} });
    prompts.paint({
      player: { id: TANK_A, pos: { x: 0, z: 0 }, auras },
      world: {
        entities: new Map() as unknown as DungeonPromptsFrame['world']['entities'],
        entityRosterVersion: 1,
        targetEntity: () => {},
      },
      party: null,
      interactKey: 'F',
      touch: false,
      mechanicHints: hints,
    });
    return layer;
  }

  for (const hints of [true, false]) {
    it(`hints ${hints ? 'on' : 'off'}: Swap shows in its own small chip`, () => {
      const layer = rig([{ id: HEAT_AURAS.grip, stacks: 5, remaining: 10, duration: 15 }], hints);
      const el = layer.querySelector<HTMLElement>('#heart-tank-swap');
      expect(el).not.toBeNull();
      expect(el?.style.display).toBe('flex');
      expect(el?.classList.contains('is-swap')).toBe(true);
      expect(el?.querySelector('.fa-title')?.textContent).toBe('Swap x5');
      // Not the shared slot's panel: the Breath's knot alert stays unmounted.
      expect(layer.querySelector('#heart-knot-alert')).toBeNull();
    });
  }

  it('below the count nothing mounts', () => {
    const layer = rig([{ id: HEAT_AURAS.grip, stacks: 4, remaining: 10, duration: 15 }], true);
    expect(layer.querySelector('#heart-tank-swap')).toBeNull();
  });
});
