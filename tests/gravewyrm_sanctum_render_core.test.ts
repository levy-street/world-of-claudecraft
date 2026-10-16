// The Gravewyrm Sanctum renderer's pure cores (src/render/gravewyrm_sanctum):
// the Calving Face's frame shared with the kit and its swap seam (the frozen
// Korzul's head under the stage-4 hole, his heart behind the clear shell),
// the stage timelines, the story-step memory the face reads from the run's
// markers, the Smith's chains (high over every walkway, falling into the
// gulf), the kit placement plan (every prop fitted, nothing in the gulf
// within reach of a walkway, every placed piece shipped in the kit), and the
// shard's look per stage.

import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHAIN_FALL_ORDER,
  chainPath,
  chainSag,
  linksAlong,
  PILLAR_RING_HEIGHT,
  planChainRuns,
  tautPoint,
} from '../src/render/gravewyrm_sanctum/sanctum_chains_core';
import {
  CALVED_C,
  COLLAPSE_DROP,
  calvedR,
  chainFall,
  collapsePose,
  crackReveal,
  eyeOpen,
  FACE_BURST_AT,
  FACE_CHAIN_ENTRIES,
  FACE_EVENT_SECONDS,
  FACE_ORIGIN,
  FROZEN_WYRM,
  FROZEN_WYRM_URL,
  faceChainEntries,
  faceToGame,
  faceY,
  frozenWyrmShown,
  heartGlow,
  plateFallPose,
  WYRM_HEAD,
  WYRM_HEART,
  windowR,
} from '../src/render/gravewyrm_sanctum/sanctum_face_core';
import {
  nearWalkable,
  placementsForProp,
  planGulfScenery,
  planSanctumKitPlacements,
} from '../src/render/gravewyrm_sanctum/sanctum_kit_plan_core';
import {
  faceStageLook,
  heartbeat,
  planSanctumFires,
  SANCTUM_KEY_DIRECTION,
  sanctumFloorAt,
  sanctumGround,
} from '../src/render/gravewyrm_sanctum/sanctum_plan_core';
import {
  clearSanctumStoryForTest,
  observeSanctumStep,
  observeSanctumStoryMarker,
  sanctumSlotKey,
  sanctumStoryView,
} from '../src/render/gravewyrm_sanctum/sanctum_story_core';
import {
  GRAVEWYRM_SANCTUM_FIELD,
  LOCK_TERRACE,
  SEAL_PILLARS,
} from '../src/sim/content/gravewyrm_sanctum_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { sanctumStoryTemplate } from '../src/sim/encounters/gravewyrm_sanctum/ids';

const ROOT = path.resolve(__dirname, '..');

/** A game point back into the kit's face frame (x, depth, height). */
function gameToFace(x: number, y: number, z: number): [number, number, number] {
  return [FACE_ORIGIN.x - x, z - FACE_ORIGIN.z, y - FACE_ORIGIN.y];
}

describe('the Calving Face frame and the frozen Korzul (the swap seam)', () => {
  it('maps the kit frame with a half turn to face south over the lake', () => {
    const [x, y, z] = faceToGame(10, 4, 30);
    expect([x, y, z]).toEqual([FACE_ORIGIN.x - 10, 30, FACE_ORIGIN.z + 4]);
    // The face stands past the lake's shelf: nothing of its front reaches a
    // walkable floor (never covering an arena).
    for (let fx = -78; fx <= 78; fx += 6) {
      const [gx, , gz] = faceToGame(fx, faceY(fx, 1), 1);
      expect(sanctumFloorAt(gx, gz), `face foot at x ${fx}`).toBeNull();
    }
  });

  it('puts his head under the stage-4 calved hole and his heart behind the shell', () => {
    const [hx, , hz] = gameToFace(...WYRM_HEAD);
    expect(calvedR(hx, hz)).toBeLessThan(1);
    const [cx, cdepth, cz] = gameToFace(...WYRM_HEART);
    expect(windowR(cx, cz)).toBeLessThan(1);
    // Behind the shell's front, inside the hollow (the kit's hollow runs 2 to
    // 44 yd deep).
    expect(cdepth).toBeGreaterThan(2);
    expect(cdepth).toBeLessThan(44);
    expect(FROZEN_WYRM.scale).toBeGreaterThan(1);
    expect(FROZEN_WYRM_URL).toBe('/models/props/gravewyrm_sanctum_korzul_frozen.glb');
  });

  it('ships the frozen Korzul as a static meshopt + KTX2 GLB listed in the media manifest', () => {
    const file = path.join(ROOT, 'public', FROZEN_WYRM_URL);
    const buf = fs.readFileSync(file);
    expect(buf.length).toBeLessThan(4 * 1024 * 1024);
    const len = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + len).toString()) as {
      extensionsUsed: string[];
      images: { mimeType: string }[];
      nodes: { name: string; mesh?: number; skin?: number }[];
      skins?: unknown[];
    };
    expect(json.extensionsUsed).toContain('EXT_meshopt_compression');
    expect(json.images.every((i) => i.mimeType === 'image/ktx2')).toBe(true);
    expect(json.skins ?? []).toHaveLength(0);
    expect(json.nodes.map((n) => n.name)).toContain('KorzulFrozen');
    const manifest = fs.readFileSync(
      path.join(ROOT, 'src/render/assets/manifest.generated.ts'),
      'utf8',
    );
    expect(manifest).toContain('models/props/gravewyrm_sanctum_korzul_frozen.glb');
  });

  it('lands the chain entries on the face surface, high over the lake', () => {
    const entries = faceChainEntries();
    expect(entries).toHaveLength(FACE_CHAIN_ENTRIES.length);
    for (const [x, y, z] of entries) {
      expect(y).toBeGreaterThan(40);
      expect(z).toBeGreaterThan(FACE_ORIGIN.z - 30);
      expect(Math.abs(x)).toBeLessThan(80);
    }
  });
});

describe('the stage timelines', () => {
  it('reveals a crack monotonically and whole by its end', () => {
    let prev = -1;
    for (let t = 0; t <= FACE_EVENT_SECONDS.crackRace; t += 0.1) {
      const k = crackReveal(t);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
    expect(crackReveal(FACE_EVENT_SECONDS.crackRace)).toBe(1);
    expect(crackReveal(999)).toBe(1);
  });

  it('drops the stage-1 plate from the face into its rest pose in the lake', () => {
    const start = plateFallPose(0);
    expect(start.drop).toBeGreaterThan(10);
    expect(start.out).toBeLessThan(0);
    expect(start.landed).toBe(false);
    const end = plateFallPose(FACE_EVENT_SECONDS.plateFall);
    expect(end.drop).toBe(0);
    expect(end.pitch).toBe(-0);
    expect(end.out).toBe(-0);
    expect(end.landed).toBe(true);
  });

  it('tears a chain out and lets it fall slack (0 to 1, monotonic)', () => {
    expect(chainFall(0)).toBe(0);
    let prev = 0;
    for (let t = 0; t <= FACE_EVENT_SECONDS.chainFall; t += 0.2) {
      const k = chainFall(t);
      expect(k).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = k;
    }
    expect(chainFall(FACE_EVENT_SECONDS.chainFall)).toBeCloseTo(1, 6);
  });

  it('collapses the face into a ruin that stays (the Quench is never bared)', () => {
    expect(collapsePose(0).drop).toBeLessThan(1);
    const end = collapsePose(FACE_EVENT_SECONDS.collapse);
    expect(end.k).toBe(1);
    expect(end.drop).toBe(COLLAPSE_DROP);
    expect(collapsePose(FACE_EVENT_SECONDS.collapse * 5).drop).toBe(COLLAPSE_DROP);
  });

  it('lets the frozen wyrm go on the burst beat, the same moment the live body tears out', async () => {
    const bosses = await import('../src/render/gravewyrm_sanctum_bosses/boss_model_core');
    expect(FACE_BURST_AT).toBe(bosses.KORZUL_BURST_AT);
    expect(frozenWyrmShown(-1)).toBe(true);
    expect(frozenWyrmShown(0)).toBe(true);
    expect(frozenWyrmShown(FACE_BURST_AT - 0.01)).toBe(true);
    expect(frozenWyrmShown(FACE_BURST_AT)).toBe(false);
    // The face shudders in place until the burst, then breaks and falls.
    for (let t = 0; t < FACE_BURST_AT - 1e-6; t += 0.05)
      expect(Math.abs(collapsePose(t).drop)).toBeLessThanOrEqual(0.6);
    expect(collapsePose(FACE_BURST_AT + 1.5).drop).toBeGreaterThan(1);
    let prev = collapsePose(FACE_BURST_AT).drop;
    for (let t = FACE_BURST_AT; t <= FACE_EVENT_SECONDS.collapse; t += 0.05) {
      const d = collapsePose(t).drop;
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
  });

  it('opens his eye only once the face has calved', () => {
    expect(eyeOpen(3, 100)).toBe(0);
    expect(eyeOpen(4, 0)).toBe(0);
    expect(eyeOpen(4, 60)).toBe(1);
    expect(eyeOpen(5, 0)).toBe(1);
  });
});

describe("the shard's look per stage", () => {
  it('doubles the glow at stage 3 and brightens the aurora with the stages', () => {
    const looks = [0, 1, 2, 3, 4, 5].map(faceStageLook);
    for (let s = 1; s < looks.length; s++) {
      expect(looks[s].glow).toBeGreaterThanOrEqual(looks[s - 1].glow);
      expect(looks[s].aurora).toBeGreaterThanOrEqual(looks[s - 1].aurora);
    }
    expect(looks[3].glow).toBeGreaterThanOrEqual(looks[0].glow * 2);
  });

  it('beats inside 0..1 and flares when a stage rises', () => {
    for (let t = 0; t < 5; t += 0.05) {
      const b = heartbeat(t, 30);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
    expect(heartGlow(3, 10, 0)).toBeGreaterThan(heartGlow(3, 10, 30));
  });

  it('keys the cold dusk light from the west, above the horizon', () => {
    const [x, y] = SANCTUM_KEY_DIRECTION;
    expect(x).toBeLessThan(0);
    expect(y).toBeGreaterThan(0.3);
  });
});

describe('the story memory (the face reads the run markers)', () => {
  beforeEach(() => clearSanctumStoryForTest());

  it('snaps the first sight (a party arriving at a cracked face sees no replay)', () => {
    observeSanctumStep('k', 6, 100);
    const v = sanctumStoryView('k', 100);
    expect(v.stage).toBe(3);
    expect(v.chains).toBe(4);
    expect(v.since).toBeGreaterThan(100);
    expect(v.chainSince.every((s) => s > 100)).toBe(true);
  });

  it('times each rise and each chain from the moment it is seen', () => {
    observeSanctumStep('k', 0, 10);
    observeSanctumStep('k', 1, 20);
    expect(sanctumStoryView('k', 21).stageSince[1]).toBeCloseTo(1);
    observeSanctumStep('k', 3, 30);
    const v = sanctumStoryView('k', 32);
    expect(v.stage).toBe(2);
    expect(v.chains).toBe(2);
    expect(v.chainSince[0]).toBeCloseTo(2);
    expect(v.chainSince[1]).toBeCloseTo(2);
    expect(v.chainSince[2]).toBe(-1);
  });

  it('starts over on a lower step (a fresh claim in the slot, or a dev rewind)', () => {
    observeSanctumStep('k', 7, 10);
    observeSanctumStep('k', 0, 20);
    expect(sanctumStoryView('k', 21).stage).toBe(0);
  });

  it('reads a mirrored marker entity into its own slot and ignores anything else', () => {
    const def = DUNGEONS.gravewyrm_sanctum;
    const o = instanceOrigin(def.index, 1);
    const marker = {
      templateId: sanctumStoryTemplate(1),
      dungeonId: 'gravewyrm_sanctum',
      pos: { x: o.x + 8, z: o.z - 230 },
    };
    observeSanctumStoryMarker(marker, 5);
    observeSanctumStoryMarker({ ...marker, templateId: 'dungeon_gate_open' }, 5);
    expect(sanctumStoryView(sanctumSlotKey(o.x, o.z), 6).stage).toBe(1);
    expect(sanctumStoryView(sanctumSlotKey(o.x + 1000, o.z), 6).stage).toBe(0);
  });
});

describe("the Smith's chains", () => {
  const runs = planChainRuns();

  it('runs one chain from each seal pillar to its own face entry', () => {
    expect(runs).toHaveLength(SEAL_PILLARS.length);
    expect(new Set(runs.map((r) => r.crack)).size).toBe(4);
    for (const [i, r] of runs.entries()) {
      expect(r.ring[0]).toBeCloseTo(SEAL_PILLARS[i].x);
      expect(r.ring[1]).toBeCloseTo(LOCK_TERRACE.h + PILLAR_RING_HEIGHT);
    }
    expect([...CHAIN_FALL_ORDER].sort()).toEqual([0, 1, 2, 3]);
  });

  it('hangs taut far above every walkway along its whole span', () => {
    for (const r of runs) {
      const sag = chainSag(r);
      for (let u = 0.1; u <= 0.95; u += 0.01) {
        const [x, y, z] = tautPoint(r, u, sag);
        const floor = sanctumFloorAt(x, z);
        if (floor !== null)
          expect(y - floor, `${r.pillar} at u ${u.toFixed(2)}`).toBeGreaterThan(12);
      }
    }
  });

  it('falls slack into the gulf, links a pitch apart', () => {
    for (const r of runs) {
      const slack = chainPath(r, 1, 48);
      expect(slack[0]).toEqual(r.ring);
      expect(slack[slack.length - 1][1]).toBeLessThan(-60);
      const links = linksAlong(chainPath(r, 0, 48));
      expect(links.length).toBeGreaterThan(30);
      for (let i = 1; i < links.length; i++) expect(links[i].roll).not.toBe(links[i - 1].roll);
    }
  });
});

describe('the kit placement plan', () => {
  const plan = planSanctumKitPlacements();

  it('draws every gs_* prop (the seal pillars are the chains painter s)', () => {
    const drawnElsewhere = /^gs_seal_pillar_/;
    for (const [i, p] of GRAVEWYRM_SANCTUM_FIELD.props.entries()) {
      if (drawnElsewhere.test(p.kind)) continue;
      expect(placementsForProp(p, i).length, p.kind).toBeGreaterThan(0);
    }
  });

  it('fits the seracs to their colliders (radius) and their heights', () => {
    for (const p of GRAVEWYRM_SANCTUM_FIELD.props) {
      if (!p.kind.startsWith('gs_serac_')) continue;
      const [pl] = placementsForProp(p, 0);
      const size = { Kit_SeracS: [8.4, 9.6], Kit_SeracM: [13.9, 17.1], Kit_SeracL: [23.6, 29] }[
        pl.piece as 'Kit_SeracS'
      ];
      const halfFoot = (size[0] / 2) * pl.scale;
      expect(halfFoot).toBeGreaterThan((p.r ?? 0) * 1.0);
      expect(halfFoot).toBeLessThan((p.r ?? 0) * 1.6);
      expect(size[1] * pl.scale * (pl.scaleY ?? 1)).toBeCloseTo(p.h ?? 0, 0);
    }
  });

  it('keeps the gulf scenery out of reach of every walkway', () => {
    for (const p of planGulfScenery()) {
      if (p.piece.startsWith('Kit_IceFall')) continue;
      expect(nearWalkable(p.x, p.z, 4), `${p.piece} at ${p.x}, ${p.z}`).toBe(false);
      expect(p.y ?? sanctumGround(p.x, p.z)).toBeLessThan(0);
    }
  });

  it('places only pieces the shipped kit carries (the sastrugi patch is never placed)', () => {
    const glb = fs.readFileSync(path.join(ROOT, 'public/models/props/gravewyrm_sanctum_kit.glb'));
    const len = glb.readUInt32LE(12);
    const json = JSON.parse(glb.subarray(20, 20 + len).toString()) as { nodes: { name: string }[] };
    const shipped = new Set(json.nodes.map((n) => n.name));
    const pieces = new Set(plan.map((p) => p.piece));
    for (const piece of pieces) expect(shipped.has(piece), piece).toBe(true);
    expect(pieces.has('Kit_Sastrugi')).toBe(false);
  });

  it('keeps the first vista open: nothing tall stands between the landing and the court (lip modules hang below the floor)', () => {
    expect(plan.some((p) => p.piece === 'Kit_KeystoneSocket')).toBe(false);
    for (const p of plan) {
      const inCorridor = Math.abs(p.x) < 14 && p.z > -216 && p.z < -190;
      if (inCorridor)
        expect(p.piece, `${p.piece} at ${p.x}, ${p.z}`).not.toMatch(
          /Crag|GlacierWall|VaultWall|Socket|Serac|Tunnel/,
        );
    }
  });

  it('lights every fire prop once', () => {
    const fires = planSanctumFires();
    const props = GRAVEWYRM_SANCTUM_FIELD.props.filter((p) =>
      ['gs_cult_brazier', 'gs_soul_pyre', 'gs_soul_brazier', 'gs_thaw_pyre'].includes(p.kind),
    );
    expect(fires).toHaveLength(props.length);
  });

  it('keeps the calved hole round the kit frame centre it shares with the kit', () => {
    expect(calvedR(CALVED_C[0], CALVED_C[1])).toBe(0);
  });
});
