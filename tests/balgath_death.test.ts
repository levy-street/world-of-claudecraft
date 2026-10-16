// Balgath's death: the authored topple, the eye going out, the landing and the sink.
//
// The defect this pins: he used to die STANDING and then blink out of existence. Root cause:
// the rig's own retargeted `Death` preset never leaves the idle stance (its hips move about a
// centimetre), and it was the clip the ClipMap named, so the clamped "corpse" pose was a
// standing boss; then an emptied corpse collapsed four seconds after it was looted, which
// read as a vanish. Now: an authored Balgath_Death that lands flat on his back and holds,
// an eye that gutters out, a landing with dust, rock chips and a camera jolt, and a corpse
// that lies for the whole window and then sinks into the fen before the scheduler drops it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120_000 });

import { bossAuraPlan, readBossVfxState } from '../src/render/balgath_aura_core';
import {
  BALGATH_DEATH_FALL_REACH,
  BALGATH_DEATH_IMPACT_SEC,
  BALGATH_SINK_DUST_INTERVAL,
  BALGATH_VISUAL_HEIGHT,
  BalgathDeathTracker,
  type DeathFxCue,
  deathLandingSpot,
} from '../src/render/balgath_death_fx_core';
import { EyeGlow, selfLitMeshes } from '../src/render/characters/eye_glow';
import {
  EYE_GLOW_DEATH_FLICKER_SEC,
  EYE_GLOW_DEATH_OUT_SEC,
  eyeGlowDeathIntensity,
} from '../src/render/characters/eye_glow_core';
import { MOBS } from '../src/sim/data';
import { pruneCorpseLoot } from '../src/sim/loot/loot_roll';
import { corpseKeepsBody, corpseSinkDepth } from '../src/sim/mob/boss_corpse_sink';
import { respawnMob } from '../src/sim/mob/lifecycle';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';
import { WORLD_BOSS_CORPSE_SECONDS } from '../src/sim/world_boss';
import { loadRigPoser, type PosedSkeleton } from './helpers/gltf_pose';

const ROOT = resolve(__dirname, '..');
const RIG = resolve(ROOT, 'public/models/creatures/balgath_cyclops.glb');
const MANIFEST = resolve(ROOT, 'src/render/characters/manifest.ts');
const BALGATH = 'balgath_cyclops';
/** Standing height of the Blender rig in its own units (the build's idle measurement). */
const RIG_HEIGHT = 13.96;

function manifestBlock(start: string, end: string): string {
  const src = readFileSync(MANIFEST, 'utf8');
  const at = src.indexOf(start);
  expect(at, `${start} is missing`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf(end, at));
}

describe('the death clip', () => {
  it('is mapped, played at its authored speed, and the visual height is the core unit', () => {
    const map = manifestBlock('const BALGATH: ClipMap = {', '\n};').replace(/\/\/.*$/gm, '');
    expect(map).toContain("death: 'Balgath_Death'");
    expect(map).not.toContain("'Death'");
    const def = manifestBlock('mob_balgath_cyclops: {', '\n  },');
    expect(def).toMatch(/deathTimeScale: 1,/);
    // The core's height unit IS the visual's height.
    expect(def).toContain(`height: ${BALGATH_VISUAL_HEIGHT},`);
  });

  it("lands his back on the renderer's impact beat, then lies still", async () => {
    // Read off the shipped clip (forward kinematics), not off a build-script constant: the
    // head has done most of its fall by BALGATH_DEATH_IMPACT_SEC (the back is on the fen)
    // and was still well up a beat before it (still toppling).
    const poser = await loadRigPoser(RIG, RIG);
    const end = poser.duration('Balgath_Death');
    expect(end).toBeGreaterThan(BALGATH_DEATH_IMPACT_SEC + 0.8);
    const head = (t: number) => poser.pose('Balgath_Death', t).at('Head')[1];
    const drop = head(0) - head(end);
    expect(drop, 'the head never comes down').toBeGreaterThan(RIG_HEIGHT * 0.3);
    expect((head(0) - head(BALGATH_DEATH_IMPACT_SEC)) / drop).toBeGreaterThan(0.75);
    expect((head(0) - head(BALGATH_DEATH_IMPACT_SEC - 0.6)) / drop).toBeLessThan(0.6);
  });

  it('ends lying on his back behind his feet, where the dust lands', async () => {
    const poser = await loadRigPoser(RIG, RIG);
    const stand = poser.pose('Idle', 0.5);
    const rise = (p: PosedSkeleton) => p.at('Head')[1] - p.at('Hips')[1];
    // Head down near the level of the hips (lying), and BEHIND the feet (the rig faces +Z,
    // so backward is -Z).
    const end = poser.duration('Balgath_Death');
    const dead = poser.pose('Balgath_Death', end);
    expect(Math.abs(rise(dead))).toBeLessThan(rise(stand) * 0.35);
    const feetZ = (dead.at('L_Foot')[2] + dead.at('R_Foot')[2]) / 2;
    expect(dead.at('Head')[2]).toBeLessThan(feetZ - rise(stand));
    // The landing spot the core throws its dust at: the middle of his back, as a fraction
    // of his standing height behind where he stood.
    const back = -(dead.at('Hips')[2] + dead.at('Head')[2]) / 2 / RIG_HEIGHT;
    expect(Math.abs(back - BALGATH_DEATH_FALL_REACH)).toBeLessThan(0.08);
    // Held, not still moving: the last half second is the settled corpse pose.
    const settle = poser.pose('Balgath_Death', end - 0.5);
    for (const bone of ['Head', 'Hips', 'L_Hand', 'R_Hand', 'L_Foot', 'R_Foot']) {
      const a = dead.at(bone);
      const b = settle.at(bone);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), bone).toBeLessThan(
        RIG_HEIGHT * 0.03,
      );
    }
    // Before the impact beat he is still falling (head clearly above the hips).
    const falling = poser.pose('Balgath_Death', BALGATH_DEATH_IMPACT_SEC - 0.4);
    expect(rise(falling)).toBeGreaterThan(Math.abs(rise(dead)));
  });
});

describe('the eye goes out', () => {
  it('gutters, then fades to dark and stays dark', () => {
    const samples: number[] = [];
    for (let t = 0; t < EYE_GLOW_DEATH_FLICKER_SEC; t += 0.02)
      samples.push(eyeGlowDeathIntensity(t));
    // A flicker, not a ramp: it goes back UP at least a few times.
    let rises = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i] > samples[i - 1] + 0.05) rises++;
    expect(rises).toBeGreaterThan(3);
    expect(Math.max(...samples)).toBeGreaterThan(0.5);
    expect(eyeGlowDeathIntensity(EYE_GLOW_DEATH_OUT_SEC)).toBe(0);
    expect(eyeGlowDeathIntensity(60)).toBe(0);
    expect(eyeGlowDeathIntensity(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('reduced motion fades it evenly with no stutter', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let t = 0; t <= EYE_GLOW_DEATH_OUT_SEC + 0.1; t += 0.05) {
      const k = eyeGlowDeathIntensity(t, true);
      expect(k).toBeLessThanOrEqual(prev);
      prev = k;
    }
    expect(prev).toBe(0);
  });

  it('turns the eye meshes off on a corpse, snuffs a corpse seen already dead, relights on revive', () => {
    const spec = {
      bone: 'Head',
      offset: [0, 0, 0] as [number, number, number],
      color: 0x5fe8d2,
      radius: 0.02,
      pulseHz: 0.45,
    };
    const bone = new THREE.Object3D();
    const eye = new EyeGlow(spec, bone);
    const meshes = bone.children as THREE.Mesh[];
    expect(meshes).toHaveLength(2);
    eye.update(0.05, false, false, false);
    expect(meshes.every((m) => m.visible)).toBe(true);
    for (let t = 0; t < EYE_GLOW_DEATH_OUT_SEC + 0.2; t += 0.05)
      eye.update(0.05, false, false, true);
    expect(meshes.some((m) => m.visible)).toBe(false);
    eye.update(0.05, false, false, false);
    expect(meshes.every((m) => m.visible)).toBe(true);
    eye.snuff();
    expect(meshes.some((m) => m.visible)).toBe(false);
    eye.update(0.05, false, false, true);
    expect(meshes.some((m) => m.visible)).toBe(false);
    eye.dispose();
  });

  it("puts out the rig's own lit iris with the halo, and relights it on revive", () => {
    // The Blender body's iris is real geometry on its own glow material; dimming only the
    // shells left it burning on the corpse. EyeGlow hides those meshes on the same curve.
    const spec = {
      bone: 'Head',
      offset: [0, 0, 0] as [number, number, number],
      color: 0x5fe8d2,
      radius: 0.2,
      pulseHz: 0.45,
      selfLitMaterial: 'BalgathGlow',
    };
    const model = new THREE.Group();
    const bone = new THREE.Object3D();
    model.add(bone);
    const iris = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ name: 'BalgathGlow' }),
    );
    const body = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ name: 'BalgathBody' }),
    );
    model.add(iris, body);
    const lit = selfLitMeshes(model, spec.selfLitMaterial);
    expect(lit).toEqual([iris]);
    const eye = new EyeGlow(spec, bone, lit);
    eye.update(0.05, false, false, false);
    expect(iris.visible).toBe(true);
    // Guttering: it drops out and back at least once before it stays out.
    let flickers = 0;
    let was = true;
    for (let t = 0; t < EYE_GLOW_DEATH_OUT_SEC + 0.2; t += 0.02) {
      eye.update(0.02, false, false, true);
      if (iris.visible !== was) flickers++;
      was = iris.visible;
    }
    expect(flickers).toBeGreaterThan(2);
    expect(iris.visible).toBe(false);
    expect(body.visible, 'the body is never the eye').toBe(true);
    eye.update(0.05, false, false, false);
    expect(iris.visible).toBe(true);
    eye.snuff();
    expect(iris.visible).toBe(false);
    eye.dispose();
  });

  it('stops feeding his aura the moment he dies', () => {
    const alive = bossAuraPlan(readBossVfxState({ warpathPhase: 'wreck', hp: 1, maxHp: 10 }));
    expect(alive.moteRate).toBeGreaterThan(0);
    const dead = bossAuraPlan(
      readBossVfxState({ warpathPhase: 'wreck', hp: 0, maxHp: 10, dead: true }),
    );
    expect(dead.moteRate).toBe(0);
    expect(dead.alpha).toBe(0);
  });
});

describe('the landing and the sink (render core)', () => {
  const body = (over: Partial<{ dead: boolean; y: number; facing: number }> = {}) => ({
    id: 7,
    dead: over.dead ?? false,
    pos: { x: 100, y: over.y ?? 5, z: 200 },
    facing: over.facing ?? 0,
    scale: 4.2,
  });

  function step(tr: BalgathDeathTracker, b: ReturnType<typeof body>, dt = 0.05): DeathFxCue[] {
    const out: DeathFxCue[] = [];
    tr.begin(dt);
    tr.note(b, out);
    tr.end();
    return out;
  }

  it('lands once, exactly at the impact beat, behind him', () => {
    const tr = new BalgathDeathTracker();
    step(tr, body());
    let t = 0;
    let first: DeathFxCue | null = null;
    let at = -1;
    const all: DeathFxCue[] = [];
    for (let i = 0; i < 100; i++) {
      const cues = step(tr, body({ dead: true, facing: Math.PI / 2 }));
      if (i > 0) t += 0.05;
      all.push(...cues);
      if (!first && cues.length) {
        first = cues[0];
        at = t;
      }
    }
    expect(all.filter((c) => c.kind === 'impact')).toHaveLength(1);
    expect(first?.kind).toBe('impact');
    expect(at).toBeGreaterThanOrEqual(BALGATH_DEATH_IMPACT_SEC - 1e-9);
    expect(at).toBeLessThan(BALGATH_DEATH_IMPACT_SEC + 0.051);
    // Facing +X (pi/2), so he falls toward -X.
    expect(first?.x).toBeLessThan(100 - 3);
    expect(first?.z).toBeCloseTo(200, 5);
    expect(first?.x).toBeCloseTo(deathLandingSpot({ x: 100, z: 200 }, Math.PI / 2, 4.2).x, 5);
  });

  it('never replays a landing for a corpse first seen already dead', () => {
    const tr = new BalgathDeathTracker();
    const cues: DeathFxCue[] = [];
    for (let i = 0; i < 80; i++) cues.push(...step(tr, body({ dead: true })));
    expect(cues).toEqual([]);
  });

  it('throws dust while the corpse sinks, and forgets bodies that are gone', () => {
    const tr = new BalgathDeathTracker();
    step(tr, body({ dead: true, y: 5 }));
    expect(step(tr, body({ dead: true, y: 5 }))).toEqual([]);
    const start = step(tr, body({ dead: true, y: 4.8 }));
    expect(start.map((c) => c.kind)).toEqual(['sinkStart']);
    const puffs: DeathFxCue[] = [];
    for (let i = 0; i < 40; i++) puffs.push(...step(tr, body({ dead: true, y: 4 - i * 0.2 })));
    const expected = Math.floor((40 * 0.05) / BALGATH_SINK_DUST_INTERVAL);
    expect(puffs.filter((c) => c.kind === 'sinkDust').length).toBeGreaterThanOrEqual(expected - 1);
    expect(tr.size()).toBe(1);
    tr.begin(0.05);
    tr.end();
    expect(tr.size()).toBe(0);
  });
});

describe('the corpse lies for its whole window, then sinks (sim)', () => {
  function killed(templateId: string): { sim: Sim; ctx: SimContext; boss: Entity } {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: true });
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(templateId, 147, 310);
    const boss = sim.entities.get(id) as Entity;
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    ctx.handleDeath(boss, sim.player);
    return { sim, ctx, boss };
  }

  it('declares the sink on Balgath only', () => {
    expect(MOBS[BALGATH]?.corpseSink).toBeDefined();
    expect(corpseKeepsBody(MOBS[BALGATH])).toBe(true);
    expect(corpseKeepsBody(MOBS.thunzharr_waking_peak)).toBe(false);
  });

  it('keeps an emptied Balgath corpse for the rest of its window', () => {
    const { ctx, boss } = killed(BALGATH);
    expect(boss.dead).toBe(true);
    expect(boss.corpseTimer).toBe(WORLD_BOSS_CORPSE_SECONDS);
    boss.loot = { copper: 0, items: [] } as unknown as Entity['loot'];
    pruneCorpseLoot(ctx, boss);
    expect(boss.corpseTimer).toBe(WORLD_BOSS_CORPSE_SECONDS);
    expect(boss.lootable).toBe(false);
    // ...where a world boss without the sink still takes the fast arm.
    const other = killed('thunzharr_waking_peak');
    other.boss.loot = { copper: 0, items: [] } as unknown as Entity['loot'];
    pruneCorpseLoot(other.ctx, other.boss);
    expect(other.boss.corpseTimer).toBeLessThanOrEqual(4);
  });

  it('holds its height until the last seconds, then sinks the full depth by the end', () => {
    const def = MOBS[BALGATH]?.corpseSink;
    if (!def) throw new Error('no corpseSink');
    const { sim, boss } = killed(BALGATH);
    const lay = boss.pos.y;
    boss.corpseTimer = def.seconds + 1;
    for (let i = 0; i < 20; i++) sim.tick();
    expect(boss.pos.y).toBeCloseTo(lay, 6);
    for (let i = 0; i < 20 * (def.seconds / 2); i++) sim.tick();
    expect(boss.pos.y).toBeLessThan(lay - 0.1);
    expect(boss.pos.y).toBeGreaterThan(lay - def.depth);
    while (boss.corpseTimer > 0) sim.tick();
    expect(boss.pos.y).toBeCloseTo(lay - def.depth, 5);
    expect(corpseSinkDepth(def, 0)).toBe(def.depth);
    expect(corpseSinkDepth(def, def.seconds)).toBe(0);
  });
});

describe('corpse sink edge cases', () => {
  it('never pops back up when the window is extended mid-sink, and forgets the bed on respawn', () => {
    const def = MOBS[BALGATH]?.corpseSink;
    if (!def) throw new Error('no corpseSink');
    const sim = new Sim({ seed: 4, playerClass: 'warrior', autoEquip: true });
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(BALGATH, 147, 310);
    const boss = sim.entities.get(id) as Entity;
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    ctx.handleDeath(boss, sim.player);
    const lay = boss.pos.y;
    boss.corpseTimer = def.seconds / 2;
    for (let i = 0; i < 10; i++) sim.tick();
    const sunk = boss.pos.y;
    expect(sunk).toBeLessThan(lay - 0.1);
    // A loot roll lengthens the window: he stays exactly as deep as he got.
    boss.corpseTimer = 60;
    for (let i = 0; i < 10; i++) sim.tick();
    expect(boss.pos.y).toBe(sunk);
    expect(boss.corpseSinkBaseY).toBe(lay);
    respawnMob(ctx, boss);
    expect(boss.corpseSinkBaseY).toBeUndefined();
  });
});
