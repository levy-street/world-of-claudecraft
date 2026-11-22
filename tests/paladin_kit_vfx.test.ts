import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CastAdmission } from '../src/render/ability_vfx/cast_admission_core';
import { WALL_RING } from '../src/render/ability_vfx/hallowed_wall';
import { AbilityVfx } from '../src/render/ability_vfx/painter';
import { PaladinKit, type PaladinKitEntity } from '../src/render/ability_vfx/paladin_kit';
import type { PaladinQuadPool } from '../src/render/ability_vfx/paladin_quad_pool';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import type { PaladinVfxDetail } from '../src/render/ability_vfx/paladin_vfx_detail_core';
import { CHORUS_RADIUS } from '../src/render/ability_vfx/radiant_chorus';
import { GOAD_FIZZLE, GOAD_FLIGHT } from '../src/render/ability_vfx/sacred_goad';
import { INVOKE_BURST, SPLASH_GLINT_LIFE } from '../src/render/ability_vfx/solar_invocation';
import { VEIL_TETHER } from '../src/render/ability_vfx/veilbound_march';
import { VOW_WARD_END, VOW_WARD_RISE } from '../src/render/ability_vfx/vowkeeper_strike';
import { PLATE_GILDED } from '../src/render/ability_vfx/ward_of_faith';
import { AbilityVfxBudget } from '../src/render/ability_vfx_core';
import {
  bastionRiteShieldLeft,
  heldShieldFlash,
  vowkeeperWeaponGlow,
} from '../src/render/paladin_shield_buffs';

function fixture(bodyHeight = 1.8) {
  const scene = new THREE.Scene();
  // The Paladin (1) at the origin, an ally (2) and an enemy (3) ahead.
  const where = new Map<number, [number, number]>([
    [1, [0, 0]],
    [2, [3, 4]],
    [3, [0, 8]],
  ]);
  const anchor = vi.fn((id: number, height: number, out?: THREE.Vector3) => {
    const at = where.get(id);
    return at && out ? out.set(at[0], height * bodyHeight, at[1]) : null;
  });
  const kit = new PaladinKit({
    scene,
    anchor,
    groundY: () => 0,
    hand: () => false,
    facing: () => 0,
  });
  const program = { isReady: () => true, getUniforms: vi.fn(), getAttributes: vi.fn() };
  const gl = {
    properties: { get: () => ({ programs: new Map([['canvas', program]]) }) },
    compile: vi.fn(async () => {}),
    draw: vi.fn(),
  };
  /** Quads drawn by one part this frame, by shape id. */
  const drawn = (part: object) => {
    const pool = (part as { pool: PaladinQuadPool<string> }).pool;
    const g = pool.mesh.geometry;
    const shape = g.getAttribute('aShape');
    const seen = new Map<number, number>();
    for (let i = 0; i < g.drawRange.count; i += 6)
      seen.set(shape.getX(i), (seen.get(shape.getX(i)) ?? 0) + 1);
    return seen;
  };
  const entity = (
    id: number,
    auras: PaladinKitEntity['auras'] = [],
    cast: Partial<PaladinKitEntity> = {},
  ): PaladinKitEntity => ({
    id,
    dead: false,
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    castTargetId: null,
    auras,
    ...cast,
  });
  return {
    kit,
    scene,
    drawn,
    entity,
    prepare: async () => {
      for (const u of kit.units(gl)) await u.run();
    },
  };
}

const aura = (id: string, kind: string, value?: number) => ({
  id,
  kind,
  remaining: 4,
  duration: 8,
  value,
});

describe('Paladin kit', () => {
  // Node runs at the Medium preset: pin the authored composition.
  beforeEach(() => setPaladinVfxDetailForTest('full'));
  afterEach(() => setPaladinVfxDetailForTest(null));

  it('prepares every part before it draws anything', async () => {
    const f = fixture();
    const units = f.kit.units({
      properties: { get: () => ({ programs: new Map() }) },
      compile: vi.fn(async () => {}),
      draw: vi.fn(),
    } as never);
    // One prewarm unit per authored part.
    expect(units.length).toBeGreaterThanOrEqual(15);
    f.kit.presence(
      f.entity(1, [], {
        castingAbility: 'mercy_lance',
        castTotal: 1.75,
        castRemaining: 1,
        castTargetId: 3,
      }),
    );
    f.kit.update(0.05, false);
    expect(f.drawn(f.kit.mercyLance).size).toBe(0);
    await f.prepare();
    f.kit.presence(
      f.entity(1, [], {
        castingAbility: 'mercy_lance',
        castTotal: 1.75,
        castRemaining: 1,
        castTargetId: 3,
      }),
    );
    f.kit.update(0.05, false);
    expect(f.drawn(f.kit.mercyLance).get(0)).toBe(1);
    f.kit.dispose();
    expect(f.scene.children).toHaveLength(0);
  });

  it('forms the Mercy Lance through the cast and hurls it on the hit', async () => {
    const f = fixture();
    await f.prepare();
    const casting = f.entity(1, [], {
      castingAbility: 'mercy_lance',
      castTotal: 1.75,
      castRemaining: 0.2,
      castTargetId: 3,
    });
    f.kit.presence(casting);
    f.kit.update(0.05, true);
    expect(f.drawn(f.kit.mercyLance).get(0)).toBe(1);
    expect(f.kit.mercyLance.strike(1, 3, 'damage')).toBe(true);
    for (let i = 0; i < 4; i++) f.kit.update(0.05, false);
    const strike = f.drawn(f.kit.mercyLance);
    // The lance driven through, the flare and the ring of the strike.
    expect(strike.get(0)).toBe(1);
    expect(strike.get(2)).toBeGreaterThanOrEqual(1);
    expect(strike.get(3)).toBe(1);
    for (let i = 0; i < 30; i++) f.kit.update(0.05, false);
    expect(f.drawn(f.kit.mercyLance).size).toBe(0);
  });

  it.each([1.1, 1.8, 3.2])(
    'keeps the held lance above a %s-metre character and clears an interrupted cast',
    async (height) => {
      const f = fixture(height);
      await f.prepare();
      for (const target of [3, null]) {
        f.kit.mercyLance.channel(1, target, 0.9);
        f.kit.update(0.1, true);
        const pool = (f.kit.mercyLance as unknown as { pool: PaladinQuadPool<string> }).pool;
        const g = pool.mesh.geometry;
        const shape = g.getAttribute('aShape');
        const position = g.getAttribute('position');
        let lanceVertices = 0;
        for (let i = 0; i < g.drawRange.count; i++) {
          if (shape.getX(i) !== 0) continue;
          expect(position.getY(i)).toBeGreaterThan(height + 0.3);
          lanceVertices++;
        }
        expect(lanceVertices).toBe(6);
      }
      // No more channel presence: the suspended weapon must not linger.
      for (let i = 0; i < 8; i++) f.kit.update(0.1, false);
      expect(f.drawn(f.kit.mercyLance).size).toBe(0);
      f.kit.dispose();
    },
  );

  it('holds each Paladin aura from presence and lets it fade when it goes', async () => {
    const f = fixture();
    await f.prepare();
    const hold = (auras: PaladinKitEntity['auras']) => {
      f.kit.presence(f.entity(2, auras));
      f.kit.update(0.1, true);
    };
    hold([aura('beacon_of_light', 'beacon_of_light')]);
    expect(f.drawn(f.kit.beaconOfLight).get(0)).toBe(1);
    hold([aura('sacred_form', 'sacred_form')]);
    expect(f.drawn(f.kit.sacredForm).get(0)).toBe(1);
    // Sacred Form's halo over the head.
    expect(f.drawn(f.kit.sacredForm).get(5)).toBe(1);
    hold([aura('life_covenant', 'buff_dr')]);
    expect(f.kit.lifeCovenant.ward.mesh.visible).toBe(true);
    hold([aura('bastion_rite', 'buff_dr_phys')]);
    // The held shield is told of the rite.
    expect(bastionRiteShieldLeft(2)).toBeCloseTo(0.5);
    expect(f.drawn(f.kit.bastionRite).get(0)).toBe(6);
    hold([aura('holy_shield', 'buff_block'), aura('holy_shield_absorb', 'absorb', 50)]);
    // Hallowed Wall's ring of shield plates, all six standing.
    expect(f.kit.hallowedWall.plates.standing(2)).toBe(6);
    expect(f.kit.hallowedWall.plates.mesh.visible).toBe(true);
    hold([aura('oath_chain_slow', 'slow')]);
    const bound = f.drawn(f.kit.oathChain);
    // The shackle about the waist and the binding runes underfoot.
    expect(bound.get(3)).toBe(1);
    expect(bound.get(4)).toBe(1);
    // Nothing held: every part fades out.
    for (let i = 0; i < 20; i++) {
      f.kit.presence(f.entity(2));
      f.kit.update(0.1, true);
    }
    expect(f.kit.hallowedWall.plates.mesh.visible).toBe(false);
    for (const part of [
      f.kit.beaconOfLight,
      f.kit.sacredForm,
      f.kit.lifeCovenant,
      f.kit.bastionRite,
      f.kit.hallowedWall,
      f.kit.oathChain,
    ])
      expect(f.drawn(part).size).toBe(0);
    expect(f.kit.lifeCovenant.ward.mesh.visible).toBe(false);
  });

  it('throws the Oath Chain, holds it taut through the pull and shatters it on arrival', async () => {
    const f = fixture();
    await f.prepare();
    const pulled = { ...aura('oath_chain_pull', 'forced_move'), sourceId: 1 };
    const slowed = { ...aura('oath_chain_slow', 'slow'), sourceId: 1 };
    expect(f.kit.oathChain.lash(1, 3)).toBe(true);
    f.kit.update(0.05, false);
    // Thrown: links on the way out and the blazing head.
    const thrown = f.drawn(f.kit.oathChain);
    expect((thrown.get(0) ?? 0) + (thrown.get(1) ?? 0)).toBeGreaterThan(5);
    expect(thrown.get(2)).toBe(1);
    // Held through the pull: the whole chain, the shackle and the furrows.
    for (let i = 0; i < 6; i++) {
      f.kit.presence(f.entity(3, [pulled]));
      f.kit.update(0.05, false);
    }
    const held = f.drawn(f.kit.oathChain);
    expect((held.get(0) ?? 0) + (held.get(1) ?? 0)).toBeGreaterThan(30);
    expect(held.get(3)).toBe(1);
    expect(held.get(6)).toBe(1);
    // Arrived: the chain shatters into motes; the slow keeps shackle and runes.
    for (let i = 0; i < 4; i++) {
      f.kit.presence(f.entity(3, [slowed]));
      f.kit.update(0.05, false);
    }
    expect(f.drawn(f.kit.oathChain).get(5)).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) {
      f.kit.presence(f.entity(3, [slowed]));
      f.kit.update(0.05, false);
    }
    const after = f.drawn(f.kit.oathChain);
    expect(after.get(0) ?? 0).toBe(0);
    expect(after.get(4)).toBe(1);
    // An enemy that cannot be pulled shakes the chain off.
    f.kit.oathChain.lash(1, 2);
    for (let i = 0; i < 25; i++) f.kit.update(0.05, false);
    expect(f.drawn(f.kit.oathChain).get(0) ?? 0).toBe(0);
  });

  it('calls the Sacred Goad out, strikes, brands the enemy and lets go', async () => {
    const f = fixture();
    await f.prepare();
    expect(f.kit.sacredGoad.goad(1, 3)).toBe(true);
    f.kit.update(0.05, false);
    // The call: the sign before the Paladin, a ring rolling out, the lance thrown.
    const call = f.drawn(f.kit.sacredGoad);
    expect(call.get(1)).toBe(1);
    expect(call.get(5)).toBeGreaterThanOrEqual(1);
    expect(call.get(0)).toBe(1);
    for (let i = 0; i < 4; i++) f.kit.update(0.05, false);
    // Struck: the burst, the brand over the head, the circle and the thread home.
    const struck = f.drawn(f.kit.sacredGoad);
    expect(struck.get(0) ?? 0).toBe(0);
    expect(struck.get(3)).toBe(1);
    expect(struck.get(4)).toBe(1);
    expect(struck.get(6)).toBe(1);
    expect(struck.get(1)).toBeGreaterThanOrEqual(1);
    // The brand and circle hold for the whole 3 s taunt, then let go.
    for (let i = 0; i < 50; i++) f.kit.update(0.05, false);
    const held = f.drawn(f.kit.sacredGoad);
    expect(held.get(1)).toBe(1);
    expect(held.get(6)).toBe(1);
    for (let i = 0; i < 20; i++) f.kit.update(0.05, false);
    expect(f.drawn(f.kit.sacredGoad).size).toBe(0);
  });

  it('marks the enemies passed through and strikes each the moment its hit lands', async () => {
    const f = fixture();
    await f.prepare();
    const marched = aura('veilbound_march', 'buff_speed');
    const marked = aura('veilbound_mark', 'dot');
    for (let i = 0; i < 12; i++) {
      f.kit.presence(f.entity(1, [marched]));
      f.kit.presence(f.entity(2, [marked]));
      f.kit.update(0.05, false);
    }
    const marching = f.drawn(f.kit.veilboundMarch);
    // The shroud about the Paladin and the eye over the marked enemy (its
    // marking flash long gone).
    expect(marching.get(8)).toBe(1);
    expect(marching.get(1)).toBe(1);
    expect(marching.get(9) ?? 0).toBe(0);
    // The final wave's hit (its damage event): in that very frame the veil
    // snaps shut on the enemy, flares and ripples. No timer before it.
    expect(f.kit.veilboundMarch.strike(1, 2)).toBe(true);
    f.kit.presence(f.entity(1, [marched]));
    f.kit.presence(f.entity(2, [marked]));
    f.kit.update(0.016, false);
    const hit = f.drawn(f.kit.veilboundMarch);
    expect(hit.get(7)).toBe(1);
    expect(hit.get(2)).toBeGreaterThanOrEqual(1);
    expect(hit.get(9)).toBe(1);
    for (let i = 0; i < 4; i++) {
      f.kit.presence(f.entity(2, [marked]));
      f.kit.update(0.05, false);
    }
    expect(f.drawn(f.kit.veilboundMarch).get(7) ?? 0).toBe(0);
    expect(f.drawn(f.kit.veilboundMarch).get(9)).toBe(1);
  });

  it('bursts only from the final wave, never from the march aura going', async () => {
    const f = fixture();
    await f.prepare();
    const marched = aura('veilbound_march', 'buff_speed');
    // Enemy 2 carries a mark from Paladin 9, not from Paladin 1.
    const theirs = { ...aura('veilbound_mark', 'dot'), sourceId: 9 };
    for (let i = 0; i < 6; i++) {
      f.kit.presence(f.entity(1, [marched]));
      f.kit.presence(f.entity(2, [theirs]));
      f.kit.update(0.05, false);
    }
    // The aura alone ending (no final wave): no burst, no strike.
    f.kit.presence(f.entity(1));
    f.kit.presence(f.entity(2, [theirs]));
    f.kit.update(0.05, false);
    expect(f.drawn(f.kit.veilboundMarch).get(3) ?? 0).toBe(0);
    expect(f.drawn(f.kit.veilboundMarch).get(7) ?? 0).toBe(0);
    // Paladin 1's wave bursts where it is cued; no hit on the other's mark,
    // so no closing ring there.
    expect(f.kit.veilboundMarch.burst(1, 0, 0)).toBe(true);
    f.kit.presence(f.entity(2, [theirs]));
    f.kit.update(0.016, false);
    expect(f.drawn(f.kit.veilboundMarch).get(3)).toBe(1);
    expect(f.drawn(f.kit.veilboundMarch).get(7) ?? 0).toBe(0);
  });

  it('lands the Vowkeeper Strike as the swing peaks, or at the latest after it', async () => {
    const f = fixture();
    await f.prepare();
    // No weapon hand known (hand() is false): the impact lands at once.
    expect(f.kit.vowkeeperStrike.strike(1, 3, 'damage')).toBe(true);
    f.kit.update(0.05, false);
    const hit = f.drawn(f.kit.vowkeeperStrike);
    // The starburst, the flare, the shaft of light and the shock.
    expect(hit.get(0)).toBe(1);
    expect(hit.get(2)).toBe(1);
    expect(hit.get(6)).toBe(1);
    expect(hit.get(5)).toBe(1);
    // The weapon is told to flare.
    expect(vowkeeperWeaponGlow(1)?.flash).toBeGreaterThan(0.3);
    // No sign is branded on the enemy.
    for (let i = 0; i < 4; i++) f.kit.update(0.05, false);
    expect(f.drawn(f.kit.vowkeeperStrike).has(1)).toBe(false);
    for (let i = 0; i < 30; i++) f.kit.update(0.05, false);
    expect(f.drawn(f.kit.vowkeeperStrike).size).toBe(0);
    expect(f.kit.vowkeeperStrike.strike(1, 3, 'none')).toBe(false);
  });

  it('glances a resisted Sunward Disc off the enemy in a spark, not the full burst', async () => {
    const f = fixture();
    await f.prepare();
    f.kit.sunwardDisc.hurl(1, 3);
    f.kit.update(0.05, false);
    // The impact cue and its resisted damage arrive in one batch.
    f.kit.sunwardDisc.strike(1, 3, 0, 3);
    expect(f.kit.sunwardDisc.glance(3)).toBe(true);
    f.kit.update(0.05, false);
    const glanced = f.drawn(f.kit.sunwardDisc);
    // A small glint and a few sparks: no shield-shaped burst.
    expect(glanced.get(2)).toBe(1);
    expect(glanced.get(3) ?? 0).toBe(0);
    expect(glanced.get(4) ?? 0).toBeGreaterThan(0);
    expect(glanced.get(4) ?? 0).toBeLessThanOrEqual(4);
    // No bounce follows a resist: the shield heads straight home.
    for (let i = 0; i < 3; i++) f.kit.update(0.05, false);
    expect(f.drawn(f.kit.sunwardDisc).get(0)).toBe(1);
    // A verdict long after the strike belongs to no strike of this one.
    f.kit.sunwardDisc.hurl(1, 3);
    f.kit.sunwardDisc.strike(1, 3, 0, 3);
    for (let i = 0; i < 3; i++) f.kit.update(0.05, false);
    expect(f.kit.sunwardDisc.glance(3)).toBe(false);
    // Without a glance the full impact plays.
    f.kit.sunwardDisc.strike(1, 2, 0, 3);
    f.kit.update(0.05, false);
    expect(f.drawn(f.kit.sunwardDisc).get(3)).toBeGreaterThan(0);
  });

  it('routes a Sunward Disc that did nothing to the glance, leaving real hits alone', () => {
    const glance = vi.fn();
    const painter = Object.assign(Object.create(AbilityVfx.prototype), {
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      deps: { fx: { paladinKit: { sunwardDisc: { glance } } }, anchor: () => null },
      // A hit the kit leaves alone takes the release's path, which admits it
      // through the cast gate first: closed here, so it draws nothing.
      admission: new CastAdmission({ admit: () => false, ready: () => false }),
      now: () => 0,
    }) as AbilityVfx;
    const hit = {
      sourceId: 1,
      targetId: 3,
      school: 'holy',
      ability: 'Sunward Disc',
      abilityId: 'sunward_disc',
      kind: 'hit',
      crit: false,
      amount: 0,
    };
    for (const kind of ['resist', 'miss']) expect(painter.onDamage({ ...hit, kind })).toBe(true);
    expect(glance).toHaveBeenCalledTimes(2);
    expect(glance).toHaveBeenLastCalledWith(3);
    // A ward soaking the blow is still a hit landing.
    expect(painter.onDamage({ ...hit, absorbed: 30 })).not.toBe(true);
    expect(glance).toHaveBeenCalledTimes(2);
  });

  it('snaps an Oath Chain the enemy refuses: taut, straining, parting in the middle', async () => {
    const f = fixture();
    await f.prepare();
    expect(f.kit.oathChain.lash(1, 3)).toBe(true);
    expect(f.kit.oathChain.refuse(1, 3)).toBe(true);
    let shackles = 0;
    let flares = 0;
    let motes = 0;
    for (let i = 0; i < 30; i++) {
      f.kit.update(0.05, false);
      const d = f.drawn(f.kit.oathChain);
      shackles += d.get(3) ?? 0;
      flares += d.get(2) ?? 0;
      motes += d.get(5) ?? 0;
    }
    // Never caught: no shackle; the head, its bite and the snap flare; the
    // halves shatter into motes, and then it is gone.
    expect(shackles).toBe(0);
    expect(flares).toBeGreaterThan(3);
    expect(motes).toBeGreaterThan(0);
    expect(f.drawn(f.kit.oathChain).get(0) ?? 0).toBe(0);
    // A chain the pull already holds is not refused.
    f.kit.oathChain.lash(1, 3);
    f.kit.presence(f.entity(3, [{ ...aura('oath_chain_pull', 'forced_move'), sourceId: 1 }]));
    expect(f.kit.oathChain.refuse(1, 3)).toBe(false);
  });

  it('routes an Oath Chain at an unmovable or resisting enemy to the snap', () => {
    const lash = vi.fn();
    const refuse = vi.fn();
    const releaseGesture = vi.fn();
    const painter = Object.assign(Object.create(AbilityVfx.prototype), {
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
      deps: { fx: { paladinKit: { oathChain: { lash, refuse } } } },
      releaseGesture,
    }) as AbilityVfx;
    const cast = {
      sourceId: 1,
      targetId: 3,
      school: 'holy',
      fx: 'selfCast',
      ability: 'oath_chain',
    };
    expect(painter.handleSpellfx(cast)).toBe(true);
    expect(refuse).not.toHaveBeenCalled();
    expect(painter.handleSpellfx({ ...cast, immune: true })).toBe(true);
    expect(lash).toHaveBeenCalledTimes(2);
    expect(refuse).toHaveBeenCalledExactlyOnceWith(1, 3);
    expect(
      painter.onDamage({
        sourceId: 1,
        targetId: 3,
        school: 'holy',
        ability: 'Oath Chain',
        abilityId: 'oath_chain',
        kind: 'resist',
        crit: false,
        amount: 0,
      }),
    ).toBe(true);
    expect(refuse).toHaveBeenCalledTimes(2);
  });

  it('throws the Sunward Disc, bounces it and brings it home to be caught', async () => {
    const f = fixture();
    await f.prepare();
    expect(f.kit.sunwardDisc.hurl(1, 3)).toBe(true);
    f.kit.update(0.05, false);
    // In flight: the spinning shield and its trail; the held shield flashes.
    expect(f.drawn(f.kit.sunwardDisc).get(0)).toBe(1);
    expect(heldShieldFlash(1)).toBeGreaterThan(0.5);
    // It strikes the enemy and bounces on to the next.
    f.kit.sunwardDisc.strike(1, 3, 0, 2);
    f.kit.update(0.05, false);
    expect(f.drawn(f.kit.sunwardDisc).get(3)).toBe(1);
    expect(f.kit.sunwardDisc.hurl(3, 2)).toBe(true);
    for (let i = 0; i < 4; i++) f.kit.update(0.05, false);
    f.kit.sunwardDisc.strike(3, 2, 1, 2);
    // The last hit: it flies home, and the Paladin catches it.
    for (let i = 0; i < 4; i++) f.kit.update(0.05, false);
    expect(f.drawn(f.kit.sunwardDisc).get(0)).toBe(1);
    for (let i = 0; i < 20; i++) f.kit.update(0.05, false);
    expect(f.drawn(f.kit.sunwardDisc).size).toBe(0);
    expect(heldShieldFlash(1)).toBe(0);
    // A last bounce onto an enemy with no view still sends it home.
    f.kit.sunwardDisc.hurl(1, 3);
    f.kit.sunwardDisc.strike(1, 3, 0, 2);
    f.kit.update(0.05, false);
    f.kit.sunwardDisc.hurl(3, 99);
    f.kit.sunwardDisc.strike(3, 99, 1, 2);
    for (let i = 0; i < 4; i++) f.kit.update(0.05, false);
    expect(f.drawn(f.kit.sunwardDisc).get(0)).toBe(1);
  });

  it('streams the veil while marching and bursts it on the final wave', async () => {
    const f = fixture();
    await f.prepare();
    f.kit.presence(f.entity(1, [aura('veilbound_march', 'buff_speed')]));
    f.kit.update(0.05, false);
    f.kit.presence(f.entity(1, [aura('veilbound_march', 'buff_speed')]));
    f.kit.update(0.05, false);
    expect(f.drawn(f.kit.veilboundMarch).get(0)).toBeGreaterThan(0);
    expect(f.kit.veilboundMarch.burst(1, 0, 0)).toBe(true);
    f.kit.presence(f.entity(1));
    f.kit.update(0.05, false);
    // The burst: its flare and its ring.
    expect(f.drawn(f.kit.veilboundMarch).get(2)).toBeGreaterThanOrEqual(1);
    expect(f.drawn(f.kit.veilboundMarch).get(3)).toBe(1);
  });

  it("runs Radiant Chorus's wave out to the heal's true reach", async () => {
    const f = fixture();
    await f.prepare();
    const reach = () => {
      const pool = (f.kit.radiantChorus as unknown as { pool: PaladinQuadPool<string> }).pool;
      const g = pool.mesh.geometry;
      const shape = g.getAttribute('aShape');
      const position = g.getAttribute('position');
      let far = 0;
      for (let i = 0; i < g.drawRange.count; i++)
        if (shape.getX(i) === 6) far = Math.max(far, Math.abs(position.getX(i)));
      return far;
    };
    expect(f.kit.radiantChorus.release(1)).toBe(true);
    f.kit.update(0.05, false);
    // Until the sim reports it, the ability's own 30 m.
    expect(reach()).toBeCloseTo(CHORUS_RADIUS, 0);
    // Ascension's 40 m.
    f.kit.radiantChorus.span(1, 40);
    f.kit.update(0.05, false);
    expect(reach()).toBeCloseTo(40, 0);
  });

  it("carries the hymn to each ally and a beacon's copy from the ally healed", async () => {
    const f = fixture();
    await f.prepare();
    f.kit.healed(1, 2, 'Radiant Chorus');
    f.kit.healed(1, 1, 'Radiant Chorus');
    f.kit.update(0.1, false);
    // One ribbon, to the ally: none to the Paladin themselves.
    expect(f.drawn(f.kit.radiantChorus).get(2)).toBeGreaterThan(0);
    f.kit.presence(f.entity(3, [aura('beacon_of_light', 'beacon_of_light')]));
    f.kit.healed(1, 2, 'Mending Light');
    f.kit.healed(1, 3, 'Beacon of Light');
    f.kit.update(0.1, false);
    const beacon = f.drawn(f.kit.beaconOfLight);
    // The thread from the ally healed, and the beacon flaring.
    expect(beacon.get(5)).toBeGreaterThan(0);
    expect(beacon.get(3)).toBeGreaterThanOrEqual(1);
  });

  it("spreads Solar Invocation's Ascension splash to its true reach and glints each ally it heals", async () => {
    const f = fixture();
    await f.prepare();
    const solar = f.kit.solarInvocation;
    const glints = () =>
      (solar as unknown as { glints: { active: boolean }[] }).glints.filter((g) => g.active).length;
    // No invocation on the enemy: nothing to splash from.
    expect(solar.splash(1, 3, 10)).toBe(false);
    expect(solar.invoke(1, 2, true)).toBe(true);
    // The primary heal comes before the splash: no glint for it.
    f.kit.healed(1, 2, 'Solar Invocation');
    expect(glints()).toBe(0);
    expect(solar.splash(1, 2, 10)).toBe(true);
    // The splash heals the ally at its heart again (no glint) and the enemy-side
    // ally 3 (fixture position), five yards off.
    f.kit.healed(1, 2, 'Solar Invocation');
    f.kit.healed(1, 3, 'Solar Invocation');
    expect(glints()).toBe(1);
    f.kit.update(INVOKE_BURST + 0.4, false);
    expect(f.drawn(solar).get(14)).toBe(1);
    // The ring's edge: ten yards round the ally at (3, 4).
    const pool = (solar as unknown as { pool: PaladinQuadPool<string> }).pool;
    const g = pool.mesh.geometry;
    const shape = g.getAttribute('aShape');
    const position = g.getAttribute('position');
    let far = 0;
    for (let i = 0; i < g.drawRange.count; i++)
      if (shape.getX(i) === 14) far = Math.max(far, Math.abs(position.getX(i) - 3));
    expect(far * 0.96).toBeCloseTo(10, 0);
    f.kit.update(SPLASH_GLINT_LIFE, false);
    expect(glints()).toBe(0);
  });

  it("spreads Solar Invocation's offensive Ascension splash and sears each other enemy, no pluses", async () => {
    const f = fixture();
    await f.prepare();
    const solar = f.kit.solarInvocation;
    const glints = () =>
      (solar as unknown as { glints: { active: boolean; healing: boolean }[] }).glints.filter(
        (g) => g.active,
      );
    expect(solar.invoke(1, 3, false)).toBe(true);
    expect(solar.striking(1)).toBe(false);
    expect(solar.splash(1, 3, 10)).toBe(true);
    expect(solar.striking(1)).toBe(true);
    // The target already stands in the shaft; another enemy glints.
    expect(solar.reach(1, 3)).toBe(false);
    expect(solar.reach(1, 2)).toBe(true);
    expect(glints().map((g) => g.healing)).toEqual([false]);
    f.kit.update(0.6, false);
    const drawn = f.drawn(solar);
    expect(drawn.get(14)).toBe(1);
    expect(drawn.get(9) ?? 0).toBe(0);
  });

  it("holds Vowkeeper's Ascension ward while it lasts, shattering it when broken", async () => {
    const f = fixture();
    await f.prepare();
    const vow = f.kit.vowkeeperStrike;
    const ward = (value: number, remaining = 4) => ({
      ...aura('vowkeeper_strike_absorb', 'absorb', value),
      remaining,
    });
    const color = () => {
      const pool = (vow as unknown as { pool: PaladinQuadPool<string> }).pool;
      const g = pool.mesh.geometry;
      const shape = g.getAttribute('aShape');
      const c = g.getAttribute('aColor');
      for (let i = 0; i < g.drawRange.count; i += 6)
        if (shape.getX(i) === 7) return [c.getX(i), c.getZ(i)];
      return null;
    };
    f.kit.presence(f.entity(1, [ward(60)]));
    f.kit.update(VOW_WARD_RISE, false);
    expect(f.drawn(vow).get(7)).toBe(1);
    // Spent down, but held.
    f.kit.presence(f.entity(1, [ward(20)]));
    f.kit.update(0.05, false);
    expect(f.drawn(vow).get(7)).toBe(1);
    // Gone with time on it: broken, it shatters (ivory) and is gone.
    f.kit.presence(f.entity(1));
    f.kit.update(0.05, false);
    const [r, b] = color() ?? [0, 0];
    expect(b).toBeGreaterThan(r * 0.4);
    f.kit.update(VOW_WARD_END, false);
    expect(f.drawn(vow).get(7) ?? 0).toBe(0);
    // Run out: it fades in its own gold.
    f.kit.presence(f.entity(1, [ward(60, 0.1)]));
    f.kit.update(0.05, false);
    f.kit.presence(f.entity(1));
    f.kit.update(0.05, false);
    const [r2, b2] = color() ?? [0, 1];
    expect(b2).toBeLessThan(r2 * 0.4);
  });

  it("hauls each mark in on a tether only when Ascension empowers Veilbound's burst", async () => {
    for (const ascended of [false, true]) {
      const f = fixture();
      await f.prepare();
      const marched = { ...aura('veilbound_march', 'buff_speed'), value2: ascended ? 1 : 0 };
      const marked = aura('veilbound_mark', 'dot');
      for (let i = 0; i < 4; i++) {
        f.kit.presence(f.entity(1, [marched]));
        f.kit.presence(f.entity(2, [marked]));
        f.kit.update(0.05, false);
      }
      // The final wave's hit on the mark, while the march still holds.
      f.kit.veilboundMarch.strike(1, 2);
      f.kit.presence(f.entity(1));
      f.kit.presence(f.entity(2, [marked]));
      f.kit.update(0.05, false);
      expect(f.drawn(f.kit.veilboundMarch).get(10) ?? 0).toBe(ascended ? 1 : 0);
      for (let i = 0; i < VEIL_TETHER / 0.05 + 1; i++) {
        f.kit.presence(f.entity(2, [marked]));
        f.kit.update(0.05, false);
      }
      expect(f.drawn(f.kit.veilboundMarch).get(10) ?? 0).toBe(0);
    }
  });

  it('routes the splash to Solar Invocation and gives every spent charge one cue', () => {
    const splash = vi.fn();
    const painter = Object.assign(Object.create(AbilityVfx.prototype), {
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
      deps: { fx: { paladinKit: { solarInvocation: { splash } } } },
    }) as AbilityVfx;
    const cue = (fx: string, ability: string, range?: number) =>
      painter.handleSpellfx({
        sourceId: 1,
        targetId: 2,
        school: 'holy',
        fx,
        ability,
        ...(range === undefined ? {} : { range }),
      });
    expect(cue('nova', 'solar_invocation', 10)).toBe(true);
    expect(splash).toHaveBeenCalledExactlyOnceWith(1, 2, 10);
    // The Ascension charge's cue is the Paladin's own halo, never the generic burst.
    for (const ability of ['mercy_lance', 'sunward_disc', 'bastion_sweep', 'vowkeeper_strike'])
      expect(cue('paladinAscensionImpact', ability)).toBe(true);
  });

  it("shows Mercy Lance's critical strike, which Ascension makes certain", async () => {
    for (const critical of [false, true]) {
      const f = fixture();
      await f.prepare();
      expect(f.kit.mercyLance.strike(1, 3, 'damage', critical)).toBe(true);
      f.kit.update(0.25, false);
      // The strike's ring, and a second, wider one for a critical strike.
      expect(f.drawn(f.kit.mercyLance).get(3)).toBe(critical ? 2 : 1);
    }
  });

  it("gilds Dawn's Embrace with a second wave of gold when Ascension empowers it", async () => {
    for (const gilded of [false, true]) {
      const f = fixture();
      await f.prepare();
      expect(f.kit.dawnsEmbrace.embrace(1, 2)).toBe(true);
      if (gilded) expect(f.kit.dawnsEmbrace.gild(1)).toBe(true);
      f.kit.update(0.6, false);
      expect(f.drawn(f.kit.dawnsEmbrace).get(4)).toBe(gilded ? 2 : 1);
    }
    // Nothing to gild without a fresh embrace.
    const f = fixture();
    await f.prepare();
    expect(f.kit.dawnsEmbrace.gild(1)).toBe(false);
  });

  it('routes each gilded Ascension change to its own visual', () => {
    const gild = vi.fn();
    const gildTollingHammer = vi.fn();
    const notePaladinConsecrationAscended = vi.fn();
    const painter = Object.assign(Object.create(AbilityVfx.prototype), {
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
      deps: {
        fx: {
          paladinKit: { dawnsEmbrace: { gild } },
          gildTollingHammer,
          notePaladinConsecrationAscended,
        },
      },
    }) as AbilityVfx;
    const cue = (ability: string) =>
      painter.handleSpellfx({
        sourceId: 1,
        targetId: 1,
        school: 'holy',
        fx: 'paladinAscensionImpact',
        ability,
      });
    for (const ability of ['dawns_embrace', 'hammer_of_wrath', 'consecration'])
      expect(cue(ability)).toBe(true);
    expect(gild).toHaveBeenCalledExactlyOnceWith(1);
    expect(gildTollingHammer).toHaveBeenCalledExactlyOnceWith(1);
    expect(notePaladinConsecrationAscended).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('runs the Hallowed Wall threat ring out again on a recast while it stands', async () => {
    const f = fixture();
    await f.prepare();
    const wall = [aura('holy_shield', 'buff_block'), aura('holy_shield_absorb', 'absorb', 50)];
    const hold = (frames: number) => {
      for (let i = 0; i < frames; i++) {
        f.kit.presence(f.entity(1, wall));
        f.kit.update(0.1, true);
      }
    };
    hold(1);
    // Raised: the ring runs out across the ground.
    expect(f.drawn(f.kit.hallowedWall).get(0)).toBe(1);
    hold(WALL_RING / 0.1 + 1);
    expect(f.drawn(f.kit.hallowedWall).get(0) ?? 0).toBe(0);
    // Recast while the wall still stands: the ring runs out again.
    f.kit.hallowedWallCast(1);
    hold(1);
    expect(f.drawn(f.kit.hallowedWall).get(0)).toBe(1);
    expect(f.kit.hallowedWall.plates.standing(1)).toBe(6);
  });

  it('gilds Hallowed Wall when Ascension empowers it, and only that cast', async () => {
    const f = fixture();
    await f.prepare();
    const wall = [aura('holy_shield', 'buff_block'), aura('holy_shield_absorb', 'absorb', 75)];
    const plateParams = () => {
      const g = f.kit.hallowedWall.plates.mesh.geometry;
      const shape = g.getAttribute('aShape');
      const param = g.getAttribute('aParam');
      const out: number[] = [];
      for (let i = 0; i < g.drawRange.count; i += 6)
        if (shape.getX(i) === 0) out.push(param.getX(i));
      return out;
    };
    const ringColor = () => {
      const pool = (f.kit.hallowedWall as unknown as { pool: PaladinQuadPool<string> }).pool;
      const c = pool.mesh.geometry.getAttribute('aColor');
      return [c.getX(0), c.getY(0), c.getZ(0)];
    };
    // Cast, then its Ascension cue, both before the aura is first seen.
    f.kit.hallowedWallCast(1);
    f.kit.hallowedWall.gild(1);
    f.kit.presence(f.entity(1, wall));
    f.kit.update(0.7, true);
    expect(f.kit.hallowedWall.plates.gilded(1)).toBe(true);
    const gilded = plateParams();
    expect(gilded).toHaveLength(6);
    // The spec icon (protection, 1) plus the gilt marker the shader reads.
    for (const p of gilded) expect(p).toBe(1 + PLATE_GILDED);
    const gold = ringColor();
    // An ordinary recast over it: the gilt goes with the empowered cast.
    f.kit.hallowedWallCast(1);
    f.kit.presence(f.entity(1, wall));
    f.kit.update(0.1, true);
    expect(f.kit.hallowedWall.plates.gilded(1)).toBe(false);
    for (const p of plateParams()) expect(p).toBe(1);
    // The ring burns a deeper, brighter gold when gilded.
    const plain = ringColor();
    expect(gold[0]).toBeGreaterThan(plain[0]);
    expect(gold[2] / gold[0]).toBeLessThan(plain[2] / plain[0]);
    // A stale cue with no wall following it lets go.
    f.kit.hallowedWall.gild(5);
    for (let i = 0; i < 12; i++) f.kit.update(0.1, true);
    expect(f.kit.hallowedWall.plates.gilded(5)).toBe(false);
  });

  it('cracks and fizzles the Sacred Goad on an enemy that cannot be taunted', async () => {
    const f = fixture();
    await f.prepare();
    expect(f.kit.sacredGoad.goad(1, 3, true)).toBe(true);
    f.kit.update(0.05, false);
    // The call and the lance fly as ever.
    const call = f.drawn(f.kit.sacredGoad);
    expect(call.get(0)).toBe(1);
    expect(call.get(5)).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < 4; i++) f.kit.update(0.05, false);
    // Struck: the cracked sign and its embers, no brand, circle, burst or thread.
    const struck = f.drawn(f.kit.sacredGoad);
    expect(struck.get(8)).toBe(1);
    expect(struck.get(7)).toBeGreaterThan(0);
    expect(struck.get(3) ?? 0).toBe(0);
    expect(struck.get(4) ?? 0).toBe(0);
    expect(struck.get(6) ?? 0).toBe(0);
    // It sputters out well before a taunt would let go.
    for (let i = 0; i < (GOAD_FLIGHT + GOAD_FIZZLE) / 0.05; i++) f.kit.update(0.05, false);
    expect(f.drawn(f.kit.sacredGoad).size).toBe(0);
  });

  it("shimmers gold about the Paladin while Sacred Goad's Ascension guard holds", async () => {
    const f = fixture();
    await f.prepare();
    const guard = {
      ...aura('sacred_challenge_buff_dr', 'buff_dr', 0.15),
      remaining: 3,
      duration: 4,
    };
    for (let i = 0; i < 3; i++) {
      f.kit.presence(f.entity(1, [guard]));
      f.kit.update(0.05, false);
    }
    const held = f.drawn(f.kit.sacredGoad);
    expect(held.get(9)).toBe(1);
    expect(held.get(7)).toBeGreaterThan(0);
    // Another Paladin's damage reduction (Life Covenant's) does not shimmer.
    const g = fixture();
    await g.prepare();
    g.kit.presence(g.entity(1, [aura('life_covenant', 'buff_dr')]));
    g.kit.update(0.05, false);
    expect(g.drawn(g.kit.sacredGoad).get(9) ?? 0).toBe(0);
    // Gone: it fades.
    for (let i = 0; i < 10; i++) {
      f.kit.presence(f.entity(1));
      f.kit.update(0.05, false);
    }
    expect(f.drawn(f.kit.sacredGoad).size).toBe(0);
  });

  it('routes the Paladin protection cues to their visuals', () => {
    const gild = vi.fn();
    const hallowedWallCast = vi.fn();
    const goad = vi.fn();
    const burst = vi.fn();
    const painter = Object.assign(Object.create(AbilityVfx.prototype), {
      // The painter reads the cast budget for every Paladin cue.
      budget: new AbilityVfxBudget(),
      castChargeAt: new Map(),
      now: () => 0,
      deps: {
        fx: {
          paladinKit: {
            hallowedWall: { gild },
            hallowedWallCast,
            sacredGoad: { goad },
            veilboundMarch: { burst },
          },
          castPaladinShieldSigil: vi.fn(),
        },
        triggerAttack: vi.fn(),
      },
    }) as AbilityVfx;
    (painter as unknown as { releaseGesture: () => void }).releaseGesture = vi.fn();
    const cue = (fx: string, ability: string, immune?: boolean) =>
      painter.handleSpellfx({ sourceId: 1, targetId: 3, school: 'holy', fx, ability, immune });
    expect(cue('selfCast', 'holy_shield')).toBe(true);
    expect(cue('paladinAscensionImpact', 'holy_shield')).toBe(true);
    expect(hallowedWallCast).toHaveBeenCalledExactlyOnceWith(1);
    expect(gild).toHaveBeenCalledExactlyOnceWith(1);
    expect(cue('selfCast', 'sacred_challenge')).toBe(true);
    expect(cue('selfCast', 'sacred_challenge', true)).toBe(true);
    expect(goad.mock.calls).toEqual([
      [1, 3, false],
      [1, 3, true],
    ]);
    // The final wave's burst cue, at its point.
    expect(
      painter.handleSpellfxAt({
        x: 4,
        z: 5,
        school: 'holy',
        fx: 'nova',
        ability: 'veilbound_march',
        sourceId: 1,
      }),
    ).toBe(true);
    expect(burst).toHaveBeenCalledExactlyOnceWith(1, 4, 5);
  });
});

type KitFixture = ReturnType<typeof fixture>;
type Drawn = Map<number, number>;

const TIERS: readonly PaladinVfxDetail[] = ['full', 'light', 'minimal'];
const quads = (m: Drawn) => [...m.values()].reduce((a, b) => a + b, 0);
const n = (m: Drawn, shape: number) => m.get(shape) ?? 0;

/** Plays the same cue on a fresh kit at each detail, returning what it drew. */
async function atTiers<T>(play: (f: KitFixture) => T): Promise<Record<PaladinVfxDetail, T>> {
  const out = {} as Record<PaladinVfxDetail, T>;
  for (const detail of TIERS) {
    setPaladinVfxDetailForTest(detail);
    const f = fixture();
    await f.prepare();
    out[detail] = play(f);
    f.kit.dispose();
  }
  return out;
}

/** Each lower tier draws strictly fewer quads than the one above it. */
function thinsOut(byTier: Record<PaladinVfxDetail, Drawn>, light = true): void {
  if (light) {
    expect(quads(byTier.light)).toBeLessThan(quads(byTier.full));
    expect(quads(byTier.minimal)).toBeLessThan(quads(byTier.light));
  } else expect(quads(byTier.minimal)).toBeLessThan(quads(byTier.full));
}

describe('Paladin kit detail tiers', () => {
  afterEach(() => setPaladinVfxDetailForTest(null));

  it('thins Bastion Rite to its shields: rune circle and dust on light, flares on full only', async () => {
    const d = await atTiers((f) => {
      for (let i = 0; i < 4; i++) {
        f.kit.presence(f.entity(2, [aura('bastion_rite', 'buff_dr_phys')]));
        f.kit.update(0.1, false);
      }
      return f.drawn(f.kit.bastionRite);
    });
    thinsOut(d);
    // The six shields on every tier.
    for (const tier of TIERS) expect(n(d[tier], 0)).toBe(n(d.full, 0));
    expect(n(d.full, 0)).toBe(6);
    expect(n(d.full, 2)).toBeGreaterThan(0);
    expect(n(d.light, 2)).toBe(0);
    expect(n(d.light, 1)).toBe(1);
    expect(n(d.light, 3)).toBeGreaterThan(0);
    expect(n(d.minimal, 1) + n(d.minimal, 2) + n(d.minimal, 3)).toBe(0);
  });

  it("keeps Hallowed Wall's plates on every tier and drops its ground ring on minimal", async () => {
    const wall = [aura('holy_shield', 'buff_block'), aura('holy_shield_absorb', 'absorb', 50)];
    const d = await atTiers((f) => {
      f.kit.presence(f.entity(1, wall));
      f.kit.update(0.1, true);
      return { ring: f.drawn(f.kit.hallowedWall), plates: f.kit.hallowedWall.plates.standing(1) };
    });
    expect(n(d.full.ring, 0)).toBe(1);
    expect(n(d.light.ring, 0)).toBe(1);
    expect(n(d.minimal.ring, 0)).toBe(0);
    for (const tier of TIERS) expect(d[tier].plates).toBe(6);
  });

  it('binds Life Covenant with one strand and the sigil on minimal, no flare below full', async () => {
    const d = await atTiers((f) => {
      f.kit.lifeCovenant.bind(1, 2);
      for (let i = 0; i < 6; i++) f.kit.update(0.05, false);
      return f.drawn(f.kit.lifeCovenant);
    });
    thinsOut(d);
    for (const tier of TIERS) expect(n(d[tier], 1)).toBe(1);
    expect(n(d.full, 2)).toBe(1);
    expect(n(d.light, 2)).toBe(0);
    expect(n(d.light, 0)).toBe(n(d.full, 0));
    expect(n(d.minimal, 0)).toBe(n(d.full, 0) / 2);
  });

  it('takes Sacred Form with the column and sign on every tier, the ring and flare above minimal', async () => {
    const entry = await atTiers((f) => {
      f.kit.sacredForm.enter(2);
      f.kit.update(0.4, false);
      return f.drawn(f.kit.sacredForm);
    });
    thinsOut(entry);
    for (const tier of TIERS) {
      expect(n(entry[tier], 1)).toBe(1);
      expect(n(entry[tier], 0)).toBe(1);
    }
    expect(n(entry.full, 2)).toBe(1);
    expect(n(entry.light, 2)).toBe(0);
    expect(n(entry.light, 4)).toBe(1);
    expect(n(entry.minimal, 4)).toBe(0);
    // Held: the sign and the halo always, fewer motes drifting up.
    const held = await atTiers((f) => {
      for (let i = 0; i < 3; i++) {
        f.kit.presence(f.entity(2, [aura('sacred_form', 'sacred_form')]));
        f.kit.update(0.1, false);
      }
      return f.drawn(f.kit.sacredForm);
    });
    for (const tier of TIERS) {
      expect(n(held[tier], 0)).toBe(1);
      expect(n(held[tier], 5)).toBe(1);
    }
    expect(n(held.minimal, 3)).toBeLessThan(n(held.full, 3));
  });

  it("thins Dawn's Embrace through the cast and its healing, pluses on every tier", async () => {
    const cast = await atTiers((f) => {
      f.kit.dawnsEmbrace.channel(1, 2, 0.5);
      f.kit.update(0.05, false);
      return f.drawn(f.kit.dawnsEmbrace);
    });
    thinsOut(cast, false);
    for (const tier of TIERS) {
      expect(n(cast[tier], 7)).toBe(1);
      expect(n(cast[tier], 1)).toBe(n(cast.full, 1));
    }
    expect(n(cast.full, 0) + n(cast.full, 2)).toBe(2);
    expect(n(cast.minimal, 0) + n(cast.minimal, 2)).toBe(0);
    expect(n(cast.minimal, 5)).toBeLessThan(n(cast.full, 5));
    const healed = await atTiers((f) => {
      f.kit.dawnsEmbrace.embrace(1, 2);
      f.kit.update(0.6, false);
      return f.drawn(f.kit.dawnsEmbrace);
    });
    thinsOut(healed);
    expect(n(healed.full, 3)).toBeGreaterThan(0);
    expect(n(healed.light, 3)).toBe(0);
    expect(n(healed.light, 4)).toBe(1);
    expect(n(healed.minimal, 4)).toBe(0);
    expect(n(healed.minimal, 6)).toBeGreaterThan(0);
    expect(n(healed.minimal, 6)).toBeLessThan(n(healed.light, 6));
  });

  it('thins Radiant Chorus: the sun, burst, reach wave and ribbons stay, the rest sheds', async () => {
    const cast = await atTiers((f) => {
      f.kit.radiantChorus.channel(1, 0.5);
      f.kit.update(0.05, false);
      return f.drawn(f.kit.radiantChorus);
    });
    thinsOut(cast);
    for (const tier of TIERS) expect(n(cast[tier], 7)).toBe(1);
    expect(n(cast.light, 0)).toBe(1);
    expect(n(cast.minimal, 0) + n(cast.minimal, 10)).toBe(0);
    expect(n(cast.minimal, 1)).toBeLessThan(n(cast.full, 1));
    const burst = await atTiers((f) => {
      f.kit.radiantChorus.release(1);
      f.kit.healed(1, 2, 'Radiant Chorus');
      f.kit.update(0.05, false);
      return f.drawn(f.kit.radiantChorus);
    });
    thinsOut(burst);
    for (const tier of TIERS) {
      expect(n(burst[tier], 8)).toBe(1);
      expect(n(burst[tier], 2)).toBe(n(burst.full, 2));
    }
    expect(n(burst.full, 3)).toBe(2);
    expect(n(burst.light, 3)).toBe(0);
    expect(n(burst.light, 6)).toBe(2);
    expect(n(burst.minimal, 6)).toBe(1);
    expect(n(burst.minimal, 9)).toBeLessThan(n(burst.light, 9));
  });

  it('keeps the Sacred Goad lance, burst and brand on every tier, the call and circle above minimal', async () => {
    const d = await atTiers((f) => {
      f.kit.sacredGoad.goad(1, 3);
      f.kit.update(0.05, false);
      const call = f.drawn(f.kit.sacredGoad);
      for (let i = 0; i < 4; i++) f.kit.update(0.05, false);
      return { call, struck: f.drawn(f.kit.sacredGoad) };
    });
    for (const tier of TIERS) {
      expect(n(d[tier].call, 0)).toBe(1);
      expect(n(d[tier].struck, 3)).toBe(1);
      expect(n(d[tier].struck, 1)).toBeGreaterThanOrEqual(1);
    }
    // The brand over the head; above minimal the call's sign still fades too.
    expect(n(d.minimal.struck, 1)).toBe(1);
    expect(n(d.light.struck, 1)).toBe(2);
    expect(n(d.minimal.call, 5) + n(d.minimal.call, 1) + n(d.minimal.call, 7)).toBe(0);
    expect(n(d.full.struck, 2)).toBe(1);
    expect(n(d.light.struck, 2)).toBe(0);
    expect(n(d.light.struck, 6)).toBe(1);
    expect(n(d.minimal.struck, 6) + n(d.minimal.struck, 4)).toBe(0);
    thinsOut({ full: d.full.struck, light: d.light.struck, minimal: d.minimal.struck });
  });

  it('lands the Vowkeeper starburst on every tier, shaft and shock above minimal', async () => {
    const d = await atTiers((f) => {
      f.kit.vowkeeperStrike.strike(1, 3, 'damage');
      f.kit.update(0.05, false);
      return f.drawn(f.kit.vowkeeperStrike);
    });
    thinsOut(d);
    for (const tier of TIERS) expect(n(d[tier], 0)).toBe(1);
    expect(n(d.full, 2)).toBe(1);
    expect(n(d.light, 2)).toBe(0);
    expect(n(d.light, 6) + n(d.light, 5)).toBe(2);
    expect(n(d.minimal, 6) + n(d.minimal, 5)).toBe(0);
    expect(n(d.minimal, 4)).toBeGreaterThan(0);
  });

  it('flies the bare Sunward Disc on minimal and bursts it without the flare below full', async () => {
    const d = await atTiers((f) => {
      f.kit.sunwardDisc.hurl(1, 3);
      f.kit.update(0.05, false);
      const flight = f.drawn(f.kit.sunwardDisc);
      f.kit.sunwardDisc.strike(1, 3, 0, 2);
      f.kit.update(0.05, false);
      return { flight, impact: f.drawn(f.kit.sunwardDisc) };
    });
    for (const tier of TIERS) {
      expect(n(d[tier].flight, 0)).toBe(1);
      expect(n(d[tier].impact, 3)).toBe(1);
    }
    expect(n(d.light.flight, 1)).toBe(1);
    expect(n(d.minimal.flight, 1) + n(d.minimal.flight, 5)).toBe(0);
    expect(n(d.full.impact, 2)).toBe(1);
    expect(n(d.light.impact, 2)).toBe(0);
    thinsOut({ full: d.full.flight, light: d.light.flight, minimal: d.minimal.flight });
    thinsOut({ full: d.full.impact, light: d.light.impact, minimal: d.minimal.impact });
  });

  it('drives one Bastion Sweep outline on minimal and drops the flares below full', async () => {
    const d = await atTiers((f) => {
      f.kit.bastionSweep.sweep(1, 8, 180, 0);
      f.kit.update(0.1, false);
      const windup = f.drawn(f.kit.bastionSweep);
      for (let i = 0; i < 3; i++) f.kit.update(0.1, false);
      f.kit.bastionSweep.strike(3);
      f.kit.update(0.02, false);
      return { windup, blow: f.drawn(f.kit.bastionSweep) };
    });
    expect(n(d.minimal.windup, 6)).toBeLessThan(n(d.full.windup, 6));
    expect(n(d.minimal.windup, 6)).toBeGreaterThan(0);
    for (const tier of TIERS) {
      expect(n(d[tier].blow, 1)).toBe(1);
      expect(n(d[tier].blow, 3)).toBe(1);
      expect(n(d[tier].blow, 5)).toBeGreaterThan(0);
    }
    expect(n(d.full.blow, 5)).toBe(n(d.light.blow, 5));
    expect(n(d.minimal.blow, 5)).toBe(1);
    expect(n(d.full.blow, 2)).toBe(2);
    expect(n(d.light.blow, 2)).toBe(0);
    thinsOut({ full: d.full.blow, light: d.light.blow, minimal: d.minimal.blow });
  });

  it('holds every Oath Chain link and the shackle on every tier, the furrow above minimal', async () => {
    const pulled = { ...aura('oath_chain_pull', 'forced_move'), sourceId: 1 };
    const slowed = { ...aura('oath_chain_slow', 'slow'), sourceId: 1 };
    const d = await atTiers((f) => {
      f.kit.oathChain.lash(1, 3);
      for (let i = 0; i < 6; i++) {
        f.kit.presence(f.entity(3, [pulled]));
        f.kit.update(0.05, false);
      }
      const held = f.drawn(f.kit.oathChain);
      let motes = 0;
      for (let i = 0; i < 10; i++) {
        f.kit.presence(f.entity(3, [slowed]));
        f.kit.update(0.05, false);
        motes += n(f.drawn(f.kit.oathChain), 5);
      }
      return { held, motes };
    });
    for (const tier of TIERS) {
      expect(n(d[tier].held, 0) + n(d[tier].held, 1)).toBe(n(d.full.held, 0) + n(d.full.held, 1));
      expect(n(d[tier].held, 3)).toBe(1);
    }
    expect(n(d.full.held, 2)).toBe(1);
    expect(n(d.light.held, 2)).toBe(0);
    expect(n(d.light.held, 6)).toBe(1);
    expect(n(d.minimal.held, 6)).toBe(0);
    thinsOut({ full: d.full.held, light: d.light.held, minimal: d.minimal.held });
    // The chain still shatters into motes on every tier, fewer of them.
    expect(d.minimal.motes).toBeGreaterThan(0);
    expect(d.minimal.motes).toBeLessThan(d.light.motes);
    expect(d.light.motes).toBeLessThan(d.full.motes);
  });

  it('keeps the Veilbound shroud, eye, snap and reach ring on every tier, the streamers above minimal', async () => {
    const marched = aura('veilbound_march', 'buff_speed');
    const marked = aura('veilbound_mark', 'dot');
    const d = await atTiers((f) => {
      for (let i = 0; i < 6; i++) {
        f.kit.presence(f.entity(1, [marched]));
        f.kit.presence(f.entity(2, [marked]));
        f.kit.update(0.05, false);
      }
      const marching = f.drawn(f.kit.veilboundMarch);
      f.kit.veilboundMarch.strike(1, 2);
      f.kit.veilboundMarch.burst(1, 0, 0);
      f.kit.presence(f.entity(2, [marked]));
      f.kit.update(0.016, false);
      return { marching, struck: f.drawn(f.kit.veilboundMarch) };
    });
    for (const tier of TIERS) {
      expect(n(d[tier].marching, 8)).toBe(1);
      expect(n(d[tier].marching, 1)).toBe(1);
      expect(n(d[tier].struck, 7)).toBe(1);
      expect(n(d[tier].struck, 3)).toBe(1);
    }
    expect(n(d.light.marching, 0)).toBe(n(d.full.marching, 0));
    expect(n(d.minimal.marching, 0)).toBe(0);
    expect(n(d.full.struck, 2)).toBeGreaterThan(0);
    expect(n(d.light.struck, 2)).toBe(0);
    expect(n(d.light.struck, 9)).toBeGreaterThan(0);
    expect(n(d.minimal.struck, 9)).toBe(0);
    thinsOut({ full: d.full.marching, light: d.light.marching, minimal: d.minimal.marching });
    thinsOut({ full: d.full.struck, light: d.light.struck, minimal: d.minimal.struck });
  });

  it('keeps a held effect at the detail its presence started with', async () => {
    // Taken at minimal, Sacred Form keeps its thinned motes when the detail
    // rises mid-hold; a form taken afresh draws the full set.
    setPaladinVfxDetailForTest('minimal');
    const f = fixture();
    await f.prepare();
    const hold = (frames: number) => {
      for (let i = 0; i < frames; i++) {
        f.kit.presence(f.entity(2, [aura('sacred_form', 'sacred_form')]));
        f.kit.update(0.1, false);
      }
      return n(f.drawn(f.kit.sacredForm), 3);
    };
    const thin = hold(3);
    // A third of the form's six motes.
    expect(thin).toBe(2);
    setPaladinVfxDetailForTest('full');
    expect(hold(1)).toBe(2);
    for (let i = 0; i < 10; i++) {
      f.kit.presence(f.entity(2));
      f.kit.update(0.1, false);
    }
    expect(f.drawn(f.kit.sacredForm).size).toBe(0);
    expect(hold(3)).toBeGreaterThan(thin);
  });
});

describe('Paladin kit detail tiers: heals and lances', () => {
  afterEach(() => setPaladinVfxDetailForTest(null));

  it('brings the Beacon of Light down as one column on every tier, its ground light and wave above minimal', async () => {
    // Shapes: 0 halo, 1 beacon, 2 wave, 3 flare, 4 ground, 5 thread, 6 mote.
    const landing = await atTiers((f) => {
      f.kit.beaconOfLight.kindle(2);
      for (let i = 0; i < 6; i++) f.kit.update(0.05, false);
      return f.drawn(f.kit.beaconOfLight);
    });
    thinsOut(landing);
    for (const tier of TIERS) expect(n(landing[tier], 1)).toBe(1);
    expect(n(landing.full, 3)).toBe(1);
    expect(n(landing.light, 3)).toBe(0);
    for (const shape of [2, 4]) {
      expect(n(landing.full, shape)).toBe(1);
      expect(n(landing.light, shape)).toBe(1);
      expect(n(landing.minimal, shape)).toBe(0);
    }
    expect(n(landing.full, 6)).toBe(10);
    expect(n(landing.light, 6)).toBe(5);
    expect(n(landing.minimal, 6)).toBe(3);
    // A copied heal: the halo and the thread on every tier, the flares on full only.
    const copy = await atTiers((f) => {
      f.kit.presence(f.entity(3, [aura('beacon_of_light', 'beacon_of_light')]));
      f.kit.healed(1, 2, 'Mending Light');
      f.kit.healed(1, 3, 'Beacon of Light');
      f.kit.update(0.1, false);
      return f.drawn(f.kit.beaconOfLight);
    });
    thinsOut(copy, false);
    for (const tier of TIERS) {
      expect(n(copy[tier], 0)).toBe(1);
      expect(n(copy[tier], 5)).toBe(n(copy.full, 5));
    }
    expect(n(copy.full, 5)).toBeGreaterThan(0);
    expect(n(copy.full, 3)).toBeGreaterThanOrEqual(1);
    expect(n(copy.light, 3)).toBe(0);
  });

  it('forms and hurls the same Mercy Lance on every tier, its streaks, crit ring and shards above minimal', async () => {
    // Shapes: 0 lance, 1 streak, 2 flare, 3 ring, 4 shard, 5 mote.
    const forming = await atTiers((f) => {
      f.kit.presence(
        f.entity(1, [], {
          castingAbility: 'mercy_lance',
          castTotal: 1.75,
          castRemaining: 0.8,
          castTargetId: 3,
        }),
      );
      f.kit.update(0.05, false);
      return f.drawn(f.kit.mercyLance);
    });
    for (const tier of TIERS) expect(n(forming[tier], 0)).toBe(1);
    expect(n(forming.full, 2)).toBe(1);
    expect(n(forming.light, 2)).toBe(0);
    expect(n(forming.light, 5)).toBeLessThan(n(forming.full, 5));
    expect(n(forming.minimal, 5)).toBeLessThan(n(forming.light, 5));
    // A critical strike, driven through.
    const strike = await atTiers((f) => {
      expect(f.kit.mercyLance.strike(1, 3, 'damage', true)).toBe(true);
      for (let i = 0; i < 4; i++) f.kit.update(0.05, false);
      return f.drawn(f.kit.mercyLance);
    });
    thinsOut(strike);
    for (const tier of TIERS) {
      expect(n(strike[tier], 0)).toBe(1);
      expect(n(strike[tier], 3)).toBeGreaterThanOrEqual(1);
    }
    expect(n(strike.full, 2)).toBe(1);
    expect(n(strike.light, 2)).toBe(0);
    expect(n(strike.full, 3)).toBe(2);
    expect(n(strike.light, 3)).toBe(2);
    expect(n(strike.minimal, 3)).toBe(1);
    expect(n(strike.light, 1)).toBe(n(strike.full, 1));
    expect(n(strike.minimal, 1)).toBe(0);
    expect(n(strike.full, 4)).toBe(10);
    expect(n(strike.light, 4)).toBe(5);
    expect(n(strike.minimal, 4)).toBe(0);
  });

  it('pours the same Solar Invocation shaft on every tier and bursts it into fewer pluses below full', async () => {
    // Shapes: 1 sun, 2 beam, 3 haze, 4 ground, 5 flare, 6 spark, 7 ring,
    // 8 splash, 9 plus, 10 burst, 11 shock, 12 scorch.
    const strike = await atTiers((f) => {
      expect(f.kit.solarInvocation.invoke(1, 3, false)).toBe(true);
      f.kit.update(0.25, false);
      return f.drawn(f.kit.solarInvocation);
    });
    thinsOut(strike);
    for (const tier of TIERS) {
      expect(n(strike[tier], 1)).toBe(1);
      expect(n(strike[tier], 2)).toBe(1);
    }
    for (const shape of [3, 4, 8, 11]) {
      expect(n(strike.full, shape)).toBe(1);
      expect(n(strike.light, shape)).toBe(1);
      expect(n(strike.minimal, shape)).toBe(0);
    }
    expect(n(strike.full, 7)).toBe(n(strike.light, 7));
    expect(n(strike.minimal, 7)).toBe(0);
    for (const shape of [5, 12]) {
      expect(n(strike.full, shape)).toBe(1);
      expect(n(strike.light, shape)).toBe(0);
    }
    expect(n(strike.light, 6)).toBeLessThan(n(strike.full, 6));
    expect(n(strike.minimal, 6)).toBeLessThan(n(strike.light, 6));
    const heal = await atTiers((f) => {
      expect(f.kit.solarInvocation.invoke(1, 2, true)).toBe(true);
      f.kit.update(INVOKE_BURST + 0.1, false);
      return f.drawn(f.kit.solarInvocation);
    });
    thinsOut(heal);
    expect(n(heal.full, 9)).toBe(14);
    expect(n(heal.light, 9)).toBe(7);
    expect(n(heal.minimal, 9)).toBe(4);
    expect(n(heal.full, 5)).toBe(1);
    expect(n(heal.light, 5)).toBe(0);
    expect(n(heal.light, 10)).toBe(1);
    expect(n(heal.minimal, 10)).toBe(0);
  });
});
