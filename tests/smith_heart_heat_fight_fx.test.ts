// The Guardian of the Heat's fight effects (the pure plan
// src/render/smith_heart_fx/heat_fight_fx_core.ts and its painter
// heat_fight_fx.ts): the fight's objects decode to their kinds, it claims
// every one of its cues, a crystal tears up and charges toward each ray on
// the sim's own clock, a ray's beam holds on its target until the next ray, a
// burn climbs a body with its stacks, the channel brims then flows, the
// embers catch and die, the wind-up's floor glow beats and Hearthburst's wave
// spreads; the painter over a fake world shows every footprint, the beam and
// the burn, the channel's lane while it brims, claims its cues, disposes.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HeatFightFx } from '../src/render/smith_heart_fx';
import {
  BEAM_HOLD,
  beamLook,
  burnLook,
  burstWave,
  CHANNEL_LINE,
  channelLook,
  crystalLook,
  embersLook,
  HEAT_FIGHT_POOLS,
  heatFightClaims,
  heatObjectKind,
  pulseRing,
  riseLook,
  windupGather,
  windupGlow,
  windupUrgency,
} from '../src/render/smith_heart_fx/heat_fight_fx_core';
import { HEARTH_CHANNEL } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  channelTemplate,
  crystalTemplate,
  embersTemplate,
  HEAT_AURAS,
  HEAT_CUES,
  HEAT_DIFFICULTY,
  HEAT_GUARDIAN,
  riseTemplate,
  HEAT_TUNING as T,
} from '../src/sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe('heat_fight_fx_core: the fight in the Hearth', () => {
  it("decodes every one of the fight's objects to its kind, and nothing else", () => {
    expect(heatObjectKind(riseTemplate(2.5))).toBe('rise');
    expect(heatObjectKind(crystalTemplate(20))).toBe('crystal');
    expect(heatObjectKind(channelTemplate('flow', 6))).toBe('channel');
    expect(heatObjectKind(embersTemplate(25))).toBe('embers');
    expect(heatObjectKind('sh_heat_channel_boil_3')).toBeNull();
    expect(heatObjectKind('sh_quench_hole')).toBeNull();
  });

  it('claims every cue of its own and nothing else', () => {
    for (const cue of Object.values(HEAT_CUES)) expect(heatFightClaims(cue), cue).toBe(true);
    expect(heatFightClaims('fireball')).toBe(false);
    expect(heatFightClaims(null)).toBe(false);
    expect(heatFightClaims(undefined)).toBe(false);
  });

  it('fills a rise spot over its bar', () => {
    expect(riseLook(0, T.shedCast).fill).toBe(0);
    expect(riseLook(T.shedCast / 2, T.shedCast).fill).toBeCloseTo(0.5);
    expect(riseLook(T.shedCast, T.shedCast).fill).toBe(1);
  });

  it("tears a crystal up, charges its reach to each ray on the sim's clock, fails at the end", () => {
    expect(crystalLook(0, T.crystalLife).rise).toBe(0);
    expect(crystalLook(1, T.crystalLife).rise).toBe(1);
    expect(crystalLook(T.rayFirst - 0.01, T.crystalLife).charge).toBeGreaterThan(0.95);
    expect(crystalLook(T.rayFirst + 0.01, T.crystalLife).charge).toBeLessThan(0.05);
    expect(crystalLook(T.rayFirst + T.rayEvery - 0.01, T.crystalLife).charge).toBeGreaterThan(0.95);
    expect(crystalLook(T.crystalLife, T.crystalLife).left).toBe(0);
    for (let t = 0; t < T.crystalLife; t += 0.37) {
      const l = crystalLook(t, T.crystalLife);
      for (const v of Object.values(l)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('holds a ray on its target until the next ray; a ray sent back flashes and goes', () => {
    expect(BEAM_HOLD).toBe(T.rayEvery);
    const hit = beamLook(0, false);
    const held = beamLook(1, false);
    expect(hit.width).toBeGreaterThan(held.width);
    expect(held.alpha).toBeGreaterThan(0.6);
    expect(beamLook(BEAM_HOLD, false).alpha).toBe(0);
    expect(beamLook(0, true).alpha).toBe(1);
    expect(beamLook(0.7, true).alpha).toBe(0);
  });

  it('climbs a burn up a body with its stacks, urgent past eight', () => {
    expect(burnLook(0, 0)).toEqual({ cover: 0, heat: 0, pulse: 0 });
    expect(burnLook(5, 0).cover).toBeGreaterThan(burnLook(1, 0).cover);
    expect(burnLook(T.burnMax, 0).cover).toBe(1);
    let pulsed = false;
    for (let t = 0; t < 1; t += 0.05) if (burnLook(9, t).pulse > 0) pulsed = true;
    expect(pulsed).toBe(true);
    expect(burnLook(4, 0.3).pulse).toBe(0);
  });

  it('lights the channel from its head while it brims, then runs the fire and dies down', () => {
    const still = channelLook('still', 3, 16);
    expect(still.lane).toBe(false);
    expect(still.fire).toBe(0);
    expect(channelLook('warn', 0, T.channelWarn).lit).toBe(0);
    const brim = channelLook('warn', T.channelWarn, T.channelWarn);
    expect(brim.lit).toBe(1);
    expect(brim.lane).toBe(true);
    expect(brim.fill).toBe(1);
    expect(channelLook('flow', 0.2, T.channelFlow).front).toBeLessThan(0.5);
    const flowing = channelLook('flow', 2, T.channelFlow);
    expect(flowing.front).toBe(1);
    expect(flowing.fire).toBe(1);
    expect(flowing.lane).toBe(true);
    expect(channelLook('flow', T.channelFlow, T.channelFlow).fire).toBe(0);
    expect(CHANNEL_LINE.length).toBe(HEARTH_CHANNEL.z1 - HEARTH_CHANNEL.z0);
  });

  it('catches embers and lets them die; beats the wind-up; spreads the wave', () => {
    expect(embersLook(0, T.embersLife)).toBe(0);
    expect(embersLook(5, T.embersLife)).toBe(1);
    expect(embersLook(T.embersLife, T.embersLife)).toBe(0);
    expect(windupGlow(false, 0.2, 0)).toBe(0);
    let lo = 1;
    let hi = 0;
    for (let t = 0; t < 1; t += 0.02) {
      lo = Math.min(lo, windupGlow(true, 0.95, t));
      hi = Math.max(hi, windupGlow(true, 0.95, t));
    }
    expect(lo).toBeGreaterThanOrEqual(0.3);
    expect(hi).toBeGreaterThan(0.6);
    // Harder the nearer the top, and the gathering rings close in faster.
    let lo90 = 1;
    let lo99 = 1;
    for (let t = 0; t < 2; t += 0.01) {
      lo90 = Math.min(lo90, windupGlow(true, 0.9, t));
      lo99 = Math.min(lo99, windupGlow(true, 0.99, t));
    }
    expect(lo99).toBeGreaterThan(lo90);
    expect(windupUrgency(0.9)).toBe(0);
    expect(windupUrgency(1)).toBeCloseTo(1, 9);
    expect(windupGather(0.3, 0.9).radius).toBeGreaterThan(windupGather(0.9, 0.9).radius);
    expect(windupGather(0, 1).alpha).toBeCloseTo(0, 5);
    expect(burstWave(0).radius).toBeLessThan(burstWave(1).radius);
    expect(burstWave(1.5).alpha).toBe(0);
    expect(pulseRing(1).radius).toBeGreaterThan(pulseRing(0).radius);
  });

  it('pools every crystal heroic raises and every ember the sim keeps', () => {
    expect(HEAT_FIGHT_POOLS.crystals).toBeGreaterThanOrEqual(HEAT_DIFFICULTY.heroic.crystals);
    expect(HEAT_FIGHT_POOLS.beams).toBeGreaterThanOrEqual(HEAT_DIFFICULTY.heroic.crystals);
    expect(HEAT_FIGHT_POOLS.embers).toBe(T.embersCap);
  });
});

describe('HeatFightFx over a fake world', () => {
  it('shows the footprints, the reach, the ray and the burn, the lane while it brims; claims its cues', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    let nextId = 1;
    const entity = (kind: string, templateId: string, x: number, z: number, scale = 1) =>
      ({
        id: nextId++,
        kind,
        templateId,
        name: templateId,
        pos: { x: o.x + x, y: 0, z: o.z + z },
        prevPos: { x: o.x + x, y: 0, z: o.z + z },
        facing: 0,
        scale,
        hp: 100,
        maxHp: 100,
        dead: false,
        auras: [] as Entity['auras'],
        castingAbility: null,
        castRemaining: 0,
        castTotal: 0,
        resource: 40,
        maxResource: 100,
        inCombat: true,
      }) as unknown as Entity;
    const entities = new Map<number, Entity>();
    const me = entity('player', 'warrior', -192, 2);
    const boss = entity('mob', HEAT_GUARDIAN, -210, 0);
    const rise = entity('object', riseTemplate(T.shedCast), -232, 28, T.crystalR);
    const channel = entity(
      'object',
      channelTemplate('still', 16),
      HEARTH_CHANNEL.x,
      0,
      T.channelHalf,
    );
    for (const e of [me, boss, rise, channel]) entities.set(e.id, e);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const bump = () => {
      (world as unknown as { entityRosterVersion: number }).entityRosterVersion++;
    };
    const scene = new THREE.Scene();
    const fx = new HeatFightFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      () => {},
    );
    const run = (n: number) => {
      for (let i = 0; i < n; i++) fx.update(1 / 20);
    };
    run(4);
    const root = scene.getObjectByName('smith-heart-heat-fight-fx');
    expect(root).toBeDefined();
    expect(root?.getObjectByName('smithHeartHeatRiseCracks')?.visible).toBe(true);
    expect(root?.getObjectByName('smithHeartHeatChannel')?.visible).toBe(true);
    // A crystal where the rise spot was, the player in its reach.
    entities.delete(rise.id);
    const crystal = entity('object', crystalTemplate(T.crystalLife), -190, 0, T.crystalR);
    entities.set(crystal.id, crystal);
    bump();
    run(4);
    expect(root?.getObjectByName('smithHeartHeatRiseCracks')?.visible).toBe(false);
    let crystals = 0;
    root?.traverse((c) => {
      if (c.name === 'smithHeartHeatCrystal' && c.visible) crystals++;
    });
    expect(crystals).toBe(1);
    // Its ray strikes the player: the beam held on them, claimed.
    const beam = {
      type: 'spellfx',
      sourceId: crystal.id,
      targetId: me.id,
      school: 'fire',
      fx: 'beam',
      ability: HEAT_CUES.beam,
    } as SimEvent;
    expect(fx.handleEvent(beam)).toBe(true);
    me.auras.push({ id: HEAT_AURAS.burn, stacks: 4 } as Entity['auras'][number]);
    run(4);
    const rays = () => {
      let n = 0;
      root?.traverse((c) => {
        if (c.name === 'smithHeartHeatRay' && c.visible) n++;
      });
      return n;
    };
    expect(rays()).toBe(1);
    expect(root?.getObjectByName('smithHeartHeatBurns')?.visible).toBe(true);
    run(Math.round((BEAM_HOLD + 0.4) * 20));
    expect(rays()).toBe(0);
    // The channel brims: its lane on the floor (one more telegraph shown).
    const shown = () => {
      let n = 0;
      root?.traverse((c) => {
        if (
          c instanceof THREE.Group &&
          c !== root &&
          c.visible &&
          c.name !== 'smithHeartHeatCrystal' &&
          c.children.some((m) => m instanceof THREE.Mesh && m.visible)
        )
          n++;
      });
      return n;
    };
    const before = shown();
    channel.templateId = channelTemplate('warn', T.channelWarn);
    run(4);
    expect(shown()).toBe(before + 1);
    channel.templateId = channelTemplate('still', 16);
    run(4);
    expect(shown()).toBe(before);
    // Heroic embers under the player.
    const embers = entity('object', embersTemplate(T.embersLife), -192, 2, T.embersR);
    entities.set(embers.id, embers);
    bump();
    run(4);
    expect(root?.getObjectByName('smithHeartHeatKnellEmbers')?.visible).toBe(true);
    // The wind-up: the floor's heat glow on every tier.
    boss.auras.push({ id: HEAT_AURAS.overheating } as Entity['auras'][number]);
    run(3);
    expect(root?.getObjectByName('smithHeartHeatFloorGlow')?.visible).toBe(true);
    const burst = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'fire',
      fx: 'nova',
      ability: HEAT_CUES.overheat,
    } as SimEvent;
    expect(fx.handleEvent(burst)).toBe(true);
    run(2);
    expect(root?.getObjectByName('smithHeartHeatBurstWave')?.visible).toBe(true);
    expect(fx.handleEvent({ ...beam, ability: 'fireball' } as SimEvent)).toBe(false);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-heat-fight-fx')).toBeUndefined();
  });
});
