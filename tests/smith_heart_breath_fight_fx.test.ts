// The Guardian of the Breath's fight effects (src/render/smith_heart_fx/
// breath_fight_fx_core.ts and breath_fight_fx.ts) and its sound plan
// (src/game/smith_heart_breath_audio_core.ts): the wind's field reads the
// direction in every pushing phase (and points inward while the guardian
// draws breath), the gaps' lips are the field's own open runs and flare when
// the wind blows their way, the circle's seats and states, the timed spots'
// fills, the bolts' paths; the painter over a fake world lays every
// footprint at its object's exact radius, marks the anchored, the pinned and
// the conductor, claims its own cues (and only those), and disposes; the
// sound plan plays a gather before each blow and a sigh into the calm.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SFX } from '../scripts/sfx/sfx_prompts.mjs';
import {
  BREATH_BAR_SOUNDS,
  BREATH_CUE_SOUNDS,
  BREATH_SFX_KEYS,
  breathBarRate,
  breathSoundClaims,
  windPhaseSound,
} from '../src/game/smith_heart_breath_audio_core';
import { breathGapEnds } from '../src/render/smith_heart/breath_kit_plan_core';
import { BreathFightFx } from '../src/render/smith_heart_fx/breath_fight_fx';
import {
  BREATH_FIGHT_POOLS,
  bearingDir,
  boltFlare,
  breathClaimOrigin,
  breathFightClaims,
  breathObjectKind,
  calmLook,
  calmSeatsLeft,
  chargedFade,
  corniceOutline,
  cradleLook,
  gapLips,
  gapThreat,
  strikeBoltPath,
  strikeFill,
  windFieldLook,
  windPushes,
} from '../src/render/smith_heart_fx/breath_fight_fx_core';
import { BREATH, CORNICE_GAPS, SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_CUES,
  BREATH_GUARDIAN,
  BREATH_OBJECTS,
  BREATH_TUNING,
  breathWindTemplate,
  calmTemplate,
  timedTemplate,
} from '../src/sim/encounters/smith_heart/breath_ids';
import { authoredFieldCliffRuns } from '../src/sim/instances/authored_field';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('breath_fight_fx_core', () => {
  it('reads the wind in every pushing phase, inward while it draws breath, quiet when still', () => {
    for (const phase of ['blow', 'gust'] as const) {
      const look = windFieldLook(phase, 0.5);
      expect(look.chevron).toBeGreaterThan(0.9);
      expect(look.strength).toBeGreaterThan(0.9);
      expect(look.inward).toBe(false);
      expect(windPushes(phase)).toBe(true);
    }
    // The gather builds toward the blow, its edge sweeping across.
    const g0 = windFieldLook('gather', 0);
    const g1 = windFieldLook('gather', 1);
    expect(g0.chevron).toBeGreaterThan(0.3);
    expect(g1.chevron).toBeGreaterThan(g0.chevron);
    expect(g0.front).toBe(0);
    expect(g1.front).toBe(1);
    expect(windFieldLook('inhale', 0.5).inward).toBe(true);
    expect(windFieldLook('break', 0.5).inward).toBe(true);
    expect(windFieldLook('calm', 1).chevron).toBe(0);
    expect(windFieldLook('still', 0.5).chevron).toBe(0);
    expect(windFieldLook(null, 0.5).strength).toBe(0);
    const d = bearingDir(90);
    expect(d.x).toBeCloseTo(1);
    expect(d.z).toBeCloseTo(0);
    const out = { x: 0, z: 0 };
    expect(bearingDir(180, out)).toBe(out);
    expect(out.z).toBeCloseTo(-1);
  });

  it('draws the field over the Cornice floor and the lips on its open runs only', () => {
    expect(corniceOutline().length).toBeGreaterThan(40);
    const lips = gapLips();
    expect(lips).toHaveLength(CORNICE_GAPS.length);
    const open = authoredFieldCliffRuns(SMITH_HEART_FIELD).filter((r) => r.open);
    expect(lips.flatMap((l) => l.segments)).toHaveLength(open.length);
    for (const lip of lips) {
      expect(lip.segments.length).toBeGreaterThan(0);
      for (const s of lip.segments) expect(Math.hypot(s.nx, s.nz)).toBeCloseTo(1);
    }
  });

  it("ends the kit's broken wall exactly where each drawn lip ends (breathGapEnds vs gapLips)", () => {
    const ends = breathGapEnds();
    const lips = gapLips();
    const onLip = (lip: (typeof lips)[number], e: { x: number; z: number }) =>
      lip.segments.find(
        (s) =>
          Math.hypot(s.ax - e.x, s.az - e.z) < 0.05 || Math.hypot(s.bx - e.x, s.bz - e.z) < 0.05,
      );
    // Two free ends per gap, every one on exactly one lip, facing out as it does.
    expect(ends).toHaveLength(lips.length * 2);
    for (const lip of lips) expect(ends.filter((e) => onLip(lip, e))).toHaveLength(2);
    for (const e of ends) {
      const owners = lips.filter((l) => onLip(l, e));
      expect(owners).toHaveLength(1);
      const seg = onLip(owners[0], e);
      expect(seg?.nx).toBeCloseTo(e.nx);
      expect(seg?.nz).toBeCloseTo(e.nz);
      // The end runs on past the lip (away from its own run).
      expect(Math.hypot(e.ux, e.uz)).toBeCloseTo(1);
    }
  });

  it('flares a gap when the wind blows its way, never when it blows away', () => {
    for (const g of CORNICE_GAPS) {
      expect(gapThreat(g, 'blow', g.deg)).toBeGreaterThan(0.8);
      expect(gapThreat(g, 'blow', g.deg + 180)).toBe(0);
      expect(gapThreat(g, 'calm', g.deg)).toBe(0);
      expect(gapThreat(g, 'gather', g.deg)).toBeLessThan(gapThreat(g, 'blow', g.deg));
    }
  });

  it('the circle lands, holds and spends; its seats count down', () => {
    expect(calmLook('land', 0).fill).toBe(0);
    expect(calmLook('land', 1).fill).toBe(1);
    expect(calmLook('hold', 0.5).dome).toBe(1);
    expect(calmLook('spent', 0).fade).toBeLessThan(calmLook('hold', 0).fade);
    expect(calmSeatsLeft(0)).toBe(BREATH_TUNING.circleSeats);
    expect(calmSeatsLeft(BREATH_TUNING.circleSeats + 2)).toBe(0);
  });

  it('fills the timed spots, fades the charged ground, flares the bolts', () => {
    expect(strikeFill(0, 1.6)).toBe(0);
    expect(strikeFill(0.8, 1.6)).toBeCloseTo(0.5);
    expect(strikeFill(9, 1.6)).toBe(1);
    expect(chargedFade(0, 18)).toBe(1);
    expect(chargedFade(18, 18)).toBeLessThan(0.5);
    expect(cradleLook(6, 6).fill).toBe(1);
    expect(boltFlare(0.01, 0.4)).toBeGreaterThan(0.5);
    expect(boltFlare(0.5, 0.4)).toBe(0);
    for (const p of strikeBoltPath(7, 42, 2.2))
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(2.2 * Math.SQRT2);
  });

  it('knows its objects and claims its own cues only', () => {
    expect(breathObjectKind(breathWindTemplate('blow', 120, 10))).toBe('wind');
    expect(breathObjectKind(calmTemplate('hold', 6))).toBe('calm');
    expect(breathObjectKind(BREATH_OBJECTS.vortex)).toBe('vortex');
    expect(breathObjectKind(BREATH_OBJECTS.gale)).toBe('gale');
    expect(breathObjectKind(timedTemplate(BREATH_OBJECTS.strikePrefix, 1.6))).toBe('strike');
    expect(breathObjectKind(timedTemplate(BREATH_OBJECTS.chargedPrefix, 18))).toBe('charged');
    expect(breathObjectKind(timedTemplate(BREATH_OBJECTS.cradlePrefix, 6))).toBe('cradle');
    expect(breathObjectKind('sh_council_rubble')).toBeNull();
    for (const cue of [
      BREATH_CUES.strike,
      BREATH_CUES.fork,
      BREATH_CUES.discharge,
      BREATH_CUES.calmLand,
      BREATH_CUES.anchor,
      BREATH_CUES.fall,
      BREATH_CUES.toss,
      BREATH_CUES.swell,
      BREATH_CUES.tear,
    ])
      expect(breathFightClaims(cue), cue).toBe(true);
    // The exhale stays the gust painter's (breath_fx.ts) and the generic draw's.
    expect(breathFightClaims(BREATH_CUES.gust)).toBe(false);
    expect(breathFightClaims(undefined)).toBe(false);
  });

  it('finds the claim it stands in', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 2);
    expect(breathClaimOrigin(o.x + 10, o.z + 196)).toEqual(o);
    expect(breathClaimOrigin(0, 0)).toBeNull();
  });
});

describe('smith_heart_breath_audio_core', () => {
  it('gathers before each blow, sighs into the calm, loops the gale through it', () => {
    expect(windPhaseSound('calm', 'gather')).toEqual({ oneShot: 'gather', blowing: false });
    expect(windPhaseSound('gather', 'blow')).toEqual({ oneShot: null, blowing: true });
    expect(windPhaseSound('blow', 'blow')).toEqual({ oneShot: null, blowing: true });
    expect(windPhaseSound('blow', 'calm')).toEqual({ oneShot: 'calm', blowing: false });
    expect(windPhaseSound('storm', 'gustgather').oneShot).toBe('gather');
    expect(windPhaseSound('gust', 'storm').oneShot).toBe('calm');
    expect(windPhaseSound(null, null)).toEqual({ oneShot: null, blowing: false });
  });

  it('plays only samples the catalog holds, and claims its cues from the HUD', () => {
    const catalog = new Set(SFX.map((e: { key: string }) => e.key));
    for (const key of BREATH_SFX_KEYS) expect(catalog.has(key), key).toBe(true);
    expect(BREATH_SFX_KEYS.length).toBe(15);
    for (const cue of Object.keys(BREATH_CUE_SOUNDS)) expect(breathSoundClaims(cue)).toBe(true);
    expect(breathSoundClaims('heart_council_pillar_rise')).toBe(false);
    const inhale = BREATH_BAR_SOUNDS[BREATH_CASTS.inhale];
    expect(breathBarRate(inhale, 5)).toBe(1);
    expect(breathBarRate(inhale, 1)).toBe(1.2);
  });
});

describe('BreathFightFx', () => {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  const C = BREATH.cornice;
  function entity(
    id: number,
    kind: Entity['kind'],
    templateId: string,
    x: number,
    z: number,
    scale = 1,
  ): Entity {
    return {
      id,
      kind,
      templateId,
      name: templateId,
      pos: { x: o.x + x, y: C.h, z: o.z + z },
      prevPos: { x: o.x + x, y: C.h, z: o.z + z },
      facing: 0,
      scale,
      hp: 100,
      maxHp: 100,
      dead: false,
      inCombat: true,
      auras: [] as Entity['auras'],
      castingAbility: null as string | null,
      castTargetId: null as number | null,
      castRemaining: 0,
      castTotal: 0,
    } as unknown as Entity;
  }

  it("lays every footprint at its object's radius, marks the players, claims its cues, disposes", () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', -8, 190);
    const pinned = entity(2, 'player', 'mage', 30, 196);
    pinned.auras.push({ id: BREATH_AURAS.pinned } as Entity['auras'][number]);
    const anchored = entity(3, 'player', 'priest', -12, 196);
    anchored.auras.push({ id: BREATH_AURAS.anchor } as Entity['auras'][number]);
    const conductor = entity(4, 'player', 'rogue', 6, 180);
    conductor.auras.push({ id: BREATH_AURAS.drawn } as Entity['auras'][number]);
    const boss = entity(10, 'mob', BREATH_GUARDIAN, C.x, C.z + 2);
    const wind = entity(11, 'object', breathWindTemplate('blow', 128, 10), C.x, C.z);
    const calm = entity(12, 'object', calmTemplate('hold', 6), -12, 196, BREATH_TUNING.circleR);
    const strike = entity(
      13,
      'object',
      timedTemplate(BREATH_OBJECTS.strikePrefix, 1.6),
      10,
      200,
      BREATH_TUNING.strikeR,
    );
    const charged = entity(
      14,
      'object',
      timedTemplate(BREATH_OBJECTS.chargedPrefix, 18),
      14,
      190,
      BREATH_TUNING.chargedR,
    );
    const gale = entity(15, 'object', BREATH_OBJECTS.gale, -20, 205, BREATH_TUNING.galeR);
    const vortex = entity(16, 'object', BREATH_OBJECTS.vortex, 0, 205, BREATH_TUNING.vortexR);
    for (const e of [
      me,
      pinned,
      anchored,
      conductor,
      boss,
      wind,
      calm,
      strike,
      charged,
      gale,
      vortex,
    ])
      entities.set(e.id, e);
    const world = {
      entities,
      entityRosterVersion: 1,
      player: me,
      playerId: me.id,
    } as unknown as IWorld & { entityRosterVersion: number };
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new BreathFightFx(
      scene,
      () => C.h,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    const root = scene.getObjectByName('smith-heart-breath-fight-fx');
    expect(root).toBeDefined();
    for (let i = 0; i < 12; i++) fx.update(1 / 20);
    const field = root?.getObjectByName('smithHeartBreathWindField');
    expect(field?.visible).toBe(true);
    expect(root?.getObjectByName('smithHeartBreathGapLip')).toBeDefined();
    // Every footprint at its object's own radius (the fans' horizontal scale).
    const shownFans = (r: number) =>
      (root?.children ?? []).filter(
        (c) => c instanceof THREE.Group && c.visible && Math.abs(c.scale.x - r) < 1e-6,
      ).length;
    expect(shownFans(BREATH_TUNING.circleR)).toBeGreaterThanOrEqual(1);
    expect(shownFans(BREATH_TUNING.strikeR)).toBeGreaterThanOrEqual(1);
    expect(shownFans(BREATH_TUNING.chargedR)).toBeGreaterThanOrEqual(1);
    expect(shownFans(BREATH_TUNING.galeR)).toBeGreaterThanOrEqual(1);
    expect(shownFans(BREATH_TUNING.vortexR)).toBeGreaterThanOrEqual(1);
    // The players' marks: anchored, pinned, the conductor's beacon.
    expect(shownFans(1.15)).toBe(1);
    expect(shownFans(1.9)).toBe(1);
    expect(root?.getObjectByName('smithHeartBreathBeacon')?.visible).toBe(true);
    // The circle's seats: P.seats pips per circle (the pool sized and indexed
    // alike), the one anchored player inside it taking one.
    const P = BREATH_FIGHT_POOLS;
    expect(P.seats).toBe(BREATH_TUNING.circleSeats);
    const pips = (root?.children ?? []).filter(
      (c) => c instanceof THREE.Sprite && c.name === 'smithHeartBreathSeat',
    ) as THREE.Sprite[];
    expect(pips).toHaveLength(P.seats * P.calm);
    const shown = pips.filter((p) => p.visible);
    expect(shown).toHaveLength(P.seats);
    expect(shown.filter((p) => p.material.name === 'smithHeartBreathSeat')).toHaveLength(
      calmSeatsLeft(1),
    );
    // The forking bolt's bar shows its jump reach round its target.
    boss.castingAbility = BREATH_CASTS.fork;
    boss.castTargetId = conductor.id;
    boss.castTotal = 2.5;
    boss.castRemaining = 1.2;
    fx.update(1 / 20);
    expect(shownFans(BREATH_TUNING.forkJump)).toBe(1);
    // Its own cues are claimed; another's are not.
    const at = (ability: string, radius = 3) =>
      ({
        type: 'spellfxAt',
        x: o.x + 10,
        z: o.z + 200,
        radius,
        school: 'nature',
        fx: 'burst',
        ability,
      }) as unknown as SimEvent;
    expect(fx.handleEvent(at(BREATH_CUES.strike, BREATH_TUNING.strikeR))).toBe(true);
    expect(fx.handleEvent(at(BREATH_CUES.discharge, BREATH_TUNING.cradleR))).toBe(true);
    expect(fx.handleEvent(at('heart_council_pillar_collapse'))).toBe(false);
    const beam = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: conductor.id,
      school: 'nature',
      fx: 'beam',
      ability: BREATH_CUES.fork,
    } as SimEvent;
    expect(fx.handleEvent(beam)).toBe(true);
    for (let i = 0; i < 4; i++) fx.update(1 / 20);
    expect(shaken).toBeGreaterThan(0);
    // Gone objects free their slots; out of the raid nothing shows.
    for (const id of [12, 13, 14, 15, 16]) entities.delete(id);
    world.entityRosterVersion++;
    boss.castingAbility = null;
    fx.update(0.2);
    expect(shownFans(BREATH_TUNING.strikeR)).toBe(0);
    // The roster is walked on a membership change only: a strike the walk
    // was not told of waits for the version to move.
    entities.set(
      13,
      entity(
        13,
        'object',
        timedTemplate(BREATH_OBJECTS.strikePrefix, 1.6),
        10,
        200,
        BREATH_TUNING.strikeR,
      ),
    );
    fx.update(0.2);
    expect(shownFans(BREATH_TUNING.strikeR)).toBe(0);
    world.entityRosterVersion++;
    fx.update(0.2);
    expect(shownFans(BREATH_TUNING.strikeR)).toBe(1);
    me.pos = { x: 0, y: 0, z: 0 };
    fx.update(0.2);
    expect(root?.getObjectByName('smithHeartBreathLocal')?.visible).toBe(false);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-breath-fight-fx')).toBeUndefined();
    expect(BREATH_FIGHT_POOLS.strikes).toBeGreaterThan(BREATH_TUNING.barrageSpots * 3);
  });
});
