// The WOC hunter's timed shot: the generic cast clip is the aim half of the
// shot clip (ClipMap.clipSplits), held at its end while the cast channels; the
// launch cue then releases the tail half instead of restarting the whole shot
// from the raise. The launch cue carries no ability id, so this is the
// playAttack arm a held aim depends on (visual.ts heldSplitTail).
// @vitest-environment happy-dom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import type { AnimState } from '../src/render/characters/anim_state';
import type { Renderer as RendererType } from '../src/render/renderer';
import type { SimEvent } from '../src/sim/types';
import { withMeleeContact } from './helpers/renderer_contact';
import { landWocBodies } from './helpers/woc_streamed';

type Peek = {
  current: THREE.AnimationAction | null;
  baseState: string;
  action(name: string): THREE.AnimationAction | null;
};

async function hunterVisual() {
  vi.resetModules();
  const clip = (name: string) => new THREE.AnimationClip(name, 1, []);
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() =>
      Promise.resolve({
        scene: new THREE.Group(),
        animations: [
          'Ranged_Shoot',
          '1H_Chop',
          '1H_Slash',
          'Cast_Raise',
          'Cast_Loop',
          'Cast_Shoot',
          'Spellcast_Shoot',
          '1H_Melee_Attack_Chop',
          '2H_Chop',
          'Idle',
          'Walk',
          'Run',
        ].map(clip),
      }),
    ),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
  const assets = await import('../src/render/characters/assets');
  await assets.charactersReady();
  await landWocBodies(assets);
  const { CharacterVisual } = await import('../src/render/characters/visual');
  return new CharacterVisual('player_hunter', 0xffffff, 0);
}

describe('the hunter releases a held aim through the tail half of its shot clip', () => {
  it('mints both halves and plays the tail when the aim is held, the whole shot otherwise', async () => {
    const visual = await hunterVisual();
    const peek = visual as unknown as Peek;
    const aim = peek.action('Ranged_Shoot#aim');
    const release = peek.action('Ranged_Shoot#release');
    expect(aim).not.toBeNull();
    expect(release).not.toBeNull();
    // the snap shot (2026-09-29): split at 0.17 s, the release is the rest of the clip (the
    // stub clips here are 1 s long)
    expect(aim?.getClip().duration).toBeCloseTo(0.17, 5);
    expect(release?.getClip().duration).toBeCloseTo(1 - 0.17, 5);

    // Not holding an aim: the launch cue plays the authored shot from the raise.
    visual.playAttack();
    expect(peek.current?.getClip().name).toBe('Ranged_Shoot');

    // Holding the aim (the cast state, head half frozen at its hold point):
    // the same cue releases the tail, never the raise again.
    peek.baseState = 'cast';
    if (aim) {
      aim.play();
      aim.paused = true;
      aim.time = 0.15;
    }
    peek.current = aim;
    visual.playAttack();
    expect(peek.current?.getClip().name).toBe('Ranged_Shoot#release');

    // A per-ability entry still names the tail for the damage-event arm.
    peek.baseState = 'idle';
    visual.playAttack('aimed_shot');
    expect(peek.current?.getClip().name).toBe('Ranged_Shoot#release');
  }, 30000);
});

describe('live WOC combat event linkage', () => {
  async function harness(key = 'player_hunter') {
    await hunterVisual();
    if (key === 'player_mech') {
      const { preloadMechAssets } = await import('../src/render/characters/assets');
      await preloadMechAssets();
    }
    const { CharacterVisual } = await import('../src/render/characters/visual');
    const { Renderer } = await import('../src/render/renderer');
    const visual = new CharacterVisual(key, 0xffffff, 0);
    const entity = {
      id: 1,
      kind: 'player',
      templateId: key.replace('player_', ''),
      castingAbility: null,
      pos: { x: 0, y: 0, z: 0 },
      facing: 0,
      auras: [],
    };
    const renderer = withMeleeContact({
      sim: { entities: new Map([[1, entity]]), playerId: 1, cfg: { seed: 1 } },
      views: new Map([[1, {}]]),
      activeVisual: () => visual,
      triggerAttack: Renderer.prototype.triggerAttack,
      attackTriggerCount: 0,
      triggerHit: vi.fn(),
      abilityVfx: { onDamage: vi.fn(), handleSpellfx: () => false },
      glacialFrontVisual: { spawn: vi.fn() },
      needleOfFateVfx: { spawn: vi.fn() },
      vfx: { meleeSpark: vi.fn(), projectile: vi.fn(), drainLifeTick: vi.fn() },
    }) as unknown as RendererType;
    return {
      visual,
      peek: visual as unknown as Peek,
      event: (event: SimEvent) => Renderer.prototype.handleEvent.call(renderer, event),
      attackCount: () => (renderer as unknown as { attackTriggerCount: number }).attackTriggerCount,
      usePainter: async () => {
        const { AbilityVfx } = await import('../src/render/ability_vfx/painter');
        const painter = new AbilityVfx(
          {
            fx: { setDelegates: vi.fn() },
            hasGestureClip: (_id: number, ability: string) => visual.hasAttackClipOverride(ability),
            triggerAttack: renderer.triggerAttack.bind(renderer),
            isMob: () => false,
          } as unknown as AbilityVfxDeps,
          () => 0,
        );
        (renderer as unknown as { abilityVfx: typeof painter }).abilityVfx = painter;
      },
    };
  }

  const damage = (ability: string | null, abilityId?: string): SimEvent => ({
    type: 'damage',
    sourceId: 1,
    targetId: 2,
    amount: 10,
    crit: false,
    school: 'physical',
    kind: 'hit',
    ability,
    ...(abilityId ? { abilityId } : {}),
  });

  it('keeps Hunter melee autos swinging after a melee skill, while shot launches still shoot', async () => {
    const h = await harness();
    h.event(damage('Gutting Strike', 'raptor_strike'));
    expect(h.peek.current?.getClip().name).toBe('1H_Chop');
    h.event(damage(null));
    expect(['1H_Chop', '1H_Slash']).toContain(h.peek.current?.getClip().name);
    h.event({
      type: 'spellfx',
      sourceId: 1,
      targetId: 2,
      fx: 'projectile',
      school: 'physical',
      attackAnimation: 'ranged-shot',
    });
    expect(h.peek.current?.getClip().name).toBe('Ranged_Shoot');
  }, 30000);

  it('keeps physical proc and wound events from replacing the Hunter melee skill with a shot', async () => {
    const h = await harness();
    h.event(damage('Woundrend', 'mongoose_bite'));
    for (const label of [
      'Woundrend',
      'Hunting Momentum',
      'Bloodhook Wound',
      'Shrapnel Wound',
      'Overdraw',
      'Chain Reaction',
    ]) {
      h.event(damage(label));
      expect(h.attackCount(), label).toBe(1);
      expect(h.peek.current?.getClip().name, label).toBe('1H_Slash');
    }
  }, 30000);

  it('animates a caster wand launch through its casting hand', async () => {
    const h = await harness('player_mage');
    h.event({
      type: 'spellfx',
      sourceId: 1,
      targetId: 2,
      fx: 'projectile',
      school: 'arcane',
      wand: true,
    });
    expect(h.peek.current?.getClip().name).toBe('Cast_Shoot');
  }, 30000);

  it('keeps Measured Shot on the held release across the real painter and renderer', async () => {
    const h = await harness();
    await h.usePainter();
    const aim = h.peek.action('Ranged_Shoot#aim')!;
    aim.play();
    aim.paused = true;
    aim.time = 0.15;
    h.peek.baseState = 'cast';
    h.peek.current = aim;
    h.event({
      type: 'spellfx',
      sourceId: 1,
      targetId: 2,
      fx: 'projectile',
      school: 'physical',
      ability: 'measured_shot',
      attackAnimation: 'ranged-shot',
    });
    expect(h.peek.current?.getClip().name).toBe('Ranged_Shoot#release');
    expect(h.attackCount()).toBe(1);
  }, 30000);

  it('keeps caster wand gestures on the cosmetic mech without turning them into melee', async () => {
    const h = await harness('player_mech');
    h.event({
      type: 'spellfx',
      sourceId: 1,
      targetId: 2,
      fx: 'projectile',
      school: 'arcane',
      wand: true,
    });
    expect(h.peek.current?.getClip().name).toBe('Spellcast_Shoot');
    h.event(damage(null));
    expect(h.peek.current?.getClip().name).toBe('1H_Melee_Attack_Chop');
  }, 30000);

  it('uses a spell gesture for Hunter pet care and a sustained loop for Druid healing channels', async () => {
    const { VISUALS } = await import('../src/render/characters/manifest');
    const hunter = VISUALS.player_hunter.clips;
    for (const id of ['tame_beast', 'revive_pet'])
      expect(hunter.castByAbility?.[id] ?? hunter.cast, id).toBe('Cast_Loop');
    const druid = VISUALS.player_druid.clips;
    expect(druid.castByAbility?.tranquility ?? druid.cast).toBe('Cast_Loop');
  });

  it.each([
    ['hunter', 'tame_beast'],
    ['hunter', 'revive_pet'],
    ['druid', 'tranquility'],
  ] as const)(
    'runs the %s %s channel until cast ends',
    async (cls, ability) => {
      const h = await harness(`player_${cls}`);
      const state: AnimState = {
        speed: 0,
        moving: false,
        running: false,
        airborne: false,
        backwards: false,
        dead: false,
        casting: true,
        castingAbility: ability,
        swimming: false,
        submerged: false,
        swimPitch: 0,
        wading: false,
        sitting: false,
      };
      for (let i = 0; i < 50; i++) h.visual.update(0.05, state, true);
      expect(h.peek.current?.getClip().name).toBe('Cast_Loop');
      expect(h.peek.current?.paused).toBe(false);
      expect(h.peek.current?.isRunning()).toBe(true);
      h.visual.update(0.05, { ...state, casting: false, castingAbility: null }, true);
      expect(h.peek.current?.getClip().name).toBe('Idle');
    },
    60000,
  );

  it.each(['miss', 'dodge', 'parry', 'block'] as const)(
    'keeps an actual Hunter %s swinging when its legacy event lacks a stable id',
    async (kind) => {
      const h = await harness();
      h.event({ ...damage('Woundrend'), kind } as SimEvent);
      expect(h.peek.current?.getClip().name).toBe('1H_Slash');
      expect(h.attackCount()).toBe(1);
    },
    60000,
  );

  it.each([
    'warrior',
    'paladin',
    'hunter',
    'rogue',
    'priest',
    'mage',
    'warlock',
    'druid',
    'shaman',
  ])(
    'uses a melee animation for a real %s melee hit',
    async (cls) => {
      const h = await harness(`player_${cls}`);
      h.event(damage(null));
      expect(['1H_Chop', '1H_Slash', '2H_Chop', 'Dual_Chop#main']).toContain(
        h.peek.current?.getClip().name,
      );
    },
    60000,
  );

  it('preserves primary and unknown damage cues while suppressing only known secondary outcomes', async () => {
    const h = await harness();
    h.event(damage('Woundrend', 'mongoose_bite'));
    h.event(damage('Unknown attack'));
    expect(h.attackCount()).toBe(2);
    expect(['1H_Chop', '1H_Slash']).toContain(h.peek.current?.getClip().name);
    h.event(damage('Bloodhook Re-entry'));
    expect(h.peek.current?.getClip().name).toBe('1H_Slash');
  }, 30000);

  it('preserves explicit Hunter ranged hits and keeps channel pulses from replacing the held volley', async () => {
    const h = await harness();
    for (const [name, id] of [
      ['Splitshot', 'multi_shot'],
      ['Shrapnel Charge', 'shrapnel_charge'],
      ['Rattling Shot', 'concussive_shot'],
    ]) {
      h.event(damage(name, id));
      expect(h.peek.current?.getClip().name, id).toBe('Ranged_Shoot');
    }
    const before = h.attackCount();
    h.event(damage('Volley'));
    h.event(damage('Fevered Draw', 'rapid_fire'));
    expect(h.attackCount()).toBe(before);
  }, 30000);

  it.each(['frostCone', 'fireCone'] as const)(
    'releases a Mage %s with its casting hand',
    async (fx) => {
      const h = await harness('player_mage');
      h.event({
        type: 'spellfx',
        sourceId: 1,
        targetId: 1,
        fx,
        school: fx === 'fireCone' ? 'fire' : 'frost',
        ability: fx === 'fireCone' ? 'dragons_breath' : 'glacial_front',
      });
      expect(h.peek.current?.getClip().name).toBe('Cast_Shoot');
    },
    60000,
  );

  it('releases the Paladin timed Mercy Lance when its direct damage resolves', async () => {
    const h = await harness('player_paladin');
    h.event({ ...damage('Mercy Lance', 'mercy_lance'), school: 'holy' } as SimEvent);
    expect(h.peek.current?.getClip().name).toBe('Cast_Shoot');
  }, 30000);

  it('preserves the Needle of Fate release when its dedicated projectile claims the event', async () => {
    const h = await harness('player_warlock');
    h.event({
      type: 'spellfx',
      sourceId: 1,
      targetId: 2,
      fx: 'projectile',
      school: 'shadow',
      ability: 'needle_of_fate',
    });
    expect(h.peek.current?.getClip().name).toBe('Cast_Shoot');
  }, 30000);
});
