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
          'Woc_Attack_Rifle',
          'Woc_Attack_1H_0',
          'Woc_Attack_1H_1',
          'Woc_Attack_1H_Stab',
          'Woc_Attack_2H_0',
          'Woc_Attack_2H_1',
          'Woc_Attack_Dual',
          'Woc_Attack_Dual#main',
          'Woc_Attack_Dual#off',
          'Woc_Attack_Offhand_Stab',
          'Woc_Cast_Directed',
          'Woc_Cast_Omni',
          'Woc_Cast_Shoot',
          'Woc_Cast_Omni_Release',
          'Woc_Channel_Directed',
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
          // the hand-keyed idle and gaits the WOC bodies play over the rig's own
          'Woc_Idle',
          'Woc_Walk',
          'Woc_Run',
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
    const aim = peek.action('Woc_Attack_Rifle#aim');
    const release = peek.action('Woc_Attack_Rifle#release');
    expect(aim).not.toBeNull();
    expect(release).not.toBeNull();
    // the snap shot (2026-09-29): split at 0.17 s, the release is the rest of the clip (the
    // stub clips here are 1 s long)
    expect(aim?.getClip().duration).toBeCloseTo(0.17, 5);
    expect(release?.getClip().duration).toBeCloseTo(1 - 0.17, 5);

    // Not holding an aim: the launch cue plays the authored shot from the raise.
    visual.playAttack();
    expect(peek.current?.getClip().name).toBe('Woc_Attack_Rifle');

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
    expect(peek.current?.getClip().name).toBe('Woc_Attack_Rifle#release');

    // A per-ability entry still names the tail for the damage-event arm.
    peek.baseState = 'idle';
    visual.playAttack('aimed_shot');
    expect(peek.current?.getClip().name).toBe('Woc_Attack_Rifle#release');
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
      /** The renderer's contact seam, as the hud calls it for every sim event. */
      atContact: (ev: SimEvent, fn: (ev: SimEvent) => void, self: unknown) =>
        (
          Renderer.prototype.atContact as (
            this: RendererType,
            ev: SimEvent,
            fn: (ev: SimEvent) => void,
            self: unknown,
          ) => void
        ).call(renderer, ev, fn, self),
      contactDelayFor: (ev: SimEvent) => Renderer.prototype.contactDelayFor.call(renderer, ev),
      tickContacts: (now: number) =>
        (renderer as unknown as { contactQueue: { tick(now: number): void } }).contactQueue.tick(
          now,
        ),
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

  it('hands a contact-staged call its receiver and its event, at once or at the blade', async () => {
    // Renderer.atContact is what the hud runs for EVERY sim event (its impact sound): the
    // caller's method must reach the queue with its receiver, or it runs detached from its
    // object. Real renderer method, real queue, a real swing's contact.
    const h = await harness();
    const calls: { self: unknown; ev: SimEvent }[] = [];
    const host = {
      play(this: unknown, ev: SimEvent): void {
        calls.push({ self: this, ev });
      },
    };
    // an event with no swing behind it: in place, on the receiver, with the event
    const cue = { type: 'spellfx', sourceId: 1, targetId: 2, fx: 'burst' } as unknown as SimEvent;
    expect(h.contactDelayFor(cue)).toBe(0);
    h.atContact(cue, host.play, host);
    expect(calls).toHaveLength(1);
    expect(calls[0].self).toBe(host);
    expect(calls[0].ev).toBe(cue);
    // a melee hit: the swing it starts reports its blade contact, and the call waits for it
    const hit = damage(null);
    h.event(hit);
    const delaySec = h.contactDelayFor(hit);
    expect(delaySec).toBeGreaterThan(0.1);
    const before = performance.now();
    h.atContact(hit, host.play, host);
    const after = performance.now();
    expect(calls).toHaveLength(1);
    h.tickContacts(before + delaySec * 1000 - 1);
    expect(calls).toHaveLength(1);
    h.tickContacts(after + delaySec * 1000 + 1);
    expect(calls).toHaveLength(2);
    expect(calls[1].self).toBe(host);
    expect(calls[1].ev).toBe(hit);
  });

  it('keeps Hunter melee autos swinging after a melee skill, while shot launches still shoot', async () => {
    const h = await harness();
    h.event(damage('Gutting Strike', 'raptor_strike'));
    expect(h.peek.current?.getClip().name).toBe('Woc_Attack_1H_0');
    h.event(damage(null));
    expect(['Woc_Attack_1H_0', 'Woc_Attack_1H_1']).toContain(h.peek.current?.getClip().name);
    h.event({
      type: 'spellfx',
      sourceId: 1,
      targetId: 2,
      fx: 'projectile',
      school: 'physical',
      attackAnimation: 'ranged-shot',
    });
    expect(h.peek.current?.getClip().name).toBe('Woc_Attack_Rifle');
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
      expect(h.peek.current?.getClip().name, label).toBe('Woc_Attack_1H_1');
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
    expect(h.peek.current?.getClip().name).toBe('Woc_Cast_Shoot');
  }, 30000);

  it('keeps Measured Shot on the held release across the real painter and renderer', async () => {
    const h = await harness();
    await h.usePainter();
    const aim = h.peek.action('Woc_Attack_Rifle#aim')!;
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
    expect(h.peek.current?.getClip().name).toBe('Woc_Attack_Rifle#release');
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
    expect(hunter.castByAbility?.tame_beast ?? hunter.cast).toBe('Woc_Channel_Directed');
    expect(hunter.castByAbility?.revive_pet ?? hunter.cast).toBe('Woc_Cast_Omni');
    const druid = VISUALS.player_druid.clips;
    expect(druid.castByAbility?.tranquility ?? druid.cast).toBe('Woc_Cast_Omni');
  });

  it.each([
    ['hunter', 'tame_beast', 'Woc_Channel_Directed'],
    ['hunter', 'revive_pet', 'Woc_Cast_Omni'],
    ['druid', 'tranquility', 'Woc_Cast_Omni'],
  ] as const)(
    'runs the %s %s channel until cast ends',
    async (cls, ability, expectedClip) => {
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
      expect(h.peek.current?.getClip().name).toBe(expectedClip);
      expect(h.peek.current?.paused).toBe(false);
      expect(h.peek.current?.isRunning()).toBe(true);
      h.visual.update(0.05, { ...state, casting: false, castingAbility: null }, true);
      expect(h.peek.current?.getClip().name).toBe('Woc_Idle');
    },
    60000,
  );

  it.each(['miss', 'dodge', 'parry', 'block'] as const)(
    'keeps an actual Hunter %s swinging when its legacy event lacks a stable id',
    async (kind) => {
      const h = await harness();
      h.event({ ...damage('Woundrend'), kind } as SimEvent);
      expect(h.peek.current?.getClip().name).toBe('Woc_Attack_1H_1');
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
      expect([
        'Woc_Attack_1H_0',
        'Woc_Attack_1H_1',
        'Woc_Attack_2H_0',
        'Woc_Attack_Dual#main',
      ]).toContain(h.peek.current?.getClip().name);
    },
    60000,
  );

  it('preserves primary and unknown damage cues while suppressing only known secondary outcomes', async () => {
    const h = await harness();
    h.event(damage('Woundrend', 'mongoose_bite'));
    h.event(damage('Unknown attack'));
    expect(h.attackCount()).toBe(2);
    expect(['Woc_Attack_1H_0', 'Woc_Attack_1H_1']).toContain(h.peek.current?.getClip().name);
    h.event(damage('Bloodhook Re-entry'));
    expect(h.peek.current?.getClip().name).toBe('Woc_Attack_1H_Stab');
  }, 30000);

  it('preserves explicit Hunter ranged hits without restarting on ground-zone or channel pulses', async () => {
    const h = await harness();
    for (const [name, id] of [
      ['Splitshot', 'multi_shot'],
      ['Shrapnel Charge', 'shrapnel_charge'],
      ['Rattling Shot', 'concussive_shot'],
    ]) {
      h.event(damage(name, id));
      expect(h.peek.current?.getClip().name, id).toBe('Woc_Attack_Rifle');
    }
    const before = h.attackCount();
    h.event(damage('Volley'));
    expect(h.attackCount()).toBe(before);
    h.event(damage('Fevered Draw', 'rapid_fire'));
    expect(h.attackCount()).toBe(before);
  }, 30000);

  it.each([
    ['frostCone', 'Woc_Cast_Shoot'],
    ['fireCone', 'Woc_Cast_Omni_Release'],
  ] as const)(
    'releases a Mage %s with its casting hand',
    async (fx, expectedClip) => {
      const h = await harness('player_mage');
      h.event({
        type: 'spellfx',
        sourceId: 1,
        targetId: 1,
        fx,
        school: fx === 'fireCone' ? 'fire' : 'frost',
        ability: fx === 'fireCone' ? 'dragons_breath' : 'glacial_front',
      });
      expect(h.peek.current?.getClip().name).toBe(expectedClip);
    },
    60000,
  );

  it('releases the Paladin timed Mercy Lance when its direct damage resolves', async () => {
    const h = await harness('player_paladin');
    h.event({ ...damage('Mercy Lance', 'mercy_lance'), school: 'holy' } as SimEvent);
    expect(h.peek.current?.getClip().name).toBe('Woc_Cast_Shoot');
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
    expect(h.peek.current?.getClip().name).toBe('Woc_Cast_Shoot');
  }, 30000);
});
