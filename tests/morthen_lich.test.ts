// Morthen the Gravecaller as the Lich Bishop (the art guide's model,
// scripts/assets/specs/woc_crypt_morthen.json): his own body and clips, the entrance
// casts played on his own rise, proclamation and ward, the Shadow Pulse on the staff,
// and the Last Rites stance (the crozier unfolding into the scythe) read off his
// mirrored health alone, so offline and online see the same beat.

import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { composedFarMeshes } from '../src/render/characters/assets';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { characterMeshCastsShadow } from '../src/render/characters/shadow_policy';
import {
  DISSOLVE_SEC,
  dissolveLevels,
  MORTHEN_DEATH_LIFT,
  MORTHEN_GROWTH,
  MORTHEN_HOVER,
  MORTHEN_MITRE_EYE,
  MORTHEN_REAP_SWEEP,
  MORTHEN_REST_MINZ,
  MORTHEN_RIBS,
  MORTHEN_RIG_Y,
  MORTHEN_SCYTHE_HELD,
  MORTHEN_SCYTHE_UNFOLD,
  MORTHEN_SINK,
  MORTHEN_SMOKE_BASE,
  MORTHEN_SOUL_COUNT,
  MORTHEN_SOUL_RADIUS,
  MORTHEN_STAFF_HELD,
  MORTHEN_STAFF_RESTORED_FRACTION,
  MORTHEN_TOLL,
  morthenAnchor,
  morthenBodyY,
  morthenDrawScale,
  morthenEmitY,
  morthenStance,
  morthenStanceGesture,
  SWING_CUT_START_SEC,
  scytheTrail,
  soulOrbit,
} from '../src/render/hollow_crypt/morthen_fx_core';
import { MOBS } from '../src/sim/data';
import {
  MORTHEN_DESCEND,
  MORTHEN_LAST_RITES_FRACTION,
  MORTHEN_PROCLAIM,
  MORTHEN_RISE,
} from '../src/sim/encounters/hollow_crypt/ids';
import { MORTHEN_REAP, MORTHEN_RITE } from '../src/sim/encounters/hollow_crypt/morthen_ids';
import type { Entity } from '../src/sim/types';

const PLAYER_HEIGHT = 2.6;
const GLB = 'public/models/creatures/woc_crypt_morthen.glb';

function glbJson(): {
  animations?: { name: string }[];
  meshes: { primitives: { indices: number }[] }[];
  accessors: { count: number }[];
} {
  const buf = readFileSync(GLB);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

const def = VISUALS[visualKeyFor({ kind: 'mob', templateId: 'morthen' } as Entity)];

async function readGlb() {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(GLB);
}

/** The angle (degrees) between two unit quaternions [x, y, z, w]. */
function quatAngleDeg(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

describe('Morthen, the Lich Bishop: his own body', () => {
  it("draws the art guide's lich, not a KayKit mage", () => {
    expect(visualKeyFor({ kind: 'mob', templateId: 'morthen' } as Entity)).toBe(
      'crypt_morthen_lich',
    );
    expect(def.url).toBe('models/creatures/woc_crypt_morthen.glb');
    expect(def.attach).toBeUndefined();
    expect(def.authoredAtlas).toBe(true);
  });

  it('stands as tall over the flags as the body he replaced, and floats', () => {
    const drawn = def.height * MOBS.morthen.scale;
    expect(drawn / PLAYER_HEIGHT).toBeGreaterThan(2.9);
    // Even with his smoke funnel sunk, what stands over the floor towers: the
    // old body's 7.85 yd, three players (Reuben 2026-10-11: a remade boss keeps
    // its height). The authored rig alone stood 6.88, so he is drawn grown.
    expect((def.height + (def.hover ?? 0)) * MOBS.morthen.scale).toBeCloseTo(7.85, 1);
    expect(def.height).toBeCloseTo(5.85 * MORTHEN_GROWTH, 9);
  });

  it('sinks his smoke funnel into the ring floor so his whole body reads from the camera', () => {
    // One constant drives the manifest's hover and every body anchor.
    expect(def.hover).toBeCloseTo(MORTHEN_HOVER * MORTHEN_GROWTH, 9);
    expect(MORTHEN_HOVER).toBeCloseTo(MORTHEN_REST_MINZ - MORTHEN_SINK, 9);
    expect(MORTHEN_RIG_Y).toBeCloseTo(-MORTHEN_SINK, 9);
    expect(MORTHEN_SINK).toBeGreaterThan(0.5);
    // Every body anchor rides his grown size.
    const s = morthenDrawScale(MOBS.morthen.scale);
    expect(s).toBeCloseTo(MOBS.morthen.scale * MORTHEN_GROWTH, 9);
    // The burning eye under the mitre sits under the old 7 yd for the default
    // camera, and well over a player's head.
    const eye = morthenBodyY(0, MORTHEN_MITRE_EYE.y, s);
    expect(eye).toBeLessThan(7);
    expect(eye).toBeGreaterThan(PLAYER_HEIGHT * 1.6);
    // He still floats: the lowest tatter of his robe (rig 1.23 half a second
    // into Idle) clears the flags, the smoke's last wisps under it (their tops
    // near 1.26), the ribs well above both.
    expect(morthenBodyY(0, 1.23, s)).toBeGreaterThan(0.3);
    expect(morthenBodyY(0, 1.26, s)).toBeGreaterThan(0.3);
    expect(morthenBodyY(0, MORTHEN_RIBS.y, s)).toBeGreaterThan(2.5);
    // The smoke base is under the floor now: its emitters boil out at the flags.
    expect(morthenBodyY(0, MORTHEN_SMOKE_BASE.y, s)).toBeLessThan(0);
    expect(morthenEmitY(morthenBodyY(0, MORTHEN_SMOKE_BASE.y, s), 0, s)).toBeGreaterThan(0);
    expect(morthenEmitY(3, 0, s)).toBe(3);
    // His corpse is lifted by the very sink, so the folded vestments rest on the floor.
    expect(def.deathLift).toEqual(MORTHEN_DEATH_LIFT);
    expect(MORTHEN_DEATH_LIFT.yards).toBeCloseTo(MORTHEN_SINK * MORTHEN_GROWTH, 9);
    expect(MORTHEN_DEATH_LIFT.to).toBeGreaterThan(MORTHEN_DEATH_LIFT.from);
  });

  it('sheds his sparks off the mitre eye, not the retired shoulder candles', () => {
    // The art guide's body has no shoulder candles: the sparks rise off the
    // green eye on the mitre's front plate, on his centre line, above the
    // skull's eye sockets (about 4.95) and the ribs, below the mitre's spikes.
    expect(MORTHEN_MITRE_EYE.x).toBe(0);
    expect(MORTHEN_MITRE_EYE.y).toBeGreaterThan(4.95);
    expect(MORTHEN_MITRE_EYE.y).toBeGreaterThan(MORTHEN_RIBS.y);
    expect(MORTHEN_MITRE_EYE.y).toBeLessThan(def.height);
    expect(MORTHEN_MITRE_EYE.z).toBeGreaterThan(0);
  });

  it('ships every clip of both stances, each his own', () => {
    const names = new Set((glbJson().animations ?? []).map((a) => a.name));
    for (const clip of [
      'Idle',
      'Walk',
      'Run',
      'Rise',
      'SummonSouls',
      'ShieldRitual',
      'BellToll',
      'StaffStrike',
      'StaffStrike2',
      'Hit',
      'Death',
      'Transform',
      'ScytheIdle',
      'ScytheWalk',
      'ScytheRun',
      'ScytheSweep',
      'ScytheSweep2',
      'ScytheToll',
      'ScytheSummon',
      'ScytheHit',
      'ScytheDeath',
    ])
      expect(names.has(clip), clip).toBe(true);
  });

  it('stays inside the boss triangle budget', () => {
    const j = glbJson();
    let tris = 0;
    for (const m of j.meshes)
      for (const p of m.primitives) tris += j.accessors[p.indices].count / 3;
    // a Tripo Smart Mesh body (about 10k faces) plus the scythe blade and the smoke
    expect(tris).toBeGreaterThan(8_000);
    expect(tris).toBeLessThan(55_000);
    expect(readFileSync(GLB).length).toBeLessThan(3_500_000);
  });
});

describe('Morthen, the Lich Bishop: the staff stays in his fist', () => {
  // The staff is modelled IN the right fist and parented to it, so every swing is
  // carried by the arm and the body. A staff bone turning against hand.r is the
  // propeller the owner saw: the weapon spinning round the grip while the arm
  // barely moved. Every key of every clip must hold the rest turn.
  it('never turns the staff against the hand, in any clip', async () => {
    const doc = await readGlb();
    const staff = doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === 'staff');
    expect(staff, 'staff node').toBeDefined();
    expect(staff?.getParentNode()?.getName()).toBe('hand.r');
    const rest = staff?.getRotation() ?? [0, 0, 0, 1];
    const clips = doc.getRoot().listAnimations();
    expect(clips.length).toBeGreaterThanOrEqual(21);
    let checked = 0;
    for (const clip of clips) {
      for (const ch of clip.listChannels()) {
        if (ch.getTargetNode() !== staff || ch.getTargetPath() !== 'rotation') continue;
        const out = ch.getSampler()?.getOutput()?.getArray();
        if (!out) continue;
        for (let i = 0; i + 3 < out.length; i += 4) {
          const q = [out[i], out[i + 1], out[i + 2], out[i + 3]];
          const len = Math.hypot(q[0], q[1], q[2], q[3]);
          const unit = q.map((v) => v / len);
          expect(quatAngleDeg(unit, rest), `${clip.getName()} key ${i / 4}`).toBeLessThan(3);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('draws the soul smoke under the robes as a translucent material', async () => {
    const doc = await readGlb();
    const smoke = doc
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === 'CreatureSmoke');
    expect(smoke?.getAlphaMode()).toBe('BLEND');
  });

  // The smoke is vertex-alpha translucency: a depth shadow or the frozen far-LOD
  // bake (which keeps no vertex colour) would draw it as a solid dark shell, so it
  // ships as its own mesh that opts out of both through its node extras.
  it('ships the smoke as its own mesh that casts no shadow and skips the far bake', async () => {
    const doc = await readGlb();
    const node = doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === 'MorthenSmoke');
    expect(node?.getExtras()).toMatchObject({ shadowCaster: false, farBake: false });
    const prims = node?.getMesh()?.listPrimitives() ?? [];
    expect(prims.map((p) => p.getMaterial()?.getName())).toEqual(['CreatureSmoke']);
    const body = doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === 'MorthenLich');
    const bodyMats = (body?.getMesh()?.listPrimitives() ?? []).map((p) =>
      p.getMaterial()?.getName(),
    );
    expect(bodyMats).not.toContain('CreatureSmoke');
  });

  it('honours those extras in the character pipeline', () => {
    const root = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
    body.name = 'MorthenLich';
    const smoke = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
    smoke.name = 'MorthenSmoke';
    smoke.userData = { shadowCaster: false, farBake: false };
    root.add(body, smoke);
    expect(composedFarMeshes(root).map((m) => m.name)).toEqual(['MorthenLich']);
    expect(characterMeshCastsShadow(body)).toBe(true);
    expect(characterMeshCastsShadow(smoke)).toBe(false);
  });
});

describe('Morthen, the Lich Bishop: the souls circling him', () => {
  it('flies every soul round him, evenly spaced, about his ribs', () => {
    const at = Array.from({ length: MORTHEN_SOUL_COUNT }, (_, k) => soulOrbit(k, 0, false, false));
    const angles = at.map((p) => Math.atan2(p.z, p.x)).sort((a, b) => a - b);
    for (let i = 1; i < angles.length; i++)
      expect(angles[i] - angles[i - 1]).toBeCloseTo((Math.PI * 2) / MORTHEN_SOUL_COUNT, 6);
    for (let t = 0; t < 20; t += 0.37) {
      for (let k = 0; k < MORTHEN_SOUL_COUNT; k++) {
        const p = soulOrbit(k, t, false, false);
        const r = Math.hypot(p.x, p.z);
        expect(r).toBeGreaterThan(MORTHEN_SOUL_RADIUS * 0.85);
        expect(r).toBeLessThan(MORTHEN_SOUL_RADIUS * 1.15);
        // his ribs are at 4.15
        expect(p.y).toBeGreaterThan(3.2);
        expect(p.y).toBeLessThan(4.8);
        // drawn over the ring floor even with his funnel sunk into it
        expect(morthenBodyY(0, p.y, morthenDrawScale(MOBS.morthen.scale))).toBeGreaterThan(1);
      }
    }
  });

  it('draws them wider and higher while he casts, and hurries them', () => {
    const rest = soulOrbit(0, 3, false, false);
    const cast = soulOrbit(0, 3, true, false);
    expect(Math.hypot(cast.x, cast.z)).toBeGreaterThan(Math.hypot(rest.x, rest.z) * 1.2);
    expect(cast.y).toBeGreaterThan(rest.y);
    // over the same second a hurried soul sweeps a longer arc
    const arc = (casting: boolean, rites: boolean) => {
      const a = soulOrbit(2, 1, casting, rites);
      const b = soulOrbit(2, 1.1, casting, rites);
      return Math.abs(Math.atan2(b.z, b.x) - Math.atan2(a.z, a.x));
    };
    expect(arc(true, false)).toBeGreaterThan(arc(false, false));
    expect(arc(false, true)).toBeGreaterThan(arc(false, false));
  });
});

describe('Morthen, the Lich Bishop: clips mapped to his casts', () => {
  it('plays his entrance on his own rise, proclamation and ward', () => {
    expect(def.clips.castByAbility?.[MORTHEN_RISE]).toBe('Rise');
    expect(def.clips.castByAbility?.[MORTHEN_PROCLAIM]).toBe('SummonSouls');
    expect(def.clips.castByAbility?.[MORTHEN_DESCEND]).toBe('ShieldRitual');
    expect(def.clips.castTimeScaleByAbility?.[MORTHEN_RISE]).toBe(1);
  });

  it('holds his ward through the Rite, and winds up and sweeps the Reap with the scythe', () => {
    expect(def.clips.castByAbility?.[MORTHEN_RITE]).toBe('ShieldRitual');
    const scythe = def.phaseClips?.[MORTHEN_SCYTHE_HELD]?.clips;
    expect(scythe?.castByAbility?.[MORTHEN_REAP]).toBe('ScytheSummon');
    expect(scythe?.attackByAbility?.[MORTHEN_REAP_SWEEP]).toBe('ScytheSweep');
    expect(scythe?.attackTimeScaleByAbility?.[MORTHEN_REAP_SWEEP]).toBeGreaterThan(1);
    const names = new Set((glbJson().animations ?? []).map((a) => a.name));
    for (const clip of ['ShieldRitual', 'ScytheSummon', 'ScytheSweep'])
      expect(names.has(clip)).toBe(true);
  });

  it('strikes with the bell staff and tolls it for the Shadow Pulse', () => {
    expect(def.clips.attack).toEqual(['StaffStrike', 'StaffStrike2']);
    expect(def.clips.attackByAbility?.[MORTHEN_TOLL]).toBe('BellToll');
    expect(def.clips.idle).toBe('Idle');
  });

  it('unfolds the scythe once, then reaps with it', () => {
    const unfold = def.phaseClips?.[MORTHEN_SCYTHE_UNFOLD];
    const held = def.phaseClips?.[MORTHEN_SCYTHE_HELD];
    const staff = def.phaseClips?.[MORTHEN_STAFF_HELD];
    expect(unfold?.enter).toBe('Transform');
    expect(held?.enter).toBeUndefined();
    expect(staff?.enter).toBeUndefined();
    // The held and unfolding gestures swap to the very same vocabulary, and the
    // staff gesture back to the one he spawns with (the swap is an identity check).
    expect(held?.clips).toBe(unfold?.clips);
    expect(staff?.clips).toBe(def.clips);
    expect(unfold?.clips.attack).toEqual(['ScytheSweep', 'ScytheSweep2']);
    expect(unfold?.clips.idle).toBe('ScytheIdle');
    expect(unfold?.clips.death).toBe('ScytheDeath');
    expect(unfold?.clips.attackByAbility?.[MORTHEN_TOLL]).toBe('ScytheToll');
  });
});

describe('Morthen, the Lich Bishop: the Last Rites stance', () => {
  it('keys on the design line (hollow_crypt.md 5.4: phase 3 at 35 percent)', () => {
    expect(MORTHEN_LAST_RITES_FRACTION).toBe(0.35);
    expect(morthenStance(null, 1)).toBe('staff');
    expect(morthenStance('staff', 0.36)).toBe('staff');
    expect(morthenStance('staff', 0.35)).toBe('scythe');
    expect(morthenStance(null, 0.2)).toBe('scythe');
  });

  it('never flips back on a heal inside the phase, only when he is whole again', () => {
    expect(morthenStance('scythe', 0.5)).toBe('scythe');
    expect(morthenStance('scythe', MORTHEN_STAFF_RESTORED_FRACTION - 0.01)).toBe('scythe');
    expect(morthenStance('scythe', MORTHEN_STAFF_RESTORED_FRACTION)).toBe('staff');
    expect(morthenStance('scythe', Number.NaN)).toBe('scythe');
  });

  it('plays the unfolding only on a live staff-to-scythe edge', () => {
    expect(morthenStanceGesture('staff', 'scythe')).toBe(MORTHEN_SCYTHE_UNFOLD);
    // a late joiner (first sight) and the periodic refresh swap silently
    expect(morthenStanceGesture(null, 'scythe')).toBe(MORTHEN_SCYTHE_HELD);
    expect(morthenStanceGesture('scythe', 'scythe')).toBe(MORTHEN_SCYTHE_HELD);
    expect(morthenStanceGesture('scythe', 'staff')).toBe(MORTHEN_STAFF_HELD);
    expect(morthenStanceGesture(null, 'staff')).toBe(MORTHEN_STAFF_HELD);
  });
});

describe('Morthen, the Lich Bishop: effect plan', () => {
  it('turns body anchors with his facing', () => {
    const at = { x: 0, y: 3, z: 1 };
    const north = morthenAnchor({ x: 10, y: 2, z: 5 }, 0, 1, at);
    expect(north.x).toBe(10);
    expect(north.z).toBe(6);
    // Rig-frame heights ride the sink onto his pivot.
    expect(north.y).toBeCloseTo(2 + 3 + MORTHEN_RIG_Y, 9);
    const east = morthenAnchor({ x: 0, y: 0, z: 0 }, Math.PI / 2, 2, at);
    expect(east.x).toBeCloseTo(2);
    expect(east.z).toBeCloseTo(0);
    expect(east.y).toBeCloseTo((3 + MORTHEN_RIG_Y) * 2);
    expect(morthenBodyY(1, 3, 2)).toBeCloseTo(east.y + 1, 9);
  });

  it('cuts a swing trail forward along the arc, then fades it', () => {
    expect(scytheTrail(0)).toBeNull();
    let lastHead = -1;
    for (let t = SWING_CUT_START_SEC; t < SWING_CUT_START_SEC + 0.28; t += 0.02) {
      const p = scytheTrail(t);
      expect(p).not.toBeNull();
      expect(p?.head ?? 0).toBeGreaterThanOrEqual(lastHead);
      expect(p?.tail ?? 1).toBeLessThanOrEqual(p?.head ?? 0);
      lastHead = p?.head ?? 0;
    }
    expect(scytheTrail(SWING_CUT_START_SEC + 2)).toBeNull();
  });

  it('dissolves into smoke, lets the souls go, and ends', () => {
    expect(dissolveLevels(0).flash).toBe(1);
    expect(dissolveLevels(0.5).smoke).toBeGreaterThan(0.8);
    expect(dissolveLevels(1).souls).toBeGreaterThan(0.5);
    expect(dissolveLevels(DISSOLVE_SEC + 0.1)).toEqual({ smoke: 0, souls: 0, flash: 0 });
  });
});
