// The Hammer Council's effects: the pure plan (src/render/smith_heart_fx/
// council_fx_core.ts: a pillar's integrity on the model, its rise and its fall,
// the marks read off the sim's own numbers, the rock's fall, the claimed cues)
// and CouncilFx over a fake world (no DOM): it dresses the pillars, draws every
// mark round its player, claims the council's own cues and disposes; the
// two-boss rework's looks (Resonance's spread ring, Mountain's Rush's mark and
// lane, the cursed pillar, Bond of the Stone's thread).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import { CouncilFx } from '../src/render/smith_heart_fx/council_fx';
import {
  COUNCIL_FX_COLORS,
  COUNCIL_FX_POOLS,
  COUNCIL_MARK_SPECS,
  CURSED_COLORS,
  councilClaims,
  cursedPillarLook,
  energyLook,
  inheritArc,
  isCursedPillar,
  markFill,
  markRadius,
  PILLAR_RISE_SECONDS,
  pillarFall,
  pillarLook,
  pillarPipSlots,
  pillarPips,
  pillarRise,
  pulseRadius,
  RISE_SPOT_SPEC,
  ROCK_FALL_SECONDS,
  rockFall,
  rushLane,
  SOUL_COLORS,
} from '../src/render/smith_heart_fx/council_fx_core';
import { RUSH_ARROW } from '../src/render/smith_heart_fx/council_mechanic_look_core';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_CURSED,
  councilPillarOf,
  councilPillarTemplate,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart/council_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('council_fx_core: integrity on the model', () => {
  it('cracks open, leans and dims a pip per piece lost', () => {
    // A carved column takes two blows: whole, then cracked open and leaning.
    const [a, c] = [2, 1].map((n) => pillarLook(n));
    expect(a.crack).toBe(0);
    expect(a.lean).toBe(0);
    expect(c.crack).toBeGreaterThan(a.crack);
    expect(c.lean).toBeGreaterThan(a.lean);
    expect(c.heat).toBeGreaterThan(a.heat);
    // A fresh risen pillar is one use, and whole while it stands.
    expect(pillarLook(1, true)).toBe(a);
    // Pips read against the pillar's own start: a carved column has two, a
    // risen pillar one.
    expect([2, 1, 0].map((n) => pillarPips(n))).toEqual([2, 1, 0]);
    expect([1, 0].map((n) => pillarPips(n, true))).toEqual([1, 0]);
    expect([pillarPipSlots(false), pillarPipSlots(true)]).toEqual([2, 1]);
  });

  it('a pillar bursts up out of the floor, and falls in tipping and sinking', () => {
    expect(pillarRise(0).sunk).toBe(1);
    expect(pillarRise(PILLAR_RISE_SECONDS * 0.5).sunk).toBeLessThan(0.5);
    expect(Math.abs(pillarRise(PILLAR_RISE_SECONDS + 1).sunk)).toBeLessThan(1e-6);
    const early = pillarFall(0.2);
    const late = pillarFall(1.6);
    expect(late.tip).toBeGreaterThan(early.tip);
    expect(late.sunk).toBeGreaterThan(early.sunk);
    expect(pillarFall(5).alpha).toBe(0);
  });

  it("every mark reads the sim's own numbers, in a threat colour", () => {
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.wakeMark].radius).toBe(T.riseKnockRadius);
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.wakeMark].color).toBe(TELEGRAPH_THREAT_COLORS.control);
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.rockMark].radius).toBe(T.rockRadius);
    expect(COUNCIL_MARK_SPECS[COUNCIL_AURAS.rockMark].gather).toBe(true);
    expect(RISE_SPOT_SPEC.seconds).toBe(T.heirRiseWarn);
    expect(RISE_SPOT_SPEC.color).toBe(TELEGRAPH_THREAT_COLORS.danger);
    expect(COUNCIL_FX_COLORS.weight).toBe(TELEGRAPH_THREAT_COLORS.lethal);
    expect(pulseRadius(T.columnR)).toBe(T.columnR + T.pulseReach);
    expect(markFill(5, 5)).toBe(0);
    expect(markFill(0, 5)).toBe(1);
  });

  it('the rock drops only over its last moments, landing on the floor', () => {
    // The rock hangs over the soak for the whole mark, sinking, then drops.
    expect(rockFall(T.rockMarkSeconds).visible).toBe(true);
    expect(rockFall(T.rockMarkSeconds + 0.5).visible).toBe(false);
    expect(rockFall(T.rockMarkSeconds).height).toBeGreaterThan(
      rockFall(ROCK_FALL_SECONDS + 0.5).height,
    );
    expect(rockFall(ROCK_FALL_SECONDS + 0.01).height).toBeGreaterThan(
      rockFall(ROCK_FALL_SECONDS / 2).height,
    );
    const mid = rockFall(ROCK_FALL_SECONDS / 2);
    expect(mid.visible).toBe(true);
    expect(rockFall(0.01).height).toBeLessThan(mid.height);
    expect(rockFall(0).height).toBeCloseTo(0);
    expect(energyLook(100).crackle).toBe(true);
    expect(energyLook(40).crackle).toBe(false);
  });

  it('sizes its pools from the tuning (no pillar or rubble left undrawn)', () => {
    // Every standing pillar plus as many falling at once (a Wrath can break all).
    expect(COUNCIL_FX_POOLS.pillars).toBeGreaterThanOrEqual(T.pillarCap * 2);
    // Rubble lies rubbleSeconds: room for every pillar breaking inside it.
    expect(COUNCIL_FX_POOLS.rubble).toBeGreaterThanOrEqual(T.pillarCap);
  });

  it('fills the per-frame scratch it is handed (the frame allocates nothing)', () => {
    const out = { along: 0, lift: 0 };
    expect(inheritArc(0.5, out)).toBe(out);
    expect(out).toEqual(inheritArc(0.5));
    const rise = { sunk: 0, shudder: 0 };
    expect(pillarRise(0.3, rise)).toBe(rise);
    expect(rise).toEqual(pillarRise(0.3));
    expect(pillarLook(2)).toBe(pillarLook(2));
  });

  it("Resonance's spread and the Rush's mark read the sim's radius, in a threat colour", () => {
    const res = COUNCIL_MARK_SPECS[COUNCIL_AURAS.resonance];
    expect(res.radius).toBe(T.resonanceRadius);
    expect(res.color).toBe(TELEGRAPH_THREAT_COLORS.danger);
    expect(res.gather).toBe(false);
    const rush = COUNCIL_MARK_SPECS[COUNCIL_AURAS.rushMark];
    expect(rush.radius).toBe(T.rushHalfWidth);
    expect(rush.color).toBe(TELEGRAPH_THREAT_COLORS.lethal);
    // The aura's value2 (the sim's own) wins; none rides: the spec's.
    expect(markRadius(res, 9)).toBe(9);
    expect(markRadius(res, 0)).toBe(T.resonanceRadius);
    expect(markRadius(res, undefined)).toBe(T.resonanceRadius);
  });

  it("the Rush's lane runs from the Guardian to its mark at the hit's whole width", () => {
    const out = { yaw: 0, length: 0, half: 0 };
    const lane = rushLane(0, 0, 0, 12, 0, out);
    expect(lane).toBe(out);
    expect(out.yaw).toBeCloseTo(0);
    expect(out.length).toBeCloseTo(12);
    // Drawn to the hit's whole reach: the half width and a body's girth.
    expect(out.half).toBe(T.rushHalfWidth + T.rushBody);
    expect(out.half * 2).toBeGreaterThanOrEqual(5);
    rushLane(0, 0, 5, 0, 3, out);
    expect(out.yaw).toBeCloseTo(Math.PI / 2);
    expect(out.half).toBe(3 + T.rushBody);
    expect(rushLane(1, 1, 1.1, 1, 2, out)).toBeNull();
  });

  it('the cursed pillar is its own template with its own light', () => {
    expect(isCursedPillar(COUNCIL_CURSED)).toBe(true);
    expect(isCursedPillar(councilPillarTemplate(1, true))).toBe(false);
    expect(councilPillarOf(COUNCIL_CURSED)).toBeNull();
    for (const h of [
      ...Object.values(SOUL_COLORS).map((c) => c.hex),
      TELEGRAPH_THREAT_COLORS.control,
      TELEGRAPH_THREAT_COLORS.lethal,
      TELEGRAPH_THREAT_COLORS.danger,
    ])
      expect(CURSED_COLORS.hex).not.toBe(h);
    const calm = { ...cursedPillarLook(0, 99) };
    const pulsed = { ...cursedPillarLook(0, 0.05) };
    expect(calm.crack).toBeGreaterThan(0.5);
    expect(pulsed.glow).toBeGreaterThan(calm.glow);
    expect(pulsed.heat).toBeGreaterThan(calm.heat);
  });

  it("claims exactly the council's own cues", () => {
    for (const id of Object.values(COUNCIL_CUES)) expect(councilClaims(id), id).toBe(true);
    expect(councilClaims(COUNCIL_CASTS.bolt)).toBe(true);
    expect(councilClaims(COUNCIL_CASTS.wrath)).toBe(false);
    expect(councilClaims(undefined)).toBe(false);
  });
});

describe('CouncilFx over a fake world', () => {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  function entity(id: number, kind: Entity['kind'], templateId: string, x: number, z: number) {
    return {
      id,
      kind,
      templateId,
      name: templateId,
      pos: { x: o.x + x, y: 0, z: o.z + z },
      prevPos: { x: o.x + x, y: 0, z: o.z + z },
      facing: 0,
      scale: 1,
      hp: 100,
      maxHp: 100,
      dead: false,
      auras: [] as Entity['auras'],
      castingAbility: null as string | null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
      resourceType: null,
      resource: 0,
      maxResource: 0,
    } as unknown as Entity;
  }
  const aura = (id: string, remaining: number, duration: number, value = 0, value2 = 0) =>
    ({
      id,
      name: id,
      kind: 'vulnerability',
      remaining,
      duration,
      value,
      value2,
      sourceId: 0,
      school: 'physical',
    }) as Entity['auras'][number];

  it('draws the pillars, the marks and the rings, claims its cues, disposes', () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', 8, -160);
    const marked = entity(2, 'player', 'mage', 0, -170);
    const column = entity(10, 'object', councilPillarTemplate(2, false), 16, -147);
    const risen = entity(11, 'object', councilPillarTemplate(3, true), -6, -170);
    // The Guardian winding up Mountain's Wrath (its energy full: the holder).
    const guardian = entity(20, 'mob', 'heart_hammer_guardian', 30, -175);
    Object.assign(guardian, {
      resourceType: 'energy',
      resource: 100,
      maxResource: 100,
      castingAbility: COUNCIL_CASTS.wrath,
      castTotal: T.wrathCast,
      castRemaining: 2,
    });
    for (const e of [me, marked, column, risen, guardian]) entities.set(e.id, e);
    marked.auras.push(aura(COUNCIL_AURAS.rockMark, 3, 5));
    me.auras.push(aura(COUNCIL_AURAS.resonance, 4, 6, 0, T.resonanceRadius));
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new CouncilFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    const rise = {
      type: 'spellfx',
      sourceId: risen.id,
      targetId: risen.id,
      school: 'physical',
      fx: 'nova',
      ability: COUNCIL_CUES.rise,
    } as SimEvent;
    expect(fx.handleEvent(rise)).toBe(true);
    for (let i = 0; i < 12; i++) fx.update(1 / 30);
    const root = scene.getObjectByName('smith-heart-council-fx');
    expect(root).toBeDefined();
    const shown = (name: string) => {
      let n = 0;
      root?.traverse((c) => {
        if (c.name !== name) return;
        // Drawn only when it and every parent are visible.
        for (let o: THREE.Object3D | null = c; o; o = o.parent) if (!o.visible) return;
        n++;
      });
      return n;
    };
    expect(shown('smithHeartCouncilPillar')).toBe(2);
    expect(shown('smithHeartPillarPips')).toBe(2);
    // Resonance: the shimmer on its carrier (its ring is a kit mark).
    expect(shown('smithHeartResonanceBand')).toBe(1);
    // The soak reads from afar: its countdown rim, its beacon, and the rock's
    // shadow drawn by the stone paint under the marked player (its char pass,
    // so the fissures burn through it), heating as the rock comes.
    expect(shown('smithHeartSoakRim')).toBe(1);
    expect(shown('smithHeartSoakBeacon')).toBe(1);
    let soakPaint: THREE.ShaderMaterial | undefined;
    root?.traverse((c) => {
      const m = (c as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (c.name === 'smithHeartCouncilTelegraph' && c.visible && m?.uniforms?.uShadow?.value > 0)
        soakPaint = m;
    });
    expect(soakPaint).toBeDefined();
    expect(soakPaint?.uniforms.uShadow.value).toBeLessThan(1);
    expect(soakPaint?.uniforms.uHeat.value).toBeGreaterThan(0);
    // The Wrath's real shadow behind both pillars, with its light curtains.
    expect(shown('smithHeartShelter:wrath')).toBe(2);
    expect(shown('smithHeartShelterCurtain:wrath')).toBe(2);
    guardian.castingAbility = null;
    fx.update(1 / 30);
    expect(shown('smithHeartShelter:wrath')).toBe(0);
    expect(shaken).toBeGreaterThan(0);
    // The rock's impact and a fall are claimed and drawn.
    const impact = {
      type: 'spellfxAt',
      x: marked.pos.x,
      z: marked.pos.z,
      school: 'physical',
      fx: 'burst',
      ability: COUNCIL_CUES.rockImpact,
      radius: T.rockRadius,
    } as SimEvent;
    expect(fx.handleEvent(impact)).toBe(true);
    entities.delete(column.id);
    const fall = {
      type: 'spellfxAt',
      x: column.pos.x,
      z: column.pos.z,
      school: 'physical',
      fx: 'burst',
      ability: COUNCIL_CUES.collapse,
      radius: 4,
    } as SimEvent;
    expect(fx.handleEvent(fall)).toBe(true);
    for (let i = 0; i < 6; i++) fx.update(1 / 30);
    expect(shown('smithHeartCouncilPillar')).toBe(2);
    for (let i = 0; i < 120; i++) fx.update(1 / 30);
    expect(shown('smithHeartCouncilPillar')).toBe(1);
    // The Wrath is not the council's to claim (the engine's sight field).
    const wrath = { ...rise, ability: COUNCIL_CASTS.wrath } as SimEvent;
    expect(fx.handleEvent(wrath)).toBe(false);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-council-fx')).toBeUndefined();
  });

  it("draws the Rush's lane and mark, the cursed pillar, the bond's thread; claims their cues", () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', 8, -160);
    const marked = entity(2, 'player', 'mage', 0, -150);
    const guardian = entity(20, 'mob', 'heart_hammer_guardian', 0, -175);
    const singer = entity(21, 'mob', 'heart_seam_singer', 10, -175);
    const cursed = entity(30, 'object', COUNCIL_CURSED, -12, -168);
    for (const e of [me, marked, guardian, singer, cursed]) entities.set(e.id, e);
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    const gestures: [number, string][] = [];
    const fx = new CouncilFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      () => {},
      (id, g) => gestures.push([id, g]),
    );
    for (let i = 0; i < 6; i++) fx.update(1 / 30);
    const root = scene.getObjectByName('smith-heart-council-fx');
    const shown = (name: string) => {
      let n = 0;
      root?.traverse((c) => {
        if (c.name !== name) return;
        for (let o: THREE.Object3D | null = c; o; o = o.parent) if (!o.visible) return;
        n++;
      });
      return n;
    };
    // The cursed pillar: a pillar with its own sheath of light and no pips.
    expect(shown('smithHeartCouncilPillar')).toBe(1);
    expect(shown('smithHeartPillarPips')).toBe(0);
    expect(shown('smithHeartSoulGlow')).toBe(1);
    // No bond, no Rush yet.
    expect(shown('smithHeartCouncilBondThread')).toBe(0);
    const paints = () => shown('smithHeartCouncilTelegraph');
    const before = paints();
    // The Guardian marks a player and charges: the mark round them and the lane.
    Object.assign(guardian, {
      castingAbility: COUNCIL_CASTS.rush,
      castTargetId: marked.id,
      castTotal: T.rushCast,
      castRemaining: 2,
    });
    marked.auras.push(aura(COUNCIL_AURAS.rushMark, 2, T.rushCast, 0, T.rushHalfWidth));
    guardian.auras.push(aura(COUNCIL_AURAS.bond, 10, 10));
    for (let i = 0; i < 6; i++) fx.update(1 / 30);
    expect(paints()).toBeGreaterThanOrEqual(before + 2);
    // The red arrow over the marked player, for the whole raid (every tier).
    expect(shown('smithHeartRushArrow')).toBe(1);
    let arrow: THREE.Object3D | null = null;
    root?.traverse((c) => {
      if (c.name === 'smithHeartRushArrow' && c.visible) arrow = c;
    });
    const arrowAt = (arrow as THREE.Object3D | null)?.position;
    expect(arrowAt?.x).toBeCloseTo(marked.pos.x, 5);
    expect(arrowAt?.z).toBeCloseTo(marked.pos.z, 5);
    // Its tip floats clear of the head.
    expect((arrowAt?.y ?? 0) - marked.pos.y).toBeGreaterThanOrEqual(RUSH_ARROW.tip);
    // The bond: the tether (core, halo, shards) and its aura on both members
    // (a sigil on the floor, a column of light), every tier.
    expect(shown('smithHeartCouncilBondThread')).toBe(1);
    expect(shown('smithHeartCouncilBondCore')).toBe(1);
    expect(shown('smithHeartCouncilBondHalo')).toBe(1);
    expect(shown('smithHeartCouncilBondShards')).toBe(1);
    expect(shown('smithHeartCouncilBondSigil')).toBe(2);
    expect(shown('smithHeartCouncilBondColumn')).toBe(2);
    expect(shown('smithHeartCouncilBondChain')).toBe(1);
    const nova = (ability: string, sourceId: number, targetId = sourceId): SimEvent =>
      ({
        type: 'spellfx',
        sourceId,
        targetId,
        school: 'physical',
        fx: 'nova',
        ability,
      }) as SimEvent;
    const at = (ability: string, x: number, z: number, radius: number): SimEvent =>
      ({ type: 'spellfxAt', x, z, school: 'physical', fx: 'burst', ability, radius }) as SimEvent;
    expect(fx.handleEvent(nova(COUNCIL_CUES.bondPulse, guardian.id, singer.id))).toBe(true);
    expect(fx.handleEvent(nova(COUNCIL_CUES.cursedPulse, cursed.id))).toBe(true);
    expect(fx.handleEvent(nova(COUNCIL_CUES.resonancePulse, me.id))).toBe(true);
    expect(fx.handleEvent(at(COUNCIL_CUES.quarryCollapse, me.pos.x, me.pos.z, 2))).toBe(true);
    // The bar lands: the lane goes; the dash stops on the cursed pillar.
    guardian.castingAbility = null;
    guardian.castTargetId = null;
    marked.auras.length = 0;
    for (let i = 0; i < 6; i++) fx.update(1 / 30);
    expect(paints()).toBe(before);
    // The mark gone, its arrow with it.
    expect(shown('smithHeartRushArrow')).toBe(0);
    // The wind-up: the line fixed from the Guardian's feet to the cursed
    // pillar's face; the lane stays lit at full through it and the run.
    const run = Math.hypot(cursed.pos.x - guardian.pos.x, cursed.pos.z - guardian.pos.z) - 4;
    const windup = {
      ...at(COUNCIL_CUES.rushWindup, guardian.pos.x, guardian.pos.z, T.rushHalfWidth),
      sourceId: guardian.id,
      dirX: (cursed.pos.x - guardian.pos.x) / (run + 4),
      dirZ: (cursed.pos.z - guardian.pos.z) / (run + 4),
      speed: T.rushSpeed,
      duration: run / T.rushSpeed,
    } as SimEvent;
    expect(fx.handleEvent(windup)).toBe(true);
    expect(gestures).toEqual([[guardian.id, 'heart_mountains_rush_windup']]);
    fx.update(1 / 30);
    expect(paints()).toBe(before + 1);
    expect(shown('smithHeartRushStar')).toBe(1);
    expect(shown('smithHeartRushScar')).toBe(0);
    // Into the run: the scar tears open behind the body.
    for (let i = 0; i < Math.ceil((T.rushWindup + 0.2) * 30); i++) fx.update(1 / 30);
    expect(paints()).toBe(before + 1);
    expect(shown('smithHeartRushScar')).toBe(1);
    const stop = at(COUNCIL_CUES.rushImpact, cursed.pos.x, cursed.pos.z, T.rushHalfWidth);
    expect(fx.handleEvent(stop)).toBe(true);
    fx.update(1 / 30);
    // The stop: the locked lane goes, the scar and both stars stay a while.
    expect(paints()).toBe(before);
    expect(shown('smithHeartRushScar')).toBe(1);
    expect(shown('smithHeartRushStar')).toBe(2);
    entities.delete(cursed.id);
    const brk = at(COUNCIL_CUES.cursedBreak, cursed.pos.x, cursed.pos.z, T.cursedR);
    expect(fx.handleEvent(brk)).toBe(true);
    for (let i = 0; i < 120; i++) fx.update(1 / 30);
    expect(shown('smithHeartCouncilPillar')).toBe(0);
    // The Rush's trace fades away.
    for (let i = 0; i < 90; i++) fx.update(1 / 30);
    expect(shown('smithHeartRushScar')).toBe(0);
    expect(shown('smithHeartRushStar')).toBe(0);
    // The bond breaks when they are pulled apart (neither wears it): every
    // piece goes the same frame.
    guardian.auras.length = 0;
    fx.update(1 / 30);
    expect(shown('smithHeartCouncilBondThread')).toBe(0);
    expect(shown('smithHeartCouncilBondSigil')).toBe(0);
    expect(shown('smithHeartCouncilBondColumn')).toBe(0);
    expect(shown('smithHeartCouncilBondChain')).toBe(0);
    // A Rush whose Guardian falls mid-run: the locked lane goes that frame,
    // never lit over ground that no longer kills.
    expect(fx.handleEvent(windup)).toBe(true);
    fx.update(1 / 30);
    expect(paints()).toBe(before + 1);
    guardian.dead = true;
    fx.update(1 / 30);
    expect(paints()).toBe(before);
    fx.dispose();
  });
});

describe("Mountain's Rush's arrow: compiled with the council's gated root", () => {
  it('both arrow cards are under the root the compile gate receives, hidden until a mark', () => {
    const seen: number[] = [];
    const world = { entities: new Map(), playerId: -1 } as unknown as IWorld;
    new CouncilFx(
      new THREE.Scene(),
      () => 0,
      world,
      (target) => {
        let n = 0;
        target.traverse((c) => {
          if (c.name === 'smithHeartRushArrow') {
            n++;
            expect(c.visible).toBe(false);
          }
        });
        seen.push(n);
        return Promise.resolve();
      },
    );
    expect(seen).toEqual([2]);
  });
});
