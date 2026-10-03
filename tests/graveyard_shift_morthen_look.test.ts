import { beforeEach, describe, expect, it, vi } from 'vitest';

// The look Morthen wears: while the run owner holds the identity aura, every
// visual path draws the Morthen mob's own rig (skel_boss) in its own colour, the
// authored look is never composed, and the player's own body comes back on exit.

const built = vi.hoisted(
  () =>
    [] as {
      key: string;
      color: number;
      skin: number;
      mainhand: string | null;
      offhand: string | null;
      look: unknown;
    }[],
);

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(() => new Promise(() => undefined)),
  loadTexture: vi.fn(() => new Promise(() => undefined)),
  loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
  releaseGltf: vi.fn(),
}));

vi.mock('../src/render/characters/visual', () => ({
  // A recording double: the factory's arguments ARE the visual it would build.
  CharacterVisual: class {
    budgetedWeaponLight = false;
    constructor(
      key: string,
      color: number,
      skin: number,
      mainhand: string | null,
      _override: unknown,
      offhand: string | null,
      look: unknown,
    ) {
      built.push({ key, color, skin, mainhand, offhand, look });
    }
  },
}));

import {
  composedLookPiecesOf,
  createCharacterVisual,
  modularLookFor,
  setModularLookProvider,
} from '../src/render/characters';
import {
  identityBodyColorFor,
  identityBodyTemplateFor,
} from '../src/render/characters/identity_body_core';
import type { LookPieceQueue } from '../src/render/characters/look_pieces';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import type { ModularLook } from '../src/render/characters/modular';
import { MOBS } from '../src/sim/data';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import {
  hasMorthenIdentity,
  morthenIdentityAura,
} from '../src/sim/graveyard_shift/morthen_identity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function shiftSim() {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    offlineHost: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(10);
  return sim;
}

function start(sim: Sim) {
  sim.chat('/dev graveyardshift start');
  expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).not.toBeNull();
  expect(hasMorthenIdentity(sim.player)).toBe(true);
}

function end(sim: Sim) {
  sim.chat('/dev graveyardshift end');
  sim.tick();
  expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
  expect(hasMorthenIdentity(sim.player)).toBe(false);
}

// What a spawned Morthen mob renders as: the reference the owner must match.
function morthenMobKey(): string {
  return visualKeyFor({ kind: 'mob', templateId: 'morthen', auras: [] } as unknown as Entity);
}

const FAKE_LOOK = { worn: {} } as unknown as ModularLook;

beforeEach(() => {
  built.length = 0;
  setModularLookProvider(null);
});

describe('identity_body_core', () => {
  it('maps a player holding the Morthen identity to the morthen template', () => {
    const sim = shiftSim();
    expect(identityBodyTemplateFor(sim.player)).toBeNull();
    start(sim);
    expect(identityBodyTemplateFor(sim.player)).toBe('morthen');
    end(sim);
    expect(identityBodyTemplateFor(sim.player)).toBeNull();
  });

  it('applies to players only', () => {
    const mob = { kind: 'mob', auras: [morthenIdentityAura(1)] } as unknown as Entity;
    expect(identityBodyTemplateFor(mob)).toBeNull();
  });

  it("takes the template's own colour, the fallback only for an unknown template", () => {
    expect(identityBodyColorFor('morthen', 0x123456)).toBe(MOBS.morthen.color);
    expect(MOBS.morthen.color).toBe(0x4a235a);
    expect(identityBodyColorFor('no_such_template', 0x123456)).toBe(0x123456);
  });
});

describe('visualKeyFor under the Morthen identity', () => {
  it('renders the owner on the Morthen mob rig, then back on the class rig', () => {
    const sim = shiftSim();
    const own = visualKeyFor(sim.player);
    expect(own).toBe('player_warrior');
    start(sim);
    expect(visualKeyFor(sim.player)).toBe(morthenMobKey());
    expect(visualKeyFor(sim.player)).toBe('skel_boss');
    end(sim);
    expect(visualKeyFor(sim.player)).toBe(own);
  });

  it('wins over the Combat Mech, which comes back on exit', () => {
    const sim = shiftSim();
    sim.player.skinCatalog = 'mech';
    expect(visualKeyFor(sim.player)).toBe('player_mech');
    start(sim);
    expect(visualKeyFor(sim.player)).toBe('skel_boss');
    end(sim);
    expect(visualKeyFor(sim.player)).toBe('player_mech');
  });

  it("shows skel_boss's own staff: no held-item slot, and the owner's weapon mirrors are empty", () => {
    const def = VISUALS.skel_boss;
    expect(def.weaponSlots ?? []).toEqual([]);
    expect(def.offhandSlot).toBeUndefined();
    expect(def.attach?.map((a) => a.url.split('/').pop())).toEqual(['skeleton_staff.glb']);
    const sim = shiftSim();
    expect(sim.player.mainhandItemId).not.toBeNull();
    start(sim);
    expect(sim.player.mainhandItemId).toBeNull();
    expect(sim.player.offhandItemId).toBeNull();
    expect(sim.player.weaponSkinId ?? null).toBeNull();
  });
});

describe('createCharacterVisual under the Morthen identity', () => {
  it('bypasses the authored look and builds skel_boss in Morthen colours', () => {
    const sim = shiftSim();
    sim.player.skin = 2;
    setModularLookProvider(() => FAKE_LOOK);
    start(sim);
    expect(modularLookFor(sim.player)).toBeNull();
    const queue = { enqueue: vi.fn() } as unknown as LookPieceQueue;
    expect(composedLookPiecesOf(sim.player, queue, 0)).toBeNull();
    createCharacterVisual(sim.player);
    expect(built).toEqual([
      {
        key: 'skel_boss',
        color: 0x4a235a,
        skin: 0,
        mainhand: null,
        offhand: null,
        look: null,
      },
    ]);
  });

  it("composes the player's own look again once the identity is removed", () => {
    const sim = shiftSim();
    sim.player.skin = 2;
    setModularLookProvider(() => FAKE_LOOK);
    const classColor = sim.player.color;
    start(sim);
    end(sim);
    expect(modularLookFor(sim.player)).toBe(FAKE_LOOK);
    createCharacterVisual(sim.player);
    expect(built).toHaveLength(1);
    expect(built[0].key).not.toBe('skel_boss');
    expect(built[0].key).toContain('warrior');
    expect(built[0].look).toBe(FAKE_LOOK);
    expect(built[0].color).toBe(classColor);
    expect(built[0].skin).toBe(2);
    expect(built[0].mainhand).toBe(sim.player.mainhandItemId);
    expect(built[0].mainhand).not.toBeNull();
  });

  it('a forced form still wins over the identity body (the form path is untouched)', () => {
    const sim = shiftSim();
    start(sim);
    createCharacterVisual(sim.player, 'form_sheep');
    expect(built[0].key).not.toBe('skel_boss');
    expect(built[0].color).toBe(sim.player.color);
  });
});
