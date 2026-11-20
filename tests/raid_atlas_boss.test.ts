// The raid atlas's boss pins (src/ui/hud/raid_atlas/raid_atlas_boss_core.ts):
// the faces each medallion carries, the committed busts, the tooltip model,
// the hit test through the live camera, and the card's placement.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
} from '../src/sim/content/smith_heart';
import {
  RAID_ATLAS_PARTNER,
  raidAtlasBossAt,
  raidAtlasBossFaces,
  raidAtlasBossTooltip,
  raidAtlasPortraitUrl,
  raidAtlasShownState,
  raidAtlasTooltipPlacement,
} from '../src/ui/hud/raid_atlas/raid_atlas_boss_core';
import {
  pageSpan,
  pageToScreen,
  RaidAtlasCamera,
  toPage,
} from '../src/ui/hud/raid_atlas/raid_atlas_camera_core';
import { raidAtlasBossRadius } from '../src/ui/hud/raid_atlas/raid_atlas_painter';
import { raidAtlasFloor, raidAtlasPlanFor } from '../src/ui/hud/raid_atlas/raid_atlas_plan_core';
import type {
  RaidAtlasBossMark,
  RaidAtlasBossState,
} from '../src/ui/hud/raid_atlas/raid_atlas_view';
import { t } from '../src/ui/i18n';

const maybePlan = raidAtlasPlanFor(SMITH_HEART_DUNGEON);
if (!maybePlan) throw new Error("the Smith's Heart has an atlas plan");
const plan = maybePlan;

function marks(state: RaidAtlasBossState = 'alive'): RaidAtlasBossMark[] {
  return plan.bosses.map((boss) => ({ boss, state }));
}

function markOf(id: string): RaidAtlasBossMark {
  const mark = marks().find((m) => m.boss.id === id);
  if (!mark) throw new Error(`no boss ${id}`);
  return mark;
}

function bossOf(id: string) {
  return markOf(id).boss;
}

const SIDE = 560;

/** The controller's projection: instance yards to canvas px through a camera. */
function projector(camera: RaidAtlasCamera, floorId: 'veins' | 'heart') {
  const floor = raidAtlasFloor(plan, floorId);
  const span = pageSpan(floor.bounds);
  return (x: number, z: number) => {
    const p = toPage(floor.bounds, x, z);
    return pageToScreen(camera.current, span, SIDE, p.u, p.v);
  };
}

function cameraOn(floorId: 'veins' | 'heart'): RaidAtlasCamera {
  const camera = new RaidAtlasCamera();
  camera.setPage(pageSpan(raidAtlasFloor(plan, floorId).bounds));
  return camera;
}

describe('raid atlas boss faces and busts', () => {
  it('gives the Hammer Council one pin with both faces, lead first', () => {
    const hammer = bossOf('hammer');
    expect(hammer).toBeDefined();
    expect(raidAtlasBossFaces(hammer)).toEqual([SMITH_HEART_GUARDIANS.hammer, 'heart_seam_singer']);
    expect([...SMITH_HEART_COUNCIL].sort()).toEqual([...raidAtlasBossFaces(hammer)].sort());
  });

  it('gives every single-body boss its own face only', () => {
    for (const vein of ['breath', 'quench', 'heat'] as const) {
      const boss = bossOf(vein);
      expect(raidAtlasBossFaces(boss)).toEqual([SMITH_HEART_GUARDIANS[vein]]);
    }
    const final = bossOf('final');
    expect(raidAtlasBossFaces(final)).toEqual([SMITH_HEART_FINAL_BOSS]);
  });

  it('ships a committed bust for every face, and the render script frames each one', () => {
    const script = readFileSync('scripts/raid_atlas/render_boss_portraits.mjs', 'utf8');
    for (const boss of plan.bosses) {
      for (const face of raidAtlasBossFaces(boss)) {
        expect(raidAtlasPortraitUrl(face)).toBe(`/ui/raid-atlas/${face}.webp`);
        const file = `public${raidAtlasPortraitUrl(face)}`;
        expect(existsSync(file), file).toBe(true);
        // A real WebP, not a placeholder: RIFF....WEBP and some weight.
        const bytes = readFileSync(file);
        expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
        expect(bytes.subarray(8, 12).toString('latin1')).toBe('WEBP');
        expect(bytes.length).toBeGreaterThan(2000);
        expect(script).toContain(`${face}: {`);
      }
    }
  });
});

describe('raid atlas boss tooltip model', () => {
  const nameOf = (id: string) => `name:${id}`;

  it('reads an unseen boss as standing, never as dead', () => {
    expect(raidAtlasShownState('unknown')).toBe('alive');
    expect(raidAtlasShownState('alive')).toBe('alive');
    expect(raidAtlasShownState('engaged')).toBe('engaged');
    expect(raidAtlasShownState('dead')).toBe('dead');
  });

  it('titles the council by its encounter and a single boss by its name', () => {
    const [hammer, breath] = [0, 1].map((i) => marks()[i]);
    const council = raidAtlasBossTooltip(hammer, nameOf);
    expect(council.titleKey).toBe('hudChrome.raidAtlas.boss.hammer.title');
    expect(council.names).toEqual([
      `name:${SMITH_HEART_GUARDIANS.hammer}`,
      'name:heart_seam_singer',
    ]);
    expect(council.portraits).toHaveLength(2);
    const single = raidAtlasBossTooltip(breath, nameOf);
    expect(single.titleKey).toBeNull();
    expect(single.names).toEqual([`name:${SMITH_HEART_GUARDIANS.breath}`]);
    expect(single.portraits).toEqual([raidAtlasPortraitUrl(SMITH_HEART_GUARDIANS.breath)]);
  });

  it('carries the live state into its key, per state', () => {
    for (const [state, shown] of [
      ['alive', 'alive'],
      ['unknown', 'alive'],
      ['engaged', 'engaged'],
      ['dead', 'dead'],
    ] as const) {
      const model = raidAtlasBossTooltip(marks(state)[2], nameOf);
      expect(model.state).toBe(shown);
      expect(model.stateKey).toBe(`hudChrome.raidAtlas.boss.state.${shown}`);
    }
  });

  it('resolves every key it names to real English, free of dashes', () => {
    const lines: string[] = [];
    for (const mark of marks()) {
      const model = raidAtlasBossTooltip(mark, nameOf);
      const keys = [model.subtitleKey, model.loreKey, model.stateKey];
      if (model.titleKey) keys.push(model.titleKey);
      for (const key of keys) {
        const text = t(key, { lead: 'A', partner: 'B' });
        expect(text, key).not.toBe(key);
        expect(text.length, key).toBeGreaterThan(1);
        lines.push(text);
      }
      // Lore is two or three sentences.
      const sentences = t(model.loreKey)
        .split(/[.!?](?:\s|$)/)
        .filter((s) => s.trim());
      expect(sentences.length, model.loreKey).toBeGreaterThanOrEqual(2);
      expect(sentences.length, model.loreKey).toBeLessThanOrEqual(3);
    }
    for (const state of ['alive', 'engaged', 'dead'] as const)
      lines.push(t(`hudChrome.raidAtlas.boss.state.${state}`));
    lines.push(t('hudChrome.raidAtlas.boss.aria', { name: 'N', state: 'S' }));
    for (const line of lines) expect(line).not.toMatch(/[–—]/);
    expect(t('hudChrome.raidAtlas.boss.hammer.subtitle', { lead: 'A', partner: 'B' })).toBe(
      'A and B',
    );
  });
});

describe('raid atlas boss hit test', () => {
  const r = raidAtlasBossRadius(SIDE, 1);

  it('finds each boss of the open page at its medallion, and nothing between', () => {
    const camera = cameraOn('veins');
    const project = projector(camera, 'veins');
    for (const mark of marks()) {
      if (mark.boss.floor !== 'veins') continue;
      const p = project(mark.boss.x, mark.boss.z);
      expect(raidAtlasBossAt(marks(), 'veins', project, p.sx, p.sy, r, 0)?.boss.id).toBe(
        mark.boss.id,
      );
      // Just inside the rim still hits; past rim plus slop does not.
      expect(raidAtlasBossAt(marks(), 'veins', project, p.sx - r + 1, p.sy, r, 0)?.boss.id).toBe(
        mark.boss.id,
      );
      expect(raidAtlasBossAt(marks(), 'veins', project, p.sx - r - 4, p.sy, r, 3)).toBeNull();
      expect(raidAtlasBossAt(marks(), 'veins', project, p.sx - r - 4, p.sy, r, 9)?.boss.id).toBe(
        mark.boss.id,
      );
    }
    // The page's centre (the Ring) is no boss.
    expect(raidAtlasBossAt(marks(), 'veins', project, SIDE / 2, SIDE / 2, r, 3)).toBeNull();
  });

  it('never answers with a boss of the other page', () => {
    const camera = cameraOn('heart');
    const project = projector(camera, 'heart');
    const final = markOf('final');
    const p = project(final.boss.x, final.boss.z);
    expect(raidAtlasBossAt(marks(), 'heart', project, p.sx, p.sy, r, 0)?.boss.id).toBe('final');
    expect(raidAtlasBossAt(marks(), 'veins', project, p.sx, p.sy, r, 0)).toBeNull();
  });

  it("counts the council partner's smaller medallion as the council's pin", () => {
    const camera = cameraOn('veins');
    const project = projector(camera, 'veins');
    const hammer = markOf('hammer');
    const p = project(hammer.boss.x, hammer.boss.z);
    const px = p.sx + r * RAID_ATLAS_PARTNER.dx + r * RAID_ATLAS_PARTNER.r * 0.8;
    const py = p.sy + r * RAID_ATLAS_PARTNER.dy + r * RAID_ATLAS_PARTNER.r * 0.4;
    // Outside the lead's own disc, inside the partner's.
    expect(Math.hypot(px - p.sx, py - p.sy)).toBeGreaterThan(r);
    expect(raidAtlasBossAt(marks(), 'veins', project, px, py, r, 0)?.boss.id).toBe('hammer');
    // The same offset round a single-body boss is a miss.
    const quench = markOf('quench');
    const q = project(quench.boss.x, quench.boss.z);
    expect(
      raidAtlasBossAt(marks(), 'veins', project, q.sx + (px - p.sx), q.sy + (py - p.sy), r, 0),
    ).toBeNull();
  });

  it('follows the camera: after a zoom and a pan the old spot misses and the new one hits', () => {
    const camera = cameraOn('veins');
    const before = projector(camera, 'veins');
    const heat = markOf('heat');
    const p0 = before(heat.boss.x, heat.boss.z);
    camera.zoomNow(2.5, SIDE, SIDE / 2, SIDE / 2);
    camera.panNow(-90, 40, SIDE);
    const after = projector(camera, 'veins');
    const zr = raidAtlasBossRadius(SIDE, camera.current.zoom);
    expect(zr).toBeGreaterThan(r);
    const p1 = after(heat.boss.x, heat.boss.z);
    expect(Math.hypot(p1.sx - p0.sx, p1.sy - p0.sy)).toBeGreaterThan(zr * 3);
    expect(raidAtlasBossAt(marks(), 'veins', after, p1.sx, p1.sy, zr, 0)?.boss.id).toBe('heat');
    expect(raidAtlasBossAt(marks(), 'veins', after, p0.sx, p0.sy, zr, 0)?.boss.id).not.toBe('heat');
  });

  it('prefers the nearer of two overlapping pins', () => {
    const a = marks()[1];
    const b = { ...marks()[2], boss: { ...marks()[2].boss, x: a.boss.x, z: a.boss.z } };
    const project = (x: number, z: number) => ({ sx: x, sy: z });
    const hit = raidAtlasBossAt([a, b], 'veins', project, a.boss.x + 1, a.boss.z, 10, 0);
    expect(hit).toBe(a);
  });
});

describe('raid atlas boss card placement', () => {
  const card = { w: 272, h: 230 };

  it('sits right of a pin that leaves room, vertically centred on it', () => {
    expect(raidAtlasTooltipPlacement({ sx: 100, sy: 280 }, 20, card, SIDE)).toEqual({
      left: 130,
      top: 165,
    });
  });

  it('flips left of a pin near the right edge', () => {
    const at = raidAtlasTooltipPlacement({ sx: 480, sy: 280 }, 20, card, SIDE);
    expect(at.left).toBe(480 - 20 - 10 - 272);
  });

  it('goes below or above a pin in the middle of a face too narrow for either side', () => {
    const below = raidAtlasTooltipPlacement({ sx: 280, sy: 120 }, 20, card, SIDE);
    expect(below).toEqual({ left: 280 - 136, top: 150 });
    const above = raidAtlasTooltipPlacement({ sx: 280, sy: 470 }, 20, card, SIDE);
    expect(above).toEqual({ left: 280 - 136, top: 470 - 20 - 10 - 230 });
    // Neither covers the pin.
    for (const [at, sy] of [
      [below, 120],
      [above, 470],
    ] as const) {
      const clear = at.top >= sy + 20 || at.top + card.h <= sy - 20;
      expect(clear).toBe(true);
    }
  });

  it('stays inside the face at every corner and on a face narrower than the card', () => {
    for (const [sx, sy] of [
      [5, 5],
      [555, 5],
      [5, 555],
      [555, 555],
    ]) {
      const at = raidAtlasTooltipPlacement({ sx, sy }, 20, card, SIDE);
      expect(at.left).toBeGreaterThanOrEqual(10);
      expect(at.top).toBeGreaterThanOrEqual(10);
      expect(at.left + card.w).toBeLessThanOrEqual(SIDE - 10);
      expect(at.top + card.h).toBeLessThanOrEqual(SIDE - 10);
    }
    // A phone's face narrower than the card keeps the top-left on the face.
    const tiny = raidAtlasTooltipPlacement({ sx: 150, sy: 150 }, 16, card, 240);
    expect(tiny.left).toBe(10);
    expect(tiny.top).toBe(10);
  });

  it('covers as little of a centred pin as it can when no side has room', () => {
    // A tall card and a pin in the middle (the Heart's final boss).
    const tall = { w: 272, h: 320 };
    const at = raidAtlasTooltipPlacement({ sx: 275, sy: 300 }, 33, tall, SIDE);
    const overlapX = Math.max(0, Math.min(at.left + tall.w, 308) - Math.max(at.left, 242));
    const overlapY = Math.max(0, Math.min(at.top + tall.h, 333) - Math.max(at.top, 267));
    // The clamped left-hand seat would cover 40 px of the pin's width and the
    // centred ones all of it; the right-hand seat, pushed to the face's edge,
    // covers the least (30 px).
    expect(at.left).toBe(SIDE - 10 - tall.w);
    expect(overlapX).toBe(30);
    expect(overlapY).toBe(66);
  });
});
