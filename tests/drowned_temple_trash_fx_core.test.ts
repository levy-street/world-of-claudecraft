// The Drowned Temple trash mechanics pass, render side
// (src/render/drowned_temple/temple_trash_fx_core.ts, painted by
// temple_trash_fx.ts): every radius, beat and reach the effects draw is the
// sim's own number off the templates; the new casts carry their floor glyphs
// (a kick glyph under the spark, a control glyph under the gaze, which no
// kick stops); the bodies the light sits on are the manifest's; the gaze eye
// opens with the bar; the dazzle veil never reaches the middle of the screen;
// the spark's arcs strike in chain order; and the painter claims each cue
// and draws off IWorld state alone.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { TempleFx } from '../src/render/drowned_temple/temple_fx';
import {
  TEMPLE_EEL_COIL_RADIUS,
  templeTelegraphSpecs,
} from '../src/render/drowned_temple/temple_fx_core';
import { TempleTrashFx } from '../src/render/drowned_temple/temple_trash_fx';
import {
  chillCrust,
  DAZZLE_VEIL_MAX,
  dazzleVeil,
  echoRingFill,
  gazeEyeLook,
  oathTension,
  SPARK_HOP_STAGGER,
  sparkArcLook,
  sparkHopIndex,
  TEMPLE_TRASH_BODY,
  TEMPLE_TRASH_IDS,
  templeTrashCue,
  templeTrashNumbers,
  templeZoneSpecs,
  trashWave,
  vigilBubble,
  vigilBubbleLook,
  vigilShatter,
  whirlCoreFill,
  wispBurstRadius,
  wispSwellLook,
  wispSwellScale,
} from '../src/render/drowned_temple/temple_trash_fx_core';
import { TelegraphKit } from '../src/render/floor_telegraph';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import { MOBS } from '../src/sim/data';
import {
  TEMPLE_ARCING_SPARK,
  TEMPLE_KIT_CAST_SCHOOLS,
  TEMPLE_LULLABY_ECHO,
  TEMPLE_PRISM_DAZZLE,
  TEMPLE_PRISM_GLARE,
  TEMPLE_SHRINE_VIGIL,
  TEMPLE_SPIRAL_WHIRLPOOL,
  TEMPLE_SWOLLEN_TIDE,
  TEMPLE_TIDEWISP_BURST,
  TEMPLE_VIGIL_PRAYER,
} from '../src/sim/mob/trash_kit/temple_cast_ids';
import type { IWorld } from '../src/world_api';

const kit = (id: string) => MOBS[id]?.trashKit?.temple;

function clipsOf(path: string): string[] {
  const buf = readFileSync(path);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    animations?: { name: string }[];
  };
  return (json.animations ?? []).map((a) => a.name);
}

function visualOf(templateId: string) {
  return VISUALS[visualKeyFor({ kind: 'mob', templateId } as never)];
}

describe('the numbers are the sim’s own', () => {
  const n = templeTrashNumbers();

  it('reads every reach and beat off the templates, none of them missing', () => {
    const vigil = kit('pale_choir_acolyte')?.vigil;
    const echo = kit('pale_choir_acolyte')?.lullabyEcho;
    const guard = kit('drowned_templeguard')?.guard;
    const gaze = kit('glimmerscale_lurker')?.gaze;
    const whirl = kit('lagoon_snapper')?.whirlpool;
    const spark = kit('ice_wraith')?.spark;
    const merge = kit('tidewisp')?.merge;
    const burst = MOBS.tidewisp?.trashKit?.detonate;
    expect(vigil && echo && guard && gaze && whirl && spark && merge && burst).toBeTruthy();
    expect(n.vigil).toEqual({
      range: vigil?.range,
      min: vigil?.min,
      reduction: vigil?.reduction,
      heroicReduction: vigil?.heroicReduction,
    });
    expect(n.oath).toEqual({ range: guard?.range, share: guard?.share });
    expect(n.echo).toEqual({ radius: echo?.radius, delay: echo?.delay, every: echo?.every });
    expect(n.gaze).toEqual({
      range: gaze?.range,
      halfArcDeg: gaze?.halfArcDeg,
      castTime: gaze?.castTime,
      seconds: gaze?.seconds,
      heroicSeconds: gaze?.heroicSeconds,
    });
    expect(n.whirl).toEqual({
      radius: whirl?.radius,
      core: whirl?.core,
      tick: whirl?.tick,
      pull: whirl?.pull,
      heroicPull: whirl?.heroicPull,
    });
    expect(n.spark).toEqual({
      range: spark?.range,
      jump: spark?.jump,
      hits: spark?.hits,
      castTime: spark?.castTime,
    });
    expect(n.wisp).toEqual({
      radius: burst?.radius,
      radiusPer: merge?.radiusPer,
      maxMerges: merge?.max,
      chillSeconds: burst?.slow?.seconds,
    });
    // Every number a ring or a beat is drawn from is a real one.
    for (const v of [
      n.vigil.range,
      n.oath.range,
      n.echo.radius,
      n.echo.every,
      n.gaze.range,
      n.whirl.radius,
      n.whirl.core,
      n.whirl.tick,
      n.wisp.radius,
      n.wisp.radiusPer,
      n.wisp.chillSeconds,
    ])
      expect(v).toBeGreaterThan(0);
    // The singers share one vigil: the siren's reads the same as the acolyte's.
    expect(kit('moonlit_siren')?.vigil?.range).toBe(n.vigil.range);
  });

  it('rings the echo at its reach in the control colour, and the whirlpool’s core in danger', () => {
    const zones = templeZoneSpecs();
    expect(zones[TEMPLE_LULLABY_ECHO].radius).toBe(kit('pale_choir_acolyte')?.lullabyEcho?.radius);
    expect(zones[TEMPLE_LULLABY_ECHO].color).toBe(TELEGRAPH_THREAT_COLORS.control);
    expect(zones[TEMPLE_SPIRAL_WHIRLPOOL].radius).toBe(kit('lagoon_snapper')?.whirlpool?.core);
    expect(zones[TEMPLE_SPIRAL_WHIRLPOOL].color).toBe(TELEGRAPH_THREAT_COLORS.danger);
    // The core is the inner bite, inside the pull's reach.
    expect(zones[TEMPLE_SPIRAL_WHIRLPOOL].radius).toBeLessThan(n.whirl.radius);
  });

  it('widens a swollen wisp’s burst ring exactly as the sim widens its burst', () => {
    const burst = MOBS.tidewisp?.trashKit?.detonate;
    const merge = kit('tidewisp')?.merge;
    for (let v = 0; v <= (merge?.max ?? 0); v++) {
      expect(wispBurstRadius(v)).toBe((burst?.radius ?? 0) + (merge?.radiusPer ?? 0) * v);
    }
    expect(wispBurstRadius(0)).toBe(burst?.radius);
    expect(wispSwellScale(1)).toBeCloseTo(1.4, 6);
    expect(wispSwellScale(2)).toBeCloseTo(1.8, 6);
  });
});

describe('the cast glyphs', () => {
  const specs = templeTelegraphSpecs();

  it('lays a kick glyph under the Arcing Spark, which a kick locks out', () => {
    expect(specs[TEMPLE_ARCING_SPARK]?.shape).toBe('sigil');
    // Wider than the eel's coil: a glyph inside it is covered by the body.
    expect(specs[TEMPLE_ARCING_SPARK]?.range ?? 0).toBeGreaterThan(TEMPLE_EEL_COIL_RADIUS);
    expect(specs[TEMPLE_ARCING_SPARK]?.color).toBe(TELEGRAPH_THREAT_COLORS.interrupt);
    expect(TEMPLE_KIT_CAST_SCHOOLS[TEMPLE_ARCING_SPARK]).toBeDefined();
  });

  it('lays a control glyph, never a kick glyph, under the Prism Glare (turn your back)', () => {
    expect(specs[TEMPLE_PRISM_GLARE]?.shape).toBe('sigil');
    expect(specs[TEMPLE_PRISM_GLARE]?.color).toBe(TELEGRAPH_THREAT_COLORS.control);
    expect(TEMPLE_KIT_CAST_SCHOOLS[TEMPLE_PRISM_GLARE]).toBeUndefined();
  });

  it('gives each new bar an existing creature clip, or none at all', () => {
    const lurker = visualOf('glimmerscale_lurker');
    const eel = visualOf('ice_wraith');
    expect(lurker.clips.castByAbility?.[TEMPLE_PRISM_GLARE]).toBe('Cast');
    expect(clipsOf('public/models/creatures/temple_lurker.glb')).toContain('Cast');
    // The Ice Wraith ships no cast clip: the Arcing Spark
    // runs its bar over the hover, and a clip the file lacks is never named.
    expect(eel.clips.castByAbility?.[TEMPLE_ARCING_SPARK]).toBeUndefined();
    expect(eel.clips.cast).toBeUndefined();
  });
});

describe('the bodies the light sits on', () => {
  it('match the manifest’s drawn heights at the templates’ scales', () => {
    for (const [templateId, body] of Object.entries(TEMPLE_TRASH_BODY)) {
      const v = visualOf(templateId);
      const scale = MOBS[templateId]?.scale ?? 1;
      expect(body.height, templateId).toBeCloseTo((v.height ?? 0) * scale, 5);
      expect(body.hover, templateId).toBeCloseTo(v.hover ?? 0, 5);
    }
    expect(Object.keys(TEMPLE_TRASH_BODY).sort()).toEqual(Object.values(TEMPLE_TRASH_IDS).sort());
  });
});

describe('the looks', () => {
  it('brightens the vigil bubble with the ward and with every pilgrim past two', () => {
    const normal = vigilBubbleLook(0.75, 2, 1).strength;
    const heroic = vigilBubbleLook(0.85, 2, 1).strength;
    const crowded = vigilBubbleLook(0.75, 4, 1).strength;
    expect(heroic).toBeGreaterThan(normal);
    expect(crowded).toBeGreaterThan(normal);
    expect(vigilBubbleLook(0.75, 2, 0).grow).toBe(0);
    expect(vigilBubbleLook(0.75, 2, 10).grow).toBe(1);
  });

  it('draws the oath taut at the sim’s reach', () => {
    const range = templeTrashNumbers().oath.range;
    expect(oathTension(0, range)).toBe(0);
    expect(oathTension(range / 2, range)).toBeCloseTo(0.5, 6);
    expect(oathTension(range, range)).toBe(1);
    expect(oathTension(range * 3, range)).toBe(1);
  });

  it('fills the echo ring to the first beat over the delay, then to each beat over the interval', () => {
    const { delay, every } = templeTrashNumbers().echo;
    expect(echoRingFill(0, -1, delay, every)).toBe(0);
    expect(echoRingFill(delay / 2, -1, delay, every)).toBeCloseTo(0.5, 6);
    expect(echoRingFill(delay, -1, delay, every)).toBe(1);
    expect(echoRingFill(5, 0, delay, every)).toBe(0);
    expect(echoRingFill(5, every / 2, delay, every)).toBeCloseTo(0.5, 6);
  });

  it('fills the whirlpool core to a bite every tick from the moment it turns', () => {
    const { tick } = templeTrashNumbers().whirl;
    expect(whirlCoreFill(0, tick)).toBe(0);
    expect(whirlCoreFill(tick * 0.5, tick)).toBeCloseTo(0.5, 6);
    expect(whirlCoreFill(tick * 2.25, tick)).toBeCloseTo(0.25, 6);
  });

  it('opens the gaze eye with the bar, the same opening under reduced motion', () => {
    let last = -1;
    for (let f = 0; f <= 1.0001; f += 0.1) {
      const look = gazeEyeLook(f, 3, false);
      expect(look.open).toBeGreaterThan(last);
      last = look.open;
      expect(gazeEyeLook(f, 3, true).open).toBe(look.open);
    }
    expect(gazeEyeLook(1, 0, false).open).toBeCloseTo(1, 6);
    // No throb before the last third.
    expect(gazeEyeLook(0.5, 1.234, false).pulse).toBe(0);
  });

  it('keeps the dazzle veil to the edges, flashes once, and stills it for reduced motion', () => {
    const { seconds } = templeTrashNumbers().gaze;
    const fresh = dazzleVeil(seconds, seconds, 0, false);
    expect(fresh.flash).toBeGreaterThan(0);
    expect(fresh.edge).toBeLessThanOrEqual(DAZZLE_VEIL_MAX);
    expect(dazzleVeil(seconds, seconds, 1, false).flash).toBe(0);
    expect(dazzleVeil(seconds, seconds, 0, true).flash).toBe(0);
    expect(dazzleVeil(seconds, seconds, 0, true).edge).toBeLessThan(fresh.edge);
    expect(dazzleVeil(0, seconds, 2, false)).toEqual({ edge: 0, flash: 0 });
  });

  it('strikes the spark’s hops in chain order, one stagger apart', () => {
    expect(sparkHopIndex(-1, 0, 5)).toBe(0);
    expect(sparkHopIndex(5, 0, 5)).toBe(1);
    expect(sparkHopIndex(5, 2, 5)).toBe(3);
    expect(sparkHopIndex(5, 3, 9)).toBe(0);
    expect(sparkArcLook(0, 1).alpha).toBe(0);
    expect(sparkArcLook(SPARK_HOP_STAGGER, 1).alpha).toBeGreaterThan(0);
    expect(sparkArcLook(0.01, 0).alpha).toBeGreaterThan(0);
    expect(sparkArcLook(5, 0).alpha).toBe(0);
  });

  it('fills a caller-owned out object, same values as a fresh one (no frame-path allocation)', () => {
    const bubbleOut = { radius: -1, up: -1 };
    const bubble = vigilBubble(TEMPLE_TRASH_IDS.acolyte, bubbleOut);
    expect(bubble).toBe(bubbleOut);
    expect(bubble).toEqual(vigilBubble(TEMPLE_TRASH_IDS.acolyte));
    expect(bubble.radius).toBeGreaterThan(0);

    const shatterOut = { scale: -1, crack: -1, alpha: -1 };
    const shatter = vigilShatter(0.3, shatterOut);
    expect(shatter).toBe(shatterOut);
    expect(shatter).toEqual(vigilShatter(0.3));
    expect(shatter.scale).toBeGreaterThan(1);

    const waveOut = { reach: -1, alpha: -1 };
    const wave = trashWave(0.2, 0.6, waveOut);
    expect(wave).toBe(waveOut);
    expect(wave).toEqual(trashWave(0.2, 0.6));
    expect(wave.reach).toBeGreaterThan(0.15);

    const swellOut = { radius: -1, core: -1 };
    const swell = wispSwellLook(2, swellOut);
    expect(swell).toBe(swellOut);
    expect(swell).toEqual(wispSwellLook(2));
    expect(swell.core).toBe(1);

    // Reusing one out object across calls carries no state between them.
    expect(trashWave(0.5, 0.6, waveOut)).toEqual(trashWave(0.5, 0.6));
    expect(vigilBubble(TEMPLE_TRASH_IDS.wisp, bubbleOut)).toEqual(
      vigilBubble(TEMPLE_TRASH_IDS.wisp),
    );
  });

  it('melts the chill’s crust with its own clock', () => {
    const { chillSeconds } = templeTrashNumbers().wisp;
    expect(chillCrust(chillSeconds, chillSeconds)).toBe(1);
    expect(chillCrust(chillSeconds / 2, chillSeconds)).toBeLessThan(1);
    expect(chillCrust(0, chillSeconds)).toBe(0);
  });

  it('tells each cue apart and ignores the wrong shape', () => {
    const ev = (ability: string, fx: string) => ({ type: 'spellfx', ability, fx });
    expect(templeTrashCue(ev(TEMPLE_PRISM_GLARE, 'nova'))).toBe('gaze');
    expect(templeTrashCue(ev(TEMPLE_ARCING_SPARK, 'heavyBolt'))).toBe('spark');
    expect(templeTrashCue(ev(TEMPLE_LULLABY_ECHO, 'nova'))).toBe('echo');
    expect(templeTrashCue(ev(TEMPLE_SPIRAL_WHIRLPOOL, 'windup'))).toBe('whirl');
    expect(templeTrashCue(ev(TEMPLE_SWOLLEN_TIDE, 'nova'))).toBe('merge');
    expect(templeTrashCue(ev(TEMPLE_TIDEWISP_BURST, 'nova'))).toBe('burst');
    expect(templeTrashCue(ev(TEMPLE_PRISM_GLARE, 'heavyBolt'))).toBeNull();
    expect(templeTrashCue({ type: 'damage', ability: TEMPLE_PRISM_GLARE, fx: 'nova' })).toBeNull();
  });
});

// ---- the painter, on a stub world --------------------------------------------

interface StubEntity {
  id: number;
  kind: 'mob' | 'player';
  templateId: string;
  pos: { x: number; y: number; z: number };
  facing: number;
  dead: boolean;
  auras: { id: string; value: number; sourceId: number; remaining: number; duration: number }[];
  castingAbility: string | null;
  castRemaining: number;
  castTotal: number;
}

function stubWorld() {
  const entities = new Map<number, StubEntity>();
  const world = { entities, playerId: 1, entityRosterVersion: 1 };
  const add = (e: Partial<StubEntity> & { id: number; templateId: string }) => {
    const full: StubEntity = {
      kind: 'mob',
      pos: { x: 0, y: 0, z: 0 },
      facing: 0,
      dead: false,
      auras: [],
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      ...e,
    };
    entities.set(full.id, full);
    return full;
  };
  return { world: world as unknown as IWorld, add, entities };
}

function painter() {
  const stub = stubWorld();
  const root = new THREE.Group();
  const kit = new TelegraphKit(root, true);
  const fx = new TempleTrashFx(root, stub.world, () => 0, true, kit);
  fx.markGated();
  return { ...stub, root, fx };
}

const aura = (id: string, sourceId: number, value = 1, remaining = 3, duration = 3) => ({
  id,
  value,
  sourceId,
  remaining,
  duration,
});

function visibleMeshes(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n;
}

describe('the painter', () => {
  it('claims every cue of the pass and leaves the rest to the renderer', () => {
    const { fx, add } = painter();
    add({ id: 1, kind: 'player', templateId: 'player' });
    add({ id: 10, templateId: TEMPLE_TRASH_IDS.lurker });
    add({ id: 11, templateId: TEMPLE_TRASH_IDS.eel });
    const spell = (ability: string, f: string, sourceId: number, targetId = sourceId) =>
      ({ type: 'spellfx', ability, fx: f, sourceId, targetId, school: 'arcane' }) as never;
    expect(fx.handleEvent(spell(TEMPLE_PRISM_GLARE, 'nova', 10))).toBe(true);
    expect(fx.handleEvent(spell(TEMPLE_ARCING_SPARK, 'heavyBolt', 11, 1))).toBe(true);
    // A burst of a wisp it never saw: the generic nova draws it.
    expect(fx.handleEvent(spell(TEMPLE_TIDEWISP_BURST, 'nova', 99))).toBe(false);
    expect(fx.handleEvent(spell('frostbolt', 'nova', 10))).toBe(false);
  });

  it('draws the vigil while it holds, shatters it when it falls, and goes dark after', () => {
    const { fx, add, root } = painter();
    add({ id: 1, kind: 'player', templateId: 'player', pos: { x: 30, y: 0, z: 0 } });
    const singer = add({ id: 20, templateId: TEMPLE_TRASH_IDS.acolyte });
    singer.auras.push(aura(TEMPLE_SHRINE_VIGIL, 20, 0.75));
    const p1 = add({ id: 21, templateId: TEMPLE_TRASH_IDS.pilgrim, pos: { x: 5, y: 0, z: 0 } });
    const p2 = add({ id: 22, templateId: TEMPLE_TRASH_IDS.pilgrim, pos: { x: -5, y: 0, z: 0 } });
    p1.auras.push(aura(TEMPLE_VIGIL_PRAYER, 20));
    p2.auras.push(aura(TEMPLE_VIGIL_PRAYER, 20));
    for (let i = 0; i < 20; i++) fx.update(0.05, i * 0.05);
    // The bubble and two threads draw (plus the particle cloud).
    expect(root.getObjectByName('drowned-temple-trash-fx')?.visible).toBe(true);
    const lit = visibleMeshes(root);
    expect(lit).toBeGreaterThanOrEqual(3);
    // The ward falls: the bubble shatters (still drawn a moment), then all goes.
    singer.auras.length = 0;
    p1.auras.length = 0;
    p2.auras.length = 0;
    fx.update(0.05, 1.05);
    expect(visibleMeshes(root)).toBeGreaterThan(0);
    for (let i = 0; i < 80; i++) fx.update(0.05, 1.1 + i * 0.05);
    expect(root.getObjectByName('drowned-temple-trash-fx')?.visible).toBe(false);
  });

  it('veils the local player only while they wear the dazzle', () => {
    const { fx, add, root } = painter();
    const me = add({ id: 1, kind: 'player', templateId: 'player' });
    const veil = () => root.getObjectByName('drowned-temple-dazzle-veil');
    fx.update(0.2, 0.2);
    expect(veil()?.visible).toBe(false);
    me.auras.push(aura(TEMPLE_PRISM_DAZZLE, 10, 0.5, 3, 3));
    fx.update(0.2, 0.4);
    expect(veil()?.visible).toBe(true);
    me.auras.length = 0;
    fx.update(0.2, 0.6);
    expect(veil()?.visible).toBe(false);
  });

  it('turns the whirlpool round a sheltering snapper and stills it when the shell opens', () => {
    const { fx, add, root } = painter();
    add({ id: 1, kind: 'player', templateId: 'player', pos: { x: 40, y: 0, z: 0 } });
    const snapper = add({ id: 30, templateId: TEMPLE_TRASH_IDS.snapper });
    snapper.auras.push(aura(TEMPLE_SPIRAL_WHIRLPOOL, 30, 1, 5, 5));
    for (let i = 0; i < 10; i++) fx.update(0.1, 0.1 * (i + 1));
    let disc: THREE.Mesh | undefined;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      const u = (m.material as THREE.ShaderMaterial | undefined)?.uniforms;
      if (m.isMesh && u?.uSpin && m.visible) disc = m;
    });
    expect(disc).toBeDefined();
    // The vortex spans the sim's pull reach once swollen in.
    expect(disc?.scale.x).toBeCloseTo(templeTrashNumbers().whirl.radius, 5);
    snapper.auras.length = 0;
    fx.update(0.1, 1.1);
    expect(disc?.visible).toBe(false);
  });

  it('rings the eel with a visible kick glyph wider than its coil while the spark bar runs', async () => {
    const { world, add } = stubWorld();
    // The boss layers beside the trash read the local player off the world.
    (world as unknown as { player: StubEntity }).player = add({
      id: 1,
      kind: 'player',
      templateId: 'player',
    });
    const eel = add({ id: 11, templateId: TEMPLE_TRASH_IDS.eel, pos: { x: 4, y: 0, z: 10 } });
    const scene = new THREE.Scene();
    const temple = new TempleFx(scene, () => 0, world);
    await temple.readyForEntry;
    /** Every drawn floor glyph centred on the eel, by its radius. */
    const glyphsOnEel = (): number[] => {
      const radii: number[] = [];
      scene.traverseVisible((o) => {
        if (o.type !== 'Group' || o.position.x !== eel.pos.x || o.position.z !== eel.pos.z) return;
        let drawn = 0;
        o.traverseVisible((m) => {
          if ((m as THREE.Mesh).isMesh) drawn++;
        });
        if (drawn > 0) radii.push(o.scale.x);
      });
      return radii;
    };
    for (let i = 0; i < 10; i++) temple.update(0.05);
    expect(glyphsOnEel()).toEqual([]);

    eel.castingAbility = TEMPLE_ARCING_SPARK;
    eel.castTotal = 2;
    eel.castRemaining = 1.6;
    for (let i = 0; i < 10; i++) temple.update(0.05);
    const radii = glyphsOnEel();
    expect(radii).toHaveLength(1);
    expect(radii[0]).toBeGreaterThan(TEMPLE_EEL_COIL_RADIUS);

    // The bar ends (landed or kicked): the glyph goes.
    eel.castingAbility = null;
    temple.update(0.05);
    expect(glyphsOnEel()).toEqual([]);
    temple.dispose();
  });

  it('draws every leap of a landed spark as a visible arc, in chain order, then goes dark', () => {
    const { fx, add, root } = painter();
    add({ id: 1, kind: 'player', templateId: 'player', pos: { x: 0, y: 0, z: 0 } });
    add({ id: 2, kind: 'player', templateId: 'player', pos: { x: 4, y: 0, z: 0 } });
    add({ id: 3, kind: 'player', templateId: 'player', pos: { x: 4, y: 0, z: 4 } });
    add({ id: 11, templateId: TEMPLE_TRASH_IDS.eel, pos: { x: 0, y: 0, z: 12 } });
    /** The leaps drawn this frame: each is a lit jagged ribbon (the arc) plus
     *  its fork, so two drawn ribbons per leap. */
    const arcs = (): number => {
      let n = 0;
      root.traverseVisible((o) => {
        const u = ((o as THREE.Mesh).material as THREE.ShaderMaterial | undefined)?.uniforms;
        if (!(o as THREE.Mesh).isMesh || !u?.uJag || (u.uJag.value as number) <= 0) return;
        if ((u.uAlpha.value as number) > 0 && (u.uWidth.value as number) > 0) n++;
      });
      return n / 2;
    };
    fx.update(0.05, 0.05);
    expect(arcs()).toBe(0);
    const leap = (sourceId: number, targetId: number) =>
      ({
        type: 'spellfx',
        sourceId,
        targetId,
        school: 'nature',
        fx: 'heavyBolt',
        ability: TEMPLE_ARCING_SPARK,
      }) as never;
    // The sim lands one chain on one tick: eel to the first, then leap on.
    expect(fx.handleEvent(leap(11, 1))).toBe(true);
    expect(fx.handleEvent(leap(1, 2))).toBe(true);
    expect(fx.handleEvent(leap(2, 3))).toBe(true);
    fx.update(0.02, 0.07);
    // Only the first leap has struck yet; the rest follow a stagger apart.
    expect(arcs()).toBe(1);
    for (let i = 0; i < 4; i++) fx.update(0.05, 0.12 + i * 0.05);
    expect(arcs()).toBe(3);
    expect(root.getObjectByName('drowned-temple-trash-fx')?.visible).toBe(true);
    for (let i = 0; i < 30; i++) fx.update(0.05, 0.4 + i * 0.05);
    expect(arcs()).toBe(0);
  });
});
