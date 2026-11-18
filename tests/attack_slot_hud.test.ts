// @vitest-environment happy-dom

// The Hud press path for a placed Attack: a bar slot holding the `attack` action
// toggles auto-attack from that slot's key (start, then stop) and flashes THAT
// slot, exactly like the fixed Attack button does on slot 0. Built the way
// ground_aim_hud.test.ts builds its Hud (Object.create over the prototype, with the
// few fields castSlot reads), so the real castSlot runs.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({
  audio: { click: vi.fn() },
}));
vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitUpdate: vi.fn(),
  onPortraitsReady: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  portraitsReady: vi.fn(() => false),
  visualPortraitDataUrl: vi.fn(),
}));
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: (kind: string, id: string) => `mock:${kind}:${id}`,
  QUALITY_COLOR: {},
  raidMarkerDataUrl: vi.fn(() => ''),
  auraImageUrl: vi.fn(() => null),
  cachedProceduralIconDataUrl: vi.fn((kind: string, id: string) => `mock:${kind}:${id}`),
  hasAbilityIconIdentity: vi.fn(() => false),
  hasAuraImageIdentity: vi.fn(() => false),
  hasAuraRecipe: vi.fn(() => false),
  proceduralIconDataUrl: vi.fn((kind: string, id: string) => `mock:${kind}:${id}`),
}));

import type { Entity } from '../src/sim/types';
import { Hud } from '../src/ui/hud';
import { GroundAimController } from '../src/ui/hud/action_bar/ground_aim_controller';
import { ATTACK_HOTBAR_ACTION, type HotbarAction } from '../src/ui/hud/action_bar/hotbar';

interface AttackHudHarness {
  sim: {
    player: Entity;
    entities: Map<number, Entity>;
    known: never[];
    startAutoAttack: ReturnType<typeof vi.fn>;
    stopAutoAttack: ReturnType<typeof vi.fn>;
    castAbility: ReturnType<typeof vi.fn>;
  };
  playerGroundAim: GroundAimController;
  actionBarController: { isAttackSlotFixed(): boolean };
  actionForSlot(slot: number): HotbarAction;
  flashActionSlot: ReturnType<typeof vi.fn>;
  castSlot(slot: number): void;
}

function makeHud(bar: Record<number, HotbarAction>, attackFixed: boolean): AttackHudHarness {
  const player = {
    id: 1,
    pos: { x: 0, y: 0, z: 0 },
    targetId: 2,
    autoAttack: false,
    dead: false,
    auras: [],
    cooldowns: new Map(),
  } as unknown as Entity & { autoAttack: boolean };
  const hud = Object.create(Hud.prototype) as unknown as AttackHudHarness;
  hud.sim = {
    player,
    entities: new Map([[1, player]]),
    known: [],
    startAutoAttack: vi.fn(() => {
      player.autoAttack = true;
    }),
    stopAutoAttack: vi.fn(() => {
      player.autoAttack = false;
    }),
    castAbility: vi.fn(),
  };
  // Mirrors Hud's field initializer, which Object.create(Hud.prototype) skips.
  hud.playerGroundAim = new GroundAimController({
    player: () => player,
    resolveAbility: () => null,
    seedTargetPoint: () => null,
    fallbackPoint: () => ({ x: 0, z: 0 }),
    castAt: vi.fn(),
    clearReticle: vi.fn(),
    projectPlacement: (_id, point) => point,
  });
  hud.actionBarController = { isAttackSlotFixed: () => attackFixed };
  hud.actionForSlot = (slot) => bar[slot] ?? null;
  hud.flashActionSlot = vi.fn();
  return hud;
}

describe('Hud castSlot with a placed Attack', () => {
  it('toggles auto-attack from any slot holding Attack and flashes that slot', () => {
    const hud = makeHud({ 7: ATTACK_HOTBAR_ACTION }, true);
    hud.castSlot(7);
    expect(hud.sim.startAutoAttack).toHaveBeenCalledTimes(1);
    expect(hud.flashActionSlot).toHaveBeenLastCalledWith(7);
    hud.castSlot(7);
    expect(hud.sim.stopAutoAttack).toHaveBeenCalledTimes(1);
    expect(hud.sim.castAbility).not.toHaveBeenCalled();
  });

  it('runs Attack from the freed slot 0 too when it holds the placed Attack', () => {
    const hud = makeHud({ 0: ATTACK_HOTBAR_ACTION }, false);
    hud.castSlot(0);
    expect(hud.sim.startAutoAttack).toHaveBeenCalledTimes(1);
    expect(hud.flashActionSlot).toHaveBeenLastCalledWith(0);
  });

  it('leaves a slot that holds something else alone', () => {
    const hud = makeHud({ 7: ATTACK_HOTBAR_ACTION }, false);
    hud.castSlot(4); // empty slot, Show Attack Button off
    hud.castSlot(0); // freed slot 0 with nothing on it
    expect(hud.sim.startAutoAttack).not.toHaveBeenCalled();
    expect(hud.sim.stopAutoAttack).not.toHaveBeenCalled();
  });
});
