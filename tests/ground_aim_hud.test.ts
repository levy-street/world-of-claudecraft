// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
vi.mock('../src/ui/icons', () => ({
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

import { ABILITIES } from '../src/sim/data';
import type { ResolvedAbility } from '../src/sim/sim';
import type { AbilityDef, Entity } from '../src/sim/types';
import { Hud } from '../src/ui/hud';
import { type AimPoint, XHB_ONLY_AIM_SLOT } from '../src/ui/hud/action_bar/ground_aim';
import { GroundAimController } from '../src/ui/hud/action_bar/ground_aim_controller';

interface GroundAimHarness {
  groundAim: GroundAimController;
  groundAimSeedTarget(): AimPoint | null;
  groundTargetAim(): AimPoint;
  sim: {
    player: Entity;
    entities: Map<number, Entity>;
    known: ResolvedAbility[];
    castAbilityAt: ReturnType<typeof vi.fn>;
    groundAimPlacementPreview: ReturnType<typeof vi.fn>;
  };
  renderer: { setGroundAimReticle: ReturnType<typeof vi.fn> };
  optionsHooks: {
    groundAimTargetAttackable?: (targetId: number) => boolean;
    settings: { get(key: 'groundReticle' | 'touchPreciseGroundAim'): boolean };
  } | null;
  mobileActionPage: number;
  actionForSlot(slot: number): { type: 'ability'; id: string } | null;
  abilityForSlot(slot: number): ResolvedAbility | null;
  groundReticleEnabled(abilityId: string): boolean;
  flashActionSlot(slot: number): void;
  castSlot(slot: number): void;
  isGroundAimActive(): boolean;
  groundAimAbilityRange(): number | null;
  updateGroundAimPoint(point: AimPoint | null): void;
  nudgeGroundAimPoint(dx: number, dz: number): void;
  groundAimReticle(): {
    point: AimPoint;
    radius: number;
    school: string;
    dimmed: boolean;
    blocked: boolean;
  } | null;
  commitGroundAimAt(point?: AimPoint | null): boolean;
  commitGroundAim(): boolean;
  cycleMobileActionPage(): void;
}

function resolvedPositionAbility(
  abilityDef: AbilityDef = ABILITIES.flamestrike,
  range = abilityDef.range,
  minRange?: number,
  cooldownId?: string,
): ResolvedAbility {
  const def = { ...abilityDef, range, minRange };
  return {
    def,
    rank: 1,
    cost: def.cost,
    castTime: def.castTime,
    cooldown: def.cooldown,
    effects: def.effects,
    threatFlat: 0,
    threatMult: 1,
    cooldownId,
  };
}

function entity(id: number, x: number, z: number): Entity {
  return {
    id,
    pos: { x, y: 0, z },
    facing: 0,
    targetId: null,
    dead: false,
    auras: [],
    cooldowns: new Map(),
  } as unknown as Entity;
}

function makeHud(
  options: {
    player?: Entity;
    target?: Entity;
    attackable?: boolean;
    range?: number;
    minRange?: number;
    cooldownId?: string;
    abilityDef?: AbilityDef;
    mobileTouch?: boolean;
    touchPrecise?: boolean;
    desktopPreference?: boolean;
    groundAimPlacementPreview?: (abilityId: string, point: AimPoint) => AimPoint;
  } = {},
): GroundAimHarness {
  const player = options.player ?? entity(1, 0, 0);
  const target = options.target;
  if (target) player.targetId = target.id;
  const abilityDef = options.abilityDef ?? ABILITIES.flamestrike;
  const ability = resolvedPositionAbility(
    abilityDef,
    options.range ?? abilityDef.range,
    options.minRange ?? abilityDef.minRange,
    options.cooldownId,
  );
  const hud = Object.create(Hud.prototype) as unknown as GroundAimHarness;
  document.body.classList.toggle('mobile-touch', options.mobileTouch ?? false);
  hud.mobileActionPage = 0;
  hud.sim = {
    player,
    entities: new Map(
      [...[player, target].filter((value): value is Entity => !!value)].map((e) => [e.id, e]),
    ),
    known: [ability],
    castAbilityAt: vi.fn(),
    groundAimPlacementPreview: vi.fn(
      options.groundAimPlacementPreview ?? ((_id: string, point: AimPoint) => point),
    ),
  };
  hud.renderer = { setGroundAimReticle: vi.fn() };
  // Mirrors Hud's field initializer, which Object.create(Hud.prototype) skips.
  hud.groundAim = new GroundAimController({
    player: () => hud.sim.player,
    resolveAbility: (id) => hud.sim.known.find((k) => k.def.id === id) ?? null,
    seedTargetPoint: () => hud.groundAimSeedTarget(),
    fallbackPoint: () => hud.groundTargetAim(),
    castAt: (id, point) => (hud.sim.castAbilityAt as (i: string, p: AimPoint) => void)(id, point),
    clearReticle: () => (hud.renderer.setGroundAimReticle as (r: null) => void)(null),
    projectPlacement: (id, point) =>
      (hud.sim.groundAimPlacementPreview as (i: string, p: AimPoint) => AimPoint)(id, point),
  });
  hud.optionsHooks = {
    groundAimTargetAttackable: () => options.attackable ?? false,
    settings: {
      get: (key) =>
        key === 'touchPreciseGroundAim'
          ? (options.touchPrecise ?? true)
          : (options.desktopPreference ?? true),
    },
  };
  hud.actionForSlot = () => ({ type: 'ability', id: ability.def.id });
  hud.abilityForSlot = () => ability;
  hud.flashActionSlot = vi.fn();
  return hud;
}

/** The same harness with an EMPTY bar, so castCrossHotbarAction takes the
 *  no-slot fallback and aim identity resolves by ability id. */
function makeXhbOnlyHud(options: Parameters<typeof makeHud>[0] = {}): GroundAimHarness & {
  hotbarActions: unknown[];
  castCrossHotbarAction(action: { type: 'ability' | 'item'; id: string }): void;
} {
  const hud = makeHud(options) as ReturnType<typeof makeXhbOnlyHud>;
  // hotbarActions is a Hud accessor that forwards to the (absent) action bar
  // controller, so shadow it with a plain own property for the slot-scan loop.
  Object.defineProperty(hud, 'hotbarActions', { value: [], configurable: true });
  hud.actionForSlot = () => null;
  return hud;
}

describe('Hud ground aim behavior', () => {
  it('enters precise touch aim for every non-self-centered position ability', () => {
    const positionAbilities = Object.values(ABILITIES).filter(
      (def) => def.targetMode === 'position' && !def.selfCentered,
    );

    expect(positionAbilities.length).toBeGreaterThan(1);
    for (const abilityDef of positionAbilities) {
      const hud = makeHud({ abilityDef, mobileTouch: true, touchPrecise: true });

      hud.castSlot(3);

      expect(hud.groundAim.activeAbilityId()).toBe(abilityDef.id);
      expect(hud.sim.castAbilityAt).not.toHaveBeenCalled();
    }
  });

  it('quick touch mode casts at the smart seed without entering aim', () => {
    const hud = makeHud({ mobileTouch: true, touchPrecise: false });

    hud.castSlot(3);

    expect(hud.isGroundAimActive()).toBe(false);
    expect(hud.sim.castAbilityAt).toHaveBeenCalledWith('flamestrike', { x: 0, z: 15 });
  });

  it('desktop reticle-off casting keeps the target-feet fallback', () => {
    const target = entity(2, 12, 0);
    const hud = makeHud({ target, attackable: false, desktopPreference: false });

    hud.castSlot(3);

    expect(hud.isGroundAimActive()).toBe(false);
    expect(hud.sim.castAbilityAt).toHaveBeenCalledWith('flamestrike', { x: 12, z: 0 });
  });

  it('desktop same-slot re-press commits the active aim', () => {
    const hud = makeHud();
    hud.castSlot(3);
    hud.updateGroundAimPoint({ x: 9, z: 4 });

    hud.castSlot(3);

    expect(hud.isGroundAimActive()).toBe(false);
    expect(hud.sim.castAbilityAt).toHaveBeenCalledWith('flamestrike', { x: 9, z: 4 });
  });

  it('seeds an attackable selected target clamped to range', () => {
    const target = entity(2, 50, 0);
    const hud = makeHud({ target, attackable: true });

    hud.castSlot(3);

    expect(hud.isGroundAimActive()).toBe(true);
    expect(hud.groundAim.rawAimPoint()).toEqual({ x: 30, z: 0 });
  });

  it('seeds ahead at half range when there is no selected target', () => {
    const hud = makeHud();

    hud.castSlot(3);

    expect(hud.groundAim.rawAimPoint()).toEqual({ x: 0, z: 15 });
    expect(hud.groundAim.rawAimPoint()).not.toEqual({ x: 0, z: 0 });
  });

  it('seeds ahead when the selected target is not attackable', () => {
    const hud = makeHud({ target: entity(2, 12, 0), attackable: false });

    hud.castSlot(3);

    expect(hud.groundAim.rawAimPoint()).toEqual({ x: 0, z: 15 });
  });

  it('uses the live selected target when the attackability hook is absent', () => {
    const target = entity(2, 12, 0);
    const hud = makeHud({ target });
    hud.optionsHooks = null;

    hud.castSlot(3);

    expect(hud.groundAim.rawAimPoint()).toEqual({ x: 12, z: 0 });
  });

  it('seeds ahead when the selected target is dead', () => {
    const target = entity(2, 12, 0);
    target.dead = true;
    const hud = makeHud({ target, attackable: true });

    hud.castSlot(3);

    expect(hud.groundAim.rawAimPoint()).toEqual({ x: 0, z: 15 });
  });

  it('seeds ahead when the selected target is the player', () => {
    const player = entity(1, 0, 0);
    player.targetId = player.id;
    const hud = makeHud({ player, attackable: true });

    hud.castSlot(3);

    expect(hud.groundAim.rawAimPoint()).toEqual({ x: 0, z: 15 });
  });

  it('casts immediately instead of entering aim while on cooldown', () => {
    const target = entity(2, 12, 0);
    const hud = makeHud({ target, attackable: true });
    hud.sim.player.cooldowns.set('flamestrike', 4);

    hud.castSlot(3);

    expect(hud.isGroundAimActive()).toBe(false);
    expect(hud.sim.castAbilityAt).toHaveBeenCalledWith('flamestrike', { x: 12, z: 0 });
  });

  it('reads the resolved cooldown key before entering aim', () => {
    const hud = makeHud({ cooldownId: 'shared_clock' });
    hud.sim.player.cooldowns.set('shared_clock', 4);

    hud.castSlot(3);

    expect(hud.isGroundAimActive()).toBe(false);
    expect(hud.sim.castAbilityAt).toHaveBeenCalledOnce();
  });

  it('uses the smart seed for the mobile cooldown fallback', () => {
    const hud = makeHud({ mobileTouch: true });
    hud.sim.player.cooldowns.set('flamestrike', 4);

    hud.castSlot(3);

    expect(hud.isGroundAimActive()).toBe(false);
    expect(hud.sim.castAbilityAt).toHaveBeenCalledWith('flamestrike', { x: 0, z: 15 });
  });

  it('enters aim when Forbidden Reflection bypasses the running cooldown', () => {
    const hud = makeHud();
    hud.sim.player.cooldowns.set('flamestrike', 4);
    hud.sim.player.auras.push({
      id: 'wlk_forbidden_reflection',
      name: 'Forbidden Reflection',
      kind: 'internal_cd',
      remaining: 5,
      duration: 5,
      value: 0,
      sourceId: hud.sim.player.id,
      school: 'shadow',
      empowerAbilities: ['flamestrike'],
    });

    hud.castSlot(3);

    expect(hud.isGroundAimActive()).toBe(true);
    expect(hud.sim.castAbilityAt).not.toHaveBeenCalled();
  });

  it('casts immediately instead of entering aim while dead', () => {
    const hud = makeHud({ mobileTouch: true });
    hud.sim.player.dead = true;

    hud.castSlot(3);

    expect(hud.isGroundAimActive()).toBe(false);
    expect(hud.sim.castAbilityAt).toHaveBeenCalledWith('flamestrike', { x: 0, z: 15 });
  });

  it('cancels active aim before flipping the mobile action page', () => {
    const hud = makeHud({ mobileTouch: true });
    hud.castSlot(3);
    const pagesObservedWhileCancelling: number[] = [];
    hud.renderer.setGroundAimReticle.mockImplementation((reticle) => {
      if (reticle === null) pagesObservedWhileCancelling.push(hud.mobileActionPage);
    });

    hud.cycleMobileActionPage();

    expect(hud.isGroundAimActive()).toBe(false);
    expect(pagesObservedWhileCancelling).toEqual([0]);
    expect(hud.mobileActionPage).toBe(1);
    expect(hud.renderer.setGroundAimReticle).toHaveBeenCalledWith(null);
  });

  it('marks a point inside the authored minimum range blocked, not dimmed', () => {
    const hud = makeHud({ minRange: 8 });
    hud.castSlot(3);
    hud.updateGroundAimPoint({ x: 3, z: 0 });

    const reticle = hud.groundAimReticle();

    expect(reticle?.point).toEqual({ x: 3, z: 0 });
    expect(reticle?.blocked).toBe(true);
    expect(reticle?.dimmed).toBe(false);
  });

  it('leaves an unclamped point at the minimum-range boundary unblocked', () => {
    const hud = makeHud({ minRange: 8 });
    hud.castSlot(3);
    hud.updateGroundAimPoint({ x: 8, z: 0 });

    const reticle = hud.groundAimReticle();

    expect(reticle?.point).toEqual({ x: 8, z: 0 });
    expect(reticle?.blocked).toBe(false);
    expect(reticle?.dimmed).toBe(false);
  });

  it('re-clamps the raw point from the player current position', () => {
    const hud = makeHud();
    hud.castSlot(3);
    hud.updateGroundAimPoint({ x: 100, z: 0 });
    hud.sim.player.pos.x = -50;

    const reticle = hud.groundAimReticle();

    expect(hud.groundAim.rawAimPoint()).toEqual({ x: 100, z: 0 });
    expect(reticle?.point).toEqual({ x: -20, z: 0 });
    expect(reticle?.dimmed).toBe(true);
  });

  it('leashes a pad nudge to the ability range edge', () => {
    const hud = makeHud({ range: 30 });
    hud.castSlot(3);
    hud.updateGroundAimPoint({ x: 0, z: 0 });

    hud.nudgeGroundAimPoint(100, 0);

    expect(hud.groundAim.rawAimPoint()).toEqual({ x: 30, z: 0 });
    expect(hud.groundAimReticle()?.point).toEqual({ x: 30, z: 0 });
  });

  it('nudges and clamps from the live player position', () => {
    const hud = makeHud({ range: 30 });
    hud.sim.player.pos.x = 40;
    hud.sim.player.pos.z = -10;
    hud.castSlot(3);
    hud.updateGroundAimPoint({ x: 40, z: -10 });

    hud.nudgeGroundAimPoint(-100, 100);

    const distance = Math.hypot(
      (hud.groundAim.rawAimPoint()?.x ?? 0) - hud.sim.player.pos.x,
      (hud.groundAim.rawAimPoint()?.z ?? 0) - hud.sim.player.pos.z,
    );
    expect(distance).toBeCloseTo(30);
    expect(hud.groundAimReticle()?.point).toEqual(hud.groundAim.rawAimPoint());
  });

  it('exposes the active range and commits through the pad entry point', () => {
    const hud = makeHud({ range: 30 });
    hud.castSlot(3);
    hud.updateGroundAimPoint({ x: 10, z: 5 });

    expect(hud.groundAimAbilityRange()).toBe(30);
    expect(hud.commitGroundAim()).toBe(true);
    expect(hud.sim.castAbilityAt).toHaveBeenCalledWith('flamestrike', { x: 10, z: 5 });
    expect(hud.groundAimAbilityRange()).toBeNull();
  });

  it('commits the same live clamp shown by the reticle', () => {
    const hud = makeHud();
    hud.castSlot(3);
    hud.updateGroundAimPoint({ x: 100, z: 0 });
    hud.sim.player.pos.x = -50;
    const shown = hud.groundAimReticle();

    hud.commitGroundAimAt();

    expect(hud.sim.castAbilityAt).toHaveBeenCalledWith('flamestrike', shown?.point);
    expect(hud.isGroundAimActive()).toBe(false);
  });

  describe('XHB-only aim identity', () => {
    it('enters aim under the sentinel slot for a pad-only position ability', () => {
      const hud = makeXhbOnlyHud();

      hud.castCrossHotbarAction({ type: 'ability', id: 'flamestrike' });

      expect(hud.groundAim.activeAbilityId()).toBe('flamestrike');
      expect(hud.groundAim.activeSlot()).toBe(XHB_ONLY_AIM_SLOT);
      expect(hud.sim.castAbilityAt).not.toHaveBeenCalled();
    });

    it('commits on a same-cell re-press by ability id', () => {
      const hud = makeXhbOnlyHud();

      hud.castCrossHotbarAction({ type: 'ability', id: 'flamestrike' });
      hud.castCrossHotbarAction({ type: 'ability', id: 'flamestrike' });

      expect(hud.isGroundAimActive()).toBe(false);
      expect(hud.sim.castAbilityAt).toHaveBeenCalledTimes(1);
      expect(hud.sim.castAbilityAt).toHaveBeenCalledWith('flamestrike', { x: 0, z: 15 });
    });

    it('quick mode still casts at a point, never a plain castAbility', () => {
      const hud = makeXhbOnlyHud({ mobileTouch: true, touchPrecise: false });

      hud.castCrossHotbarAction({ type: 'ability', id: 'flamestrike' });

      expect(hud.isGroundAimActive()).toBe(false);
      expect(hud.sim.castAbilityAt).toHaveBeenCalledWith('flamestrike', { x: 0, z: 15 });
    });
  });

  describe('placement projection', () => {
    it('returns the world-projected placement dimmed through the Hud harness', () => {
      const groundAimPlacementPreview = vi.fn((id: string, point: AimPoint) =>
        id === 'heroic_leap' ? { x: point.x + 3, z: point.z - 6 } : point,
      );
      const hud = makeHud({
        abilityDef: ABILITIES.heroic_leap,
        groundAimPlacementPreview,
      });

      hud.castSlot(3);
      hud.updateGroundAimPoint({ x: 0, z: 20 });

      const reticle = hud.groundAimReticle();
      expect(groundAimPlacementPreview).toHaveBeenCalledWith('heroic_leap', { x: 0, z: 20 });
      expect(reticle?.point).toEqual({ x: 3, z: 14 });
      expect(reticle?.dimmed).toBe(true);
    });

    it('paints the projected landing dimmed while committing the clamped aim', () => {
      const castAt = vi.fn();
      const controller = new GroundAimController({
        player: () => entity(1, 0, 0),
        resolveAbility: () => ({
          def: { id: 'heroic_leap', range: 30, school: 'physical' },
          effects: [],
        }),
        seedTargetPoint: () => null,
        fallbackPoint: () => ({ x: 0, z: 0 }),
        castAt,
        clearReticle: vi.fn(),
        projectPlacement: (id, point) =>
          id === 'heroic_leap' ? { x: point.x, z: point.z - 6 } : point,
      });

      controller.begin('heroic_leap', 3);
      controller.updatePoint({ x: 0, z: 20 });

      const reticle = controller.reticle();
      expect(reticle?.point).toEqual({ x: 0, z: 14 });
      expect(reticle?.dimmed).toBe(true);

      controller.commitAt();
      expect(castAt).toHaveBeenCalledWith('heroic_leap', { x: 0, z: 20 });
    });

    it('leaves an unadjusted ability bright at its own point', () => {
      const controller = new GroundAimController({
        player: () => entity(1, 0, 0),
        resolveAbility: () => ({
          def: { id: 'flamestrike', range: 30, school: 'fire' },
          effects: [],
        }),
        seedTargetPoint: () => null,
        fallbackPoint: () => ({ x: 0, z: 0 }),
        castAt: vi.fn(),
        clearReticle: vi.fn(),
        projectPlacement: (_id, point) => point,
      });

      controller.begin('flamestrike', 3);
      controller.updatePoint({ x: 0, z: 20 });

      const reticle = controller.reticle();
      expect(reticle?.point).toEqual({ x: 0, z: 20 });
      expect(reticle?.dimmed).toBe(false);
    });
  });
});

describe('Hud ground aim source wiring', () => {
  it('delegates placement projection to the world seam', () => {
    const source = readFileSync(join(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(code).toContain(
      'projectPlacement: (id, point) => this.sim.groundAimPlacementPreview(id, point)',
    );
  });
});
