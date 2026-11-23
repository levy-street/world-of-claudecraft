// @vitest-environment happy-dom
// The "Dungeon mechanic hints" option (settings.showDungeonHints) in the HUD:
// the pure policy that says which dungeon prompt it governs and who holds the
// shared slot (src/ui/hud/dungeon/dungeon_prompt_policy_core.ts), and the composer
// that consumes it (DungeonPrompts). The setting itself, its options row and
// the graphics-preset independence pin live in
// tests/dungeon_hints_setting.test.ts.

import { afterEach, describe, expect, it } from 'vitest';
import { GRAVEWYRM_SANCTUM_MOBS } from '../src/sim/content/gravewyrm_sanctum';
import { MOBS } from '../src/sim/data';
import {
  moonTileTemplate,
  SELTHE_ID,
  SELTHE_SCORE,
  SELTHE_SCORE_WARD,
} from '../src/sim/encounters/drowned_temple/ids';
import {
  MORTHEN_CANDLE_ID,
  MORTHEN_GRASP_TEMPLATE,
  MORTHEN_GRAVE_CHILL,
} from '../src/sim/encounters/hollow_crypt';
import {
  OLEN_SENTENCED,
  OSSICK_SHACKLED,
  TURNKEY_CAGED,
} from '../src/sim/encounters/sunken_bastion/ids';
import {
  HUNTING_SPEAR_ID,
  ZULGAR_ID,
  ZULGAR_PINNED,
  ZULGAR_PREY,
} from '../src/sim/encounters/wildheart_basin/ids';
import { createMob } from '../src/sim/entity';
import { SANCTUM_BRANDED } from '../src/sim/mob/trash_kit/sanctum_cast_ids';
import type { Entity } from '../src/sim/types';
import {
  DUNGEON_PROMPT_ADVISORY,
  type DungeonPromptId,
  type DungeonPromptSlotState,
  dungeonPromptEnabled,
  usePromptYields,
} from '../src/ui/hud/dungeon/dungeon_prompt_policy_core';
import { DungeonPrompts, type DungeonPromptsFrame } from '../src/ui/hud/dungeon/dungeon_prompts';
import { setLanguage } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';

setLanguage('en');

const ALL_IDS: DungeonPromptId[] = [
  'cage',
  'chain',
  'bastion',
  'wildheart',
  'sanctum',
  'crypt',
  'temple',
  'kitUse',
];

// ---- the pure policy --------------------------------------------------------------

describe('dungeon prompt policy: what the hints setting governs', () => {
  it('classifies every prompt, the five encounter alerts advisory and no other', () => {
    // Literal, so reclassifying a prompt is a deliberate edit here too.
    expect(DUNGEON_PROMPT_ADVISORY).toEqual({
      cage: false,
      chain: false,
      bastion: true,
      wildheart: true,
      sanctum: true,
      crypt: true,
      temple: true,
      kitUse: false,
    });
    expect(Object.keys(DUNGEON_PROMPT_ADVISORY).sort()).toEqual([...ALL_IDS].sort());
  });

  it('with the hints on, every prompt may show', () => {
    for (const id of ALL_IDS) expect(dungeonPromptEnabled(id, true), id).toBe(true);
  });

  it('with the hints off, only the advisory alerts are hidden', () => {
    expect(dungeonPromptEnabled('bastion', false)).toBe(false);
    expect(dungeonPromptEnabled('wildheart', false)).toBe(false);
    expect(dungeonPromptEnabled('sanctum', false)).toBe(false);
    expect(dungeonPromptEnabled('crypt', false)).toBe(false);
    expect(dungeonPromptEnabled('temple', false)).toBe(false);
    // The prompts a player presses or steers by are never governed by it.
    expect(dungeonPromptEnabled('cage', false)).toBe(true);
    expect(dungeonPromptEnabled('chain', false)).toBe(true);
    expect(dungeonPromptEnabled('kitUse', false)).toBe(true);
  });
});

describe('dungeon prompt policy: the shared slot', () => {
  const none: DungeonPromptSlotState = {
    cage: false,
    chain: false,
    bastion: false,
    wildheart: false,
    sanctum: false,
    crypt: false,
    temple: false,
    cryptSoft: false,
    wildheartSoft: false,
  };

  it('nothing showing above: the use prompt takes the slot', () => {
    expect(usePromptYields(none)).toBe(false);
  });

  it('any prompt showing above holds the slot', () => {
    for (const id of [
      'cage',
      'chain',
      'bastion',
      'wildheart',
      'sanctum',
      'crypt',
      'temple',
    ] as const) {
      expect(usePromptYields({ ...none, [id]: true }), id).toBe(true);
    }
  });

  it('a soft Crypt readout does not hold it, alone', () => {
    expect(usePromptYields({ ...none, crypt: true, cryptSoft: true })).toBe(false);
    // The soft flag means nothing without a showing Crypt alert.
    expect(usePromptYields({ ...none, cryptSoft: true })).toBe(false);
  });

  it('a soft Crypt readout beside another showing prompt changes nothing', () => {
    for (const id of ['cage', 'chain', 'bastion', 'wildheart', 'sanctum', 'temple'] as const) {
      expect(usePromptYields({ ...none, crypt: true, cryptSoft: true, [id]: true }), id).toBe(true);
    }
  });

  it('a soft Wildheart alert (a spear to pull) does not hold it, alone', () => {
    expect(usePromptYields({ ...none, wildheart: true, wildheartSoft: true })).toBe(false);
    // The soft flag means nothing without a showing Wildheart alert.
    expect(usePromptYields({ ...none, wildheartSoft: true })).toBe(false);
    for (const id of ['cage', 'chain', 'bastion', 'sanctum', 'crypt', 'temple'] as const) {
      const state = { ...none, wildheart: true, wildheartSoft: true, [id]: true };
      expect(usePromptYields(state), id).toBe(true);
    }
  });
});

// ---- the composer -----------------------------------------------------------------

const BRAZIER = GRAVEWYRM_SANCTUM_MOBS.soul_brazier;

type Auras = DungeonPromptsFrame['player']['auras'];

function rig() {
  const layer = document.createElement('div');
  document.body.appendChild(layer);
  const calls: string[] = [];
  const writers = makeWriterFacet(
    new Map(),
    new WeakMap(),
    new WeakMap(),
    new WeakMap(),
    () => {},
    () => {},
  );
  const prompts = new DungeonPrompts({
    layer: () => layer,
    writers,
    onPress: () => calls.push('interact'),
  });
  const entities = new Map<number, Entity>();
  let version = 1;
  const add = (e: Entity) => {
    entities.set(e.id, e);
    version++;
  };
  const frame = (mechanicHints: boolean, auras: Auras = []): DungeonPromptsFrame => ({
    player: { id: 1, pos: { x: 0, z: 0 }, auras },
    world: {
      entities: entities as unknown as DungeonPromptsFrame['world']['entities'],
      entityRosterVersion: version,
      targetEntity: (id) => calls.push(`target:${id}`),
    },
    party: null,
    interactKey: 'F',
    touch: false,
    mechanicHints,
  });
  const shown = (id: string) => {
    const el = layer.querySelector<HTMLElement>(`#${id}`);
    return el !== null && el.style.display !== 'none';
  };
  return { layer, prompts, calls, frame, add, shown };
}

const brazier = () => createMob(50, BRAZIER, 18, { x: 3, y: 0, z: 0 });
const candle = () => createMob(51, MOBS[MORTHEN_CANDLE_ID], 10, { x: 3, y: 0, z: 0 });
const graspRing = () =>
  ({
    id: 60,
    kind: 'object',
    templateId: MORTHEN_GRASP_TEMPLATE,
    pos: { x: 0, y: 0, z: 0 },
    scale: 4,
    auras: [],
  }) as unknown as Entity;

/** Zulgar's Hunting Spear standing 3 yd off (inside its 4 yd pull) or far off. */
const spear = (x = 3) => createMob(52, MOBS[HUNTING_SPEAR_ID], 20, { x, y: 0, z: 0 });
const zulgar = () => createMob(53, MOBS[ZULGAR_ID], 20, { x: 20, y: 0, z: 0 });
/** Pinned by spear 52; `alone` = nobody stands free to help (value2 1). */
const pinned = (alone: boolean): Auras => [
  { id: ZULGAR_PINNED, sourceId: 52, value2: alone ? 1 : 0, remaining: 8, duration: 10 },
];

/** Choirmother Selthe singing the Score's melody, and one of her moon tiles. */
const seltheSinging = () => {
  const e = createMob(54, MOBS[SELTHE_ID], 16, { x: 20, y: 0, z: 0 });
  e.castingAbility = SELTHE_SCORE;
  e.castRemaining = 3;
  e.castTotal = 5.1;
  e.auras = [
    {
      id: SELTHE_SCORE_WARD,
      name: 'The Score',
      kind: 'buff_dr',
      remaining: 19,
      duration: 20,
      value: 0,
      value2: 0,
      stacks: 3,
      sourceId: 54,
      school: 'frost',
    },
  ];
  return e;
};
const moonTile = () =>
  ({
    id: 61,
    kind: 'object',
    templateId: moonTileTemplate('note', 1),
    pos: { x: 12, y: 0, z: 0 },
    scale: 2.5,
    auras: [],
  }) as unknown as Entity;

const SENTENCED: Auras = [{ id: OLEN_SENTENCED, remaining: 4, duration: 8 }];
const PREY: Auras = [{ id: ZULGAR_PREY, remaining: 4, duration: 8, value2: 1 }];
const BRANDED: Auras = [{ id: SANCTUM_BRANDED, remaining: 6, duration: 12 }];
const RITE: Auras = [{ id: MORTHEN_GRAVE_CHILL, value: 1, value2: 3, remaining: 2, duration: 2 }];

describe('DungeonPrompts: the hints setting hides the advisory alerts only', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const cases: {
    name: string;
    id: string;
    auras: Auras;
    setup?: (r: ReturnType<typeof rig>) => void;
  }[] = [
    { name: "the Sunken Bastion's crown alert", id: 'bastion-alert', auras: SENTENCED },
    { name: "the Wildheart Basin's alert", id: 'wildheart-alert', auras: PREY },
    { name: "the Gravewyrm Sanctum's alert", id: 'sanctum-alert', auras: BRANDED },
    {
      name: "the Hollow Crypt's alert (a strike to leave)",
      id: 'crypt-alert',
      auras: [],
      setup: (r) => r.add(graspRing()),
    },
    { name: "the Hollow Crypt's soft readout (the Rite)", id: 'crypt-alert', auras: RITE },
    {
      name: "the Drowned Temple's alert (Selthe's Score)",
      id: 'temple-alert',
      auras: [],
      setup: (r) => {
        r.add(seltheSinging());
        r.add(moonTile());
      },
    },
  ];

  for (const c of cases) {
    it(`${c.name}: shown with the hints on, hidden with them off, back when turned on again`, () => {
      const r = rig();
      c.setup?.(r);
      r.prompts.paint(r.frame(true, c.auras));
      expect(r.shown(c.id)).toBe(true);
      r.prompts.paint(r.frame(false, c.auras));
      expect(r.shown(c.id)).toBe(false);
      r.prompts.paint(r.frame(true, c.auras));
      expect(r.shown(c.id)).toBe(true);
      r.prompts.dispose();
    });

    it(`${c.name}: never mounted for a player who keeps the hints off`, () => {
      const r = rig();
      c.setup?.(r);
      r.prompts.paint(r.frame(false, c.auras));
      expect(r.layer.querySelector(`#${c.id}`)).toBeNull();
      r.prompts.dispose();
    });
  }

  it('the Iron Cage escape still shows and still takes its press with the hints off', () => {
    const r = rig();
    r.add({
      id: 70,
      hp: 40,
      maxHp: 100,
      pos: { x: 1, y: 0, z: 0 },
      auras: [],
    } as unknown as Entity);
    const caged: Auras = [{ id: TURNKEY_CAGED, sourceId: 70 }];
    r.prompts.paint(r.frame(false, caged));
    expect(r.shown('bastion-cage-escape')).toBe(true);
    const root = r.layer.querySelector<HTMLElement>('#bastion-cage-escape');
    root?.dispatchEvent(new Event('pointerdown', { cancelable: true }));
    expect(r.calls).toEqual(['interact']);
    r.prompts.dispose();
  });

  it("Gaoler Ossick's chain alert still shows with the hints off", () => {
    const r = rig();
    r.add({
      id: 71,
      name: 'Partner',
      hp: 100,
      maxHp: 100,
      pos: { x: 2, y: 0, z: 0 },
      auras: [],
    } as unknown as Entity);
    const shackled: Auras = [{ id: OSSICK_SHACKLED, sourceId: 71, value2: 12 }];
    r.prompts.paint(r.frame(false, shackled));
    expect(r.shown('bastion-chain-alert')).toBe(true);
    expect(r.layer.querySelector('#bastion-chain-alert')?.classList.contains('is-shackled')).toBe(
      true,
    );
    r.prompts.dispose();
  });

  it('the use prompt still shows and still takes its press with the hints off', () => {
    const r = rig();
    r.add(brazier());
    r.prompts.paint(r.frame(false));
    const root = r.layer.querySelector<HTMLElement>('#kit-use-prompt');
    expect(r.shown('kit-use-prompt')).toBe(true);
    expect(root?.classList.contains('is-pressable')).toBe(true);
    root?.dispatchEvent(new Event('pointerdown', { cancelable: true }));
    expect(r.calls).toEqual(['target:50', 'interact']);
    r.prompts.dispose();
  });
});

describe('DungeonPrompts: the shared slot under the hints setting', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hints on: an alert holds the slot over the use prompt (unchanged)', () => {
    const r = rig();
    r.add(brazier());
    r.prompts.paint(r.frame(true, BRANDED));
    expect(r.shown('sanctum-alert')).toBe(true);
    expect(r.shown('kit-use-prompt')).toBe(false);
    r.prompts.dispose();
  });

  it('hints off: the hidden alert frees the slot, as when no alert is up', () => {
    const r = rig();
    r.add(brazier());
    r.prompts.paint(r.frame(false, BRANDED));
    expect(r.shown('sanctum-alert')).toBe(false);
    expect(r.shown('kit-use-prompt')).toBe(true);
    // The very state the slot is in with no alert at all.
    const off = r.layer.querySelector<HTMLElement>('#kit-use-prompt')?.outerHTML;
    const bare = rig();
    bare.add(brazier());
    bare.prompts.paint(bare.frame(true));
    expect(off).toBe(bare.layer.querySelector<HTMLElement>('#kit-use-prompt')?.outerHTML);
    // And its press is the ordinary use press.
    r.layer
      .querySelector<HTMLElement>('#kit-use-prompt')
      ?.dispatchEvent(new Event('pointerdown', { cancelable: true }));
    expect(r.calls).toEqual(['target:50', 'interact']);
    r.prompts.dispose();
    bare.prompts.dispose();
  });

  it('hints off: a hidden hard Crypt alert frees the slot for the relight prompt', () => {
    const r = rig();
    r.add(candle());
    r.add(graspRing());
    r.prompts.paint(r.frame(true));
    expect(r.shown('crypt-alert')).toBe(true);
    expect(r.shown('kit-use-prompt')).toBe(false);
    r.prompts.paint(r.frame(false));
    expect(r.shown('crypt-alert')).toBe(false);
    expect(r.shown('kit-use-prompt')).toBe(true);
    r.prompts.dispose();
  });

  it('hints off: the soft Crypt readout stays hidden with or without a candle in reach', () => {
    const r = rig();
    r.prompts.paint(r.frame(false, RITE));
    expect(r.shown('crypt-alert')).toBe(false);
    expect(r.shown('kit-use-prompt')).toBe(false);
    r.add(candle());
    r.prompts.paint(r.frame(false, RITE));
    expect(r.shown('crypt-alert')).toBe(false);
    expect(r.shown('kit-use-prompt')).toBe(true);
    r.prompts.dispose();
  });

  it('hints off: the use prompt still yields to the cage and to the chain', () => {
    const r = rig();
    r.add(brazier());
    r.add({
      id: 70,
      hp: 40,
      maxHp: 100,
      pos: { x: 1, y: 0, z: 0 },
      auras: [],
    } as unknown as Entity);
    r.prompts.paint(r.frame(false, [{ id: TURNKEY_CAGED, sourceId: 70 }]));
    expect(r.shown('bastion-cage-escape')).toBe(true);
    expect(r.shown('kit-use-prompt')).toBe(false);
    r.add({
      id: 71,
      name: 'Partner',
      hp: 100,
      maxHp: 100,
      pos: { x: 2, y: 0, z: 0 },
      auras: [],
    } as unknown as Entity);
    r.prompts.paint(r.frame(false, [{ id: OSSICK_SHACKLED, sourceId: 71, value2: 12 }]));
    expect(r.shown('bastion-chain-alert')).toBe(true);
    expect(r.shown('kit-use-prompt')).toBe(false);
    r.prompts.dispose();
  });
});

// Zulgar's Hunting Spear: pulling it is an ACTION (the use prompt), whatever
// the hints setting says; the alerts round it are advisory, and the two that
// only say "pull the spear" give the slot to the prompt that does it.
describe('DungeonPrompts: the Hunting Spear', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hints off: a spear in reach still offers its pull, and the press targets it', () => {
    const r = rig();
    r.add(zulgar());
    r.add(spear());
    r.prompts.paint(r.frame(false));
    expect(r.shown('wildheart-alert')).toBe(false);
    expect(r.shown('kit-use-prompt')).toBe(true);
    const root = r.layer.querySelector<HTMLElement>('#kit-use-prompt');
    expect(root?.classList.contains('is-pressable')).toBe(true);
    root?.dispatchEvent(new Event('pointerdown', { cancelable: true }));
    expect(r.calls).toEqual(['target:52', 'interact']);
    r.prompts.dispose();
  });

  it('hints on, a teammate: the alert points at a far spear, and yields once the prompt can offer it', () => {
    const far = rig();
    far.add(zulgar());
    far.add(spear(30));
    far.prompts.paint(far.frame(true));
    expect(far.shown('wildheart-alert')).toBe(true);
    expect(far.layer.querySelector('#wildheart-alert')?.classList.contains('is-spear')).toBe(true);
    expect(far.shown('kit-use-prompt')).toBe(false);
    far.prompts.dispose();
    const near = rig();
    near.add(zulgar());
    near.add(spear());
    near.prompts.paint(near.frame(true));
    expect(near.shown('kit-use-prompt')).toBe(true);
    expect(near.shown('wildheart-alert')).toBe(false);
    near.prompts.dispose();
  });

  it('hints on, the victim in a group: told to wait for a teammate, with no press on offer', () => {
    const r = rig();
    r.add(zulgar());
    r.add(spear());
    r.prompts.paint(r.frame(true, pinned(false)));
    expect(r.shown('wildheart-alert')).toBe(true);
    expect(r.layer.querySelector('#wildheart-alert')?.classList.contains('is-pinned')).toBe(true);
    expect(r.shown('kit-use-prompt')).toBe(false);
    r.prompts.dispose();
  });

  it('hints on, the victim alone: the pull is theirs, so the prompt takes the slot', () => {
    const r = rig();
    r.add(zulgar());
    r.add(spear());
    r.prompts.paint(r.frame(true, pinned(true)));
    expect(r.shown('kit-use-prompt')).toBe(true);
    expect(r.shown('wildheart-alert')).toBe(false);
    r.layer
      .querySelector<HTMLElement>('#kit-use-prompt')
      ?.dispatchEvent(new Event('pointerdown', { cancelable: true }));
    expect(r.calls).toEqual(['target:52', 'interact']);
    r.prompts.dispose();
  });
});
