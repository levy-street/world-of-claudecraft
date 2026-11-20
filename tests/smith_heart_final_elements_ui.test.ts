// The Masterless Strength's OWN elements as the raid reads them (Jose's brief
// of 2026-11-19 (b)):
//   - every aura's tooltip says its rule with the live numbers (no token left
//     unfilled): the four Elemental Strike debuffs (the stack count off the
//     aura), Frozen Solid, the boss's fusion per combo, Magma Rift, the four
//     Opposing Elements marks;
//   - every damage and aura name re-localizes, the fusion's bar reads its name;
//   - the personal arrow rises for every mark that singles a player out
//     (Opposing Elements, Magma Rift), never for a tank's stacks;
//   - the look's pure plan (final_elements_fx_core.ts): the object kinds, the
//     sigils told apart by shape, the aura growing to the swap, the orbs drawn
//     together, the lane fronts on the sim's own speed, the spires' charge;
//   - the painter over a fake world (FinalKitFx): the tank's shell, the sigil
//     over every marked player, the fusion's orbs, the steam's billows, the
//     flame wall, the spikes, the hail, the spires; every cue claimed.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FinalKitFx } from '../src/render/smith_heart_fx';
import { FINAL_ARROW_AURAS, finalArrowMark } from '../src/render/smith_heart_fx/final_arrow_core';
import {
  ELEMENT_FX_POOLS,
  elementFxClaims,
  elementObjectKind,
  fusionOrbLook,
  hailFall,
  laneFront,
  POLARITY_LOOKS,
  spireGlow,
  strikeAuraLook,
} from '../src/render/smith_heart_fx/final_elements_fx_core';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  ELEMENT_TUNING as E,
  ELEMENT_AURAS,
  ELEMENT_CASTS,
  ELEMENT_CUES,
  ELEMENT_DIFFICULTY,
  ELEMENT_NAMES,
  ELEMENT_OBJECTS,
  echoTemplate,
  elementLaneTemplate,
  hailTemplate,
  POLARITY_CODES,
  residueTemplate,
  rimeTemplate,
  STRIKE_AURAS,
  spireTemplate,
  steamTemplate,
} from '../src/sim/encounters/smith_heart/final_elements_ids';
import {
  FINAL_BOSS,
  FINAL_DIFFICULTY,
  FINAL_ZONE_CODES,
} from '../src/sim/encounters/smith_heart/final_ids';
import type { Aura, Entity, SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { castDisplayName } from '../src/ui/cast_display_name';
import { setLanguage, t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import type { IWorld } from '../src/world_api';

setLanguage('en');
const NM = FINAL_DIFFICULTY.normal.damageMult;
const N = ELEMENT_DIFFICULTY.normal;

describe('the names', () => {
  it('every damage and aura name re-localizes; the fusion bar reads its name', () => {
    for (const name of Object.values(ELEMENT_NAMES))
      expect(localizeSimAuraName(name), name).not.toBeNull();
    expect(castDisplayName(ELEMENT_CASTS.fusion)).toBe('Elemental Fusion');
  });
});

describe('the tooltips', () => {
  const say = (a: Partial<Aura> & { id: string; kind: Aura['kind'] }) => {
    const d = auraEffectDescriptor({ value: 0, ...a });
    expect(d, a.id).not.toBeNull();
    const text = t(d?.key as never, d?.nums as never);
    expect(text, a.id).not.toMatch(/\{\w+\}/);
    return text;
  };

  it('each Elemental Strike debuff says its effect, the stacks and the swap', () => {
    const burn = say({ id: STRIKE_AURAS.heat, kind: 'dot', stacks: 3, value: 75 });
    expect(burn).toContain('75 Fire damage every second');
    expect(burn).toContain('25 for each of your 3 stacks');
    expect(burn).toContain(`at ${E.swapAt} stacks, let the other tank take the boss`);
    expect(burn).toContain(`Every ${E.strikeEvery} sec`);
    expect(burn).toContain(`${Math.round(N.strikeMin * NM)} to ${Math.round(N.strikeMax * NM)}`);
    const frost = say({
      id: STRIKE_AURAS.quench,
      kind: 'slow',
      stacks: 2,
      value: 1 - 2 * N.frostSlowPerStack,
    });
    expect(frost).toContain(`reduced by ${Math.round(2 * N.frostSlowPerStack * 100)}%`);
    expect(frost).toContain(`From ${E.freezeAt} stacks`);
    expect(frost).toContain(`${E.freezeSeconds} sec`);
    const charge = say({ id: STRIKE_AURAS.breath, kind: 'spellvuln', stacks: 3, value: 0.09 });
    expect(charge).toContain('increased by 9%');
    expect(charge).toContain(`within ${E.arcReach} yd`);
    expect(charge).toContain(`From ${E.arcFrom} stacks`);
    const armor = say({ id: STRIKE_AURAS.hammer, kind: 'corrode', stacks: 2, value: 40 });
    expect(armor).toContain(`reduced by ${Math.round(2 * N.armorPerStack * 100)}%`);
    expect(armor).toContain(`never below ${Math.round(E.armorFloor * 100)}%`);
    expect(say({ id: ELEMENT_AURAS.frozen, kind: 'stun' })).toContain(`${E.freezeSeconds} sec`);
    // Hardening Frost (Jose's playtest of 2026-11-20): the frost's tooltip
    // says the ring and how to avoid it, and the ring's mark says it too.
    expect(frost).toContain(`a ${E.rimeR} yd ring that closes after ${E.rimeWarn} sec`);
    expect(frost).toContain('Step out of it');
    const rime = say({ id: ELEMENT_AURAS.rime, kind: 'internal_cd' });
    expect(rime).toContain(`in ${E.rimeWarn} sec`);
    expect(rime).toContain(`within ${E.rimeR} yd`);
    expect(rime).toContain(`frozen solid for ${E.freezeSeconds} sec`);
  });

  it('the fusion names its pair and what comes, one line per combo', () => {
    const fusion = (from: 'heat' | 'quench' | 'breath' | 'hammer', to: typeof from) =>
      say({
        id: ELEMENT_AURAS.fusion,
        kind: 'internal_cd',
        value: FINAL_ZONE_CODES[from],
        value2: FINAL_ZONE_CODES[to],
      });
    expect(fusion('heat', 'quench')).toContain('Scalding Steam');
    expect(fusion('quench', 'heat')).toContain('Scalding Steam');
    expect(fusion('heat', 'hammer')).toContain('Magma Rift');
    expect(fusion('breath', 'heat')).toContain('Firestorm');
    expect(fusion('quench', 'breath')).toContain('Hailstorm');
    expect(fusion('hammer', 'quench')).toContain('spikes of ice and stone');
    expect(fusion('breath', 'hammer')).toContain('Storm Spires');
    expect(fusion('breath', 'hammer')).toContain(`in ${E.fusionCast} sec`);
  });

  it('Magma Rift and each Opposing Elements mark say their rule', () => {
    const magma = say({ id: ELEMENT_AURAS.magmaMark, kind: 'internal_cd' });
    expect(magma).toContain(`within ${E.magmaR} yd`);
    expect(magma).toContain(`${E.lavaLife} sec`);
    expect(magma).toContain(`${Math.round(N.magmaMin * NM)} to ${Math.round(N.magmaMax * NM)}`);
    const want = { fire: 'Ice', ice: 'Fire', earth: 'Lightning', lightning: 'Earth' } as const;
    for (const [p, opp] of Object.entries(want)) {
      const text = say({
        id: ELEMENT_AURAS.polarity,
        kind: 'internal_cd',
        value: POLARITY_CODES[p as keyof typeof want],
      });
      expect(text, p).toContain(`touch a player marked ${opp}`);
      expect(text, p).toContain(`within ${E.meetR} yd`);
      expect(text, p).toContain(`${E.polaritySeconds} sec`);
      expect(text, p).toContain(`within ${E.clashR} yd`);
    }
  });
});

describe("the marked player's own arrow", () => {
  it('rises for Opposing Elements and Magma Rift, never for a tank stack', () => {
    expect(FINAL_ARROW_AURAS).toContain(ELEMENT_AURAS.polarity);
    expect(FINAL_ARROW_AURAS).toContain(ELEMENT_AURAS.magmaMark);
    for (const id of Object.values(STRIKE_AURAS)) expect(FINAL_ARROW_AURAS).not.toContain(id);
    expect(FINAL_ARROW_AURAS).not.toContain(ELEMENT_AURAS.frozen);
    const a = { id: ELEMENT_AURAS.polarity, remaining: 6, duration: 10 } as Aura;
    expect(finalArrowMark({ auras: [a] })).toBe(a);
  });
});

describe('the pure plan', () => {
  it('names every object of its own', () => {
    expect(elementObjectKind(steamTemplate('warn'))).toBe('steamWarn');
    expect(elementObjectKind(steamTemplate('live'))).toBe('steam');
    expect(elementObjectKind(ELEMENT_OBJECTS.lava)).toBe('lava');
    expect(elementObjectKind(elementLaneTemplate(ELEMENT_OBJECTS.firePrefix, 'warn', 108, 5))).toBe(
      'fireWarn',
    );
    expect(elementObjectKind(elementLaneTemplate(ELEMENT_OBJECTS.firePrefix, 'burn', 108, 5))).toBe(
      'fireBurn',
    );
    expect(
      elementObjectKind(elementLaneTemplate(ELEMENT_OBJECTS.avalanchePrefix, 'run', 40, 2.5)),
    ).toBe('avalancheRun');
    expect(elementObjectKind(hailTemplate(1.2))).toBe('hail');
    expect(elementObjectKind(spireTemplate('charge', 0, 3, 1))).toBe('spireCharge');
    expect(elementObjectKind(spireTemplate('fire', 2, 3, 1))).toBe('spireFire');
    expect(elementObjectKind(residueTemplate('frost'))).toBe('residueFrost');
    expect(elementObjectKind('sh_final_whirl_live')).toBeNull();
    for (const cue of Object.values(ELEMENT_CUES)) expect(elementFxClaims(cue), cue).toBe(true);
    expect(elementFxClaims('heart_final_shift')).toBe(false);
  });

  it('tells the four elements apart by SHAPE as well as colour', () => {
    const shapes = new Set(Object.values(POLARITY_LOOKS).map((l) => l.shape));
    const colors = new Set(Object.values(POLARITY_LOOKS).map((l) => l.color));
    const bodies = new Set(Object.values(POLARITY_LOOKS).map((l) => l.body));
    expect(shapes.size).toBe(4);
    expect(colors.size).toBe(4);
    expect(bodies.size).toBe(4);
  });

  it('the strike aura grows to its fullest at the swap; the orbs meet at the bar end', () => {
    let prev = -1;
    for (let s = 1; s <= 6; s++) {
      const l = strikeAuraLook(s);
      expect(l.strength).toBeGreaterThanOrEqual(prev);
      prev = l.strength;
      expect(l.danger).toBe(s >= E.swapAt);
    }
    expect(strikeAuraLook(E.swapAt).strength).toBe(1);
    expect(fusionOrbLook(0).draw).toBe(0);
    expect(fusionOrbLook(1).draw).toBe(1);
    expect(fusionOrbLook(1).size).toBeGreaterThan(fusionOrbLook(0).size);
  });

  it('the fronts ride the sim own speeds; the hail drops late; the spikes rise and sink', () => {
    expect(laneFront(0, 108, 108 / E.fireSpeed)).toBe(0);
    expect(laneFront(1, 108, 108 / E.fireSpeed)).toBeCloseTo(E.fireSpeed, 5);
    expect(laneFront(99, 108, 108 / E.fireSpeed)).toBe(108);
    expect(hailFall(E.hailWarn, E.hailWarn).shown).toBe(false);
    expect(hailFall(0, E.hailWarn).height).toBeCloseTo(0, 5);
    expect(spireGlow(0).links).toBe(false);
    expect(spireGlow(E.spireShowAt + 0.1).links).toBe(true);
    expect(spireGlow(E.spireCharge).veins).toBeGreaterThan(spireGlow(0.5).veins);
  });
});

// ---- the painter over a fake world -------------------------------------------------------

function entity(
  id: number,
  kind: string,
  templateId: string,
  x: number,
  z: number,
  extra: Partial<Entity> = {},
): Entity {
  return {
    id,
    kind,
    templateId,
    name: templateId,
    pos: { x, y: 0, z },
    facing: 0,
    dead: false,
    hp: 100,
    maxHp: 100,
    scale: 1,
    auras: [],
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    castTargetId: null,
    ...extra,
  } as unknown as Entity;
}

function visibleNamed(root: THREE.Object3D | undefined, name: string): number {
  let n = 0;
  root?.traverse((o) => {
    if (o.name === name && o.visible) n++;
  });
  return n;
}

function instancesShown(root: THREE.Object3D | undefined, name: string): number {
  let n = 0;
  const m = new THREE.Matrix4();
  root?.traverse((o) => {
    if (o.name !== name || !(o instanceof THREE.InstancedMesh) || !o.visible) return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      if (Math.abs(m.determinant()) > 1e-9) n++;
    }
  });
  return n;
}

const aura = (id: string, extra: Partial<Aura> = {}): Aura =>
  ({
    id,
    name: 'x',
    kind: 'internal_cd',
    remaining: 5,
    duration: 10,
    value: 0,
    sourceId: 2,
    ...extra,
  }) as Aura;

describe('FinalKitFx draws its own elements', () => {
  it('the shell, the sigils, the orbs, the steam, the wall, the spikes, the hail, the spires', () => {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const at = (dx: number, dz: number) => ({
      x: o.x + HEART_ROOM.x + dx,
      z: o.z + HEART_ROOM.z + dz,
    });
    const entities = new Map<number, Entity>();
    const add = (e: Entity) => entities.set(e.id, e);
    const p = at(-10, -10);
    const me = entity(1, 'player', 'warrior', p.x, p.z, {
      auras: [aura(ELEMENT_AURAS.polarity, { value: POLARITY_CODES.ice })],
    });
    const tank = entity(3, 'player', 'warrior', at(2, 18).x, at(2, 18).z, {
      auras: [aura(STRIKE_AURAS.quench, { kind: 'slow', value: 0.7, stacks: 4 })],
    });
    const fire = entity(4, 'player', 'mage', at(-14, -6).x, at(-14, -6).z, {
      // A value of 0 (Fire) rides the wire as absent.
      auras: [aura(ELEMENT_AURAS.polarity, { value: undefined as unknown as number })],
    });
    const b = at(0, 20);
    const boss = entity(2, 'mob', FINAL_BOSS, b.x, b.z, {
      scale: 3.6,
      castingAbility: ELEMENT_CASTS.fusion,
      castTotal: 3,
      castRemaining: 1.5,
      auras: [
        aura(ELEMENT_AURAS.fusion, {
          value: FINAL_ZONE_CODES.heat,
          value2: FINAL_ZONE_CODES.quench,
        }),
      ],
    });
    for (const e of [me, tank, fire, boss]) add(e);
    const obj = (
      id: number,
      templateId: string,
      dx: number,
      dz: number,
      scale: number,
      facing = 0,
    ) => add(entity(id, 'object', templateId, at(dx, dz).x, at(dx, dz).z, { scale, facing }));
    obj(10, steamTemplate('live'), 20, 5, E.steamR);
    obj(11, ELEMENT_OBJECTS.lava, -20, 5, E.magmaR);
    obj(12, elementLaneTemplate(ELEMENT_OBJECTS.firePrefix, 'burn', 60, 5), 0, -20, 5, Math.PI / 2);
    obj(13, elementLaneTemplate(ELEMENT_OBJECTS.avalanchePrefix, 'run', 40, 2.5), 25, -25, 2.5);
    obj(14, hailTemplate(E.hailWarn), -25, -25, E.hailR);
    obj(15, spireTemplate('charge', 0, 3, 1), 30, 30, E.spireR);
    obj(16, spireTemplate('charge', 1, 3, 1), 40, 30, E.spireR);
    obj(17, spireTemplate('charge', 2, 3, 1), 35, 40, E.spireR);
    obj(18, residueTemplate('storm'), -35, 20, E.residueR);
    obj(19, rimeTemplate(E.rimeWarn), 10, 10, E.rimeR);
    obj(20, echoTemplate('fire'), -10, 25, 1);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const fx = new FinalKitFx(scene, () => 0, world);
    const root = scene.getObjectByName('smith-heart-final-kit-fx');
    // Long enough for the hail to drop in and the wall and spikes to run.
    for (let i = 0; i < 24; i++) fx.update(1 / 30);
    expect(visibleNamed(root, 'smithHeartFinalStrikeShell')).toBe(1);
    expect(instancesShown(root, 'smithHeartFinalStrikePieces')).toBeGreaterThan(0);
    // Every marked player's sigil (the local player's too, and Fire's absent
    // value), and the dev echo's.
    // Ice's crystals orbit; Fire wears flames (particles).
    expect(instancesShown(root, 'smithHeartFinalPolarityPieces')).toBe(ELEMENT_FX_POOLS.markPieces);
    expect(visibleNamed(root, 'smithHeartFinalFusionOrb')).toBe(2);
    expect(visibleNamed(root, 'smithHeartFinalFusionGlow')).toBe(2);
    expect(visibleNamed(root, 'smithHeartFinalSteamBillow')).toBe(ELEMENT_FX_POOLS.billows);
    expect(visibleNamed(root, 'smithHeartFinalFlameWall')).toBeGreaterThan(0);
    // Avalanche's eruption: ice and stone spikes, the torn floor.
    expect(
      instancesShown(root, 'smithHeartAvalancheIce') +
        instancesShown(root, 'smithHeartAvalancheStone'),
    ).toBeGreaterThan(0);
    expect(visibleNamed(root, 'smithHeartAvalancheScar')).toBe(1);
    expect(visibleNamed(root, 'smithHeartFinalSpire')).toBe(3);
    // The dev echo wears its own sigil (three in all now).
    expect(visibleNamed(root, 'smithHeartFinalSigil')).toBe(3);
    // The local player's own arrow (Opposing Elements singles them out).
    expect(finalArrowMark(me)).not.toBeNull();
    // Every cue is claimed (no generic burst doubles it).
    const ev = (ability: string): SimEvent =>
      ({
        type: 'spellfx',
        sourceId: 2,
        targetId: 3,
        school: 'fire',
        fx: 'nova',
        ability,
      }) as SimEvent;
    for (const cue of Object.values(ELEMENT_CUES)) expect(fx.handleEvent(ev(cue)), cue).toBe(true);
    const evAt = (ability: string): SimEvent =>
      ({
        type: 'spellfxAt',
        x: b.x,
        z: b.z,
        school: 'arcane',
        fx: 'burst',
        radius: 4,
        ability,
      }) as SimEvent;
    for (const cue of [
      ELEMENT_CUES.magma,
      ELEMENT_CUES.hail,
      ELEMENT_CUES.clash,
      ELEMENT_CUES.balance,
    ])
      expect(fx.handleEvent(evAt(cue)), cue).toBe(true);
    // Everything gone with its objects and auras.
    for (const id of [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) entities.delete(id);
    for (const e of [me, tank, fire, boss]) e.auras = [];
    boss.castingAbility = null;
    (world as unknown as { entityRosterVersion: number }).entityRosterVersion = 2;
    for (let i = 0; i < 3; i++) fx.update(1 / 30);
    for (const name of [
      'smithHeartFinalStrikeShell',
      'smithHeartFinalSigil',
      'smithHeartFinalFusionOrb',
      'smithHeartFinalSteamBillow',
      'smithHeartFinalFlameWall',
      'smithHeartFinalSpire',
    ])
      expect(visibleNamed(root, name), name).toBe(0);
    // The Avalanche's spikes crumble on after its lane object goes (never
    // popping out), then they and the scar are gone.
    for (let i = 0; i < 30 * 5; i++) fx.update(1 / 30);
    expect(instancesShown(root, 'smithHeartAvalancheIce')).toBe(0);
    expect(instancesShown(root, 'smithHeartAvalancheStone')).toBe(0);
    expect(visibleNamed(root, 'smithHeartAvalancheScar')).toBe(0);
    fx.dispose();
  });
});
