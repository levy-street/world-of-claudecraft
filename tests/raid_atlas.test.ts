// The raid atlas's pure cores (src/ui/hud/raid_atlas/): the plan derived from
// the Smith's Heart's own content, the camera's zoom and pan, the player's
// pins, and the live frame read from an IWorld-shaped stub.

import { describe, expect, it } from 'vitest';
import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
} from '../src/sim/content/smith_heart';
import {
  BREATH,
  HEART_ROOM,
  inSmithHeartRoom,
  SMITH_HEART_BOSS_SPOTS,
} from '../src/sim/content/smith_heart_layout';
import {
  SMITH_HEART_EXIT_BIT,
  SMITH_HEART_VEIN_BITS,
  smithHeartSealTemplate,
} from '../src/sim/encounters/smith_heart/seal';
import {
  clampView,
  pageSpan,
  pageToScreen,
  RAID_ATLAS_MAX_ZOOM,
  RaidAtlasCamera,
  screenToPage,
  toPage,
  wheelZoomFactor,
  zoomViewAt,
} from '../src/ui/hud/raid_atlas/raid_atlas_camera_core';
import { arrowScreenAngle, scaleBarYards } from '../src/ui/hud/raid_atlas/raid_atlas_painter';
import {
  addPin,
  parsePins,
  pinAtScreen,
  RAID_ATLAS_MAX_PINS,
  raidAtlasPinKey,
  removePin,
  restylePin,
  serializePins,
} from '../src/ui/hud/raid_atlas/raid_atlas_pins_core';
import {
  hasRaidAtlas,
  raidAtlasFloor,
  raidAtlasFloorAt,
  raidAtlasPlanFor,
  squareBounds,
} from '../src/ui/hud/raid_atlas/raid_atlas_plan_core';
import {
  buildRaidAtlasFrame,
  defaultRaidAtlasFloor,
  type RaidAtlasOrigin,
} from '../src/ui/hud/raid_atlas/raid_atlas_view';
import { t } from '../src/ui/i18n';

const plan = (() => {
  const p = raidAtlasPlanFor('smith_heart');
  if (!p) throw new Error('the Smith Heart has an atlas');
  return p;
})();

function inPolygon(x: number, z: number, pts: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

describe('raid atlas plan: derived from the raid, never guessed', () => {
  it('exists for the Smith Heart only (the pilot)', () => {
    expect(hasRaidAtlas('smith_heart')).toBe(true);
    expect(hasRaidAtlas('drowned_temple')).toBe(false);
    expect(raidAtlasPlanFor('drowned_temple')).toBeNull();
    expect(raidAtlasPlanFor('smith_heart')).toBe(plan);
  });

  it('has two square pages: the veins and the Heart behind the seal', () => {
    expect(plan.floors.map((f) => f.id)).toEqual(['veins', 'heart']);
    for (const f of plan.floors) {
      expect(f.bounds.maxX - f.bounds.minX).toBeCloseTo(f.bounds.maxZ - f.bounds.minZ, 6);
    }
    // The pages split the field's surfaces, every one exactly once.
    const all = plan.floors.flatMap((f) => f.surfaces).sort((a, b) => a - b);
    expect(all).toEqual(plan.field.surfaces.map((_, i) => i));
    expect(raidAtlasFloorAt(HEART_ROOM.x, HEART_ROOM.z)).toBe('heart');
    expect(raidAtlasFloorAt(BREATH.cornice.x, BREATH.cornice.z)).toBe('veins');
    expect(raidAtlasFloorAt(0, 0)).toBe('veins');
  });

  it('stands every boss on its own spot, on walkable ground of its page', () => {
    const spot = { ...SMITH_HEART_BOSS_SPOTS } as Record<string, { x: number; z: number }>;
    expect(plan.bosses.map((b) => b.id)).toEqual(['hammer', 'breath', 'quench', 'heat', 'final']);
    for (const b of plan.bosses) {
      expect({ x: b.x, z: b.z }).toEqual(spot[b.id]);
      expect(b.floor).toBe(inSmithHeartRoom(b.x, b.z) ? 'heart' : 'veins');
      const floor = raidAtlasFloor(plan, b.floor);
      const onGround = floor.surfaces.some((i) =>
        inPolygon(b.x, b.z, plan.field.surfaces[i].points),
      );
      expect(onGround, b.id).toBe(true);
    }
    expect(plan.bosses[0].bodyIds).toEqual(SMITH_HEART_COUNCIL);
    expect(plan.bosses[1].mobId).toBe(SMITH_HEART_GUARDIANS.breath);
    expect(plan.bosses[4].mobId).toBe(SMITH_HEART_FINAL_BOSS);
  });

  it('keeps every room, boss and portal inside its page frame', () => {
    for (const f of plan.floors) {
      const inside = (x: number, z: number) =>
        x > f.bounds.minX && x < f.bounds.maxX && z > f.bounds.minZ && z < f.bounds.maxZ;
      for (const r of f.rooms) expect(inside(r.x, r.z), r.id).toBe(true);
      for (const b of plan.bosses.filter((x) => x.floor === f.id))
        expect(inside(b.x, b.z), b.id).toBe(true);
      for (const p of plan.pois.filter((x) => x.floor === f.id))
        expect(inside(p.x, p.z), p.kind).toBe(true);
    }
  });

  it('names every room and page through an English catalog key', () => {
    for (const f of plan.floors) {
      expect(t(f.labelKey as never)).not.toBe(f.labelKey);
      for (const r of f.rooms) expect(t(r.labelKey as never), r.id).not.toBe(r.labelKey);
    }
  });

  it('squares a box and leaves head and foot room for the chrome', () => {
    const b = squareBounds(
      [
        [0, 0],
        [100, 40],
      ],
      10,
      0.1,
      0.05,
    );
    expect(b.maxX - b.minX).toBeCloseTo(b.maxZ - b.minZ, 6);
    // 120 yd of page: 12 yd more above the ground than below, 6 below.
    expect(b.maxZ - 40).toBeGreaterThan(0 - b.minZ);
  });
});

describe('raid atlas camera', () => {
  const span = 400;
  const side = 560;

  it('zooms about the cursor: the page point under it stays under it', () => {
    const v0 = { zoom: 1, cu: 200, cv: 200 };
    const before = screenToPage(v0, span, side, 140, 380);
    const v1 = zoomViewAt(v0, span, side, 2.5, 140, 380);
    const after = pageToScreen(v1, span, side, before.u, before.v);
    expect(v1.zoom).toBeCloseTo(2.5, 6);
    expect(after.sx).toBeCloseTo(140, 6);
    expect(after.sy).toBeCloseTo(380, 6);
  });

  it('clamps zoom to its range and the view to the page', () => {
    expect(clampView({ zoom: 0.2, cu: -50, cv: 900 }, span)).toEqual({ zoom: 1, cu: 200, cv: 200 });
    const deep = clampView({ zoom: 99, cu: 0, cv: span }, span);
    expect(deep.zoom).toBe(RAID_ATLAS_MAX_ZOOM);
    const half = span / (2 * RAID_ATLAS_MAX_ZOOM);
    expect(deep.cu).toBeCloseTo(half, 6);
    expect(deep.cv).toBeCloseTo(span - half, 6);
  });

  it('glides toward its target and stops asking for frames once home', () => {
    const cam = new RaidAtlasCamera();
    cam.setPage(span);
    cam.zoomAt(2, side, side / 2, side / 2);
    expect(cam.gliding()).toBe(true);
    let frames = 0;
    while (cam.step(1 / 60) && frames < 600) frames++;
    expect(frames).toBeGreaterThan(5);
    expect(frames).toBeLessThan(120);
    expect(cam.current.zoom).toBeCloseTo(2, 6);
    expect(cam.gliding()).toBe(false);
    cam.reset();
    while (cam.step(1 / 60)) {}
    expect(cam.current).toEqual({ zoom: 1, cu: span / 2, cv: span / 2 });
    expect(cam.atHome()).toBe(true);
  });

  it('pans and pinches immediately (the paper follows the finger)', () => {
    const cam = new RaidAtlasCamera();
    cam.setPage(span);
    cam.zoomNow(3, side, side / 2, side / 2);
    const before = { ...cam.current };
    cam.panNow(30, 0, side);
    expect(cam.gliding()).toBe(false);
    expect(cam.current.cu).toBeLessThan(before.cu);
  });

  it('turns a wheel delta into a zoom: up zooms in, down out, nothing for zero', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(Number.NaN)).toBe(1);
    // A huge delta is capped.
    expect(wheelZoomFactor(-10000)).toBeCloseTo(wheelZoomFactor(-240), 9);
  });

  it('projects like the minimap: +x to the left, +z up', () => {
    const b = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
    const v = { zoom: 1, cu: 100, cv: 100 };
    const east = toPage(b, 50, 0);
    const north = toPage(b, 0, 50);
    expect(pageToScreen(v, pageSpan(b), side, east.u, east.v).sx).toBeLessThan(side / 2);
    expect(pageToScreen(v, pageSpan(b), side, north.u, north.v).sy).toBeLessThan(side / 2);
  });
});

describe('raid atlas painter helpers', () => {
  it('turns the arrow with the facing, mirrored like the page', () => {
    expect(arrowScreenAngle(0)).toBe(-0);
    expect(arrowScreenAngle(Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('picks a round scale-bar length near a fifth of the view', () => {
    expect(scaleBarYards(1, 560)).toBe(200);
    expect(scaleBarYards(6, 560)).toBe(20);
    expect(scaleBarYards(0.5, 330)).toBe(200);
  });
});

describe('raid atlas pins', () => {
  const style = { icon: 'skull', color: 'red' } as const;

  it('adds, restyles and removes, ids stable and increasing', () => {
    let pins = addPin([], 'veins', 10, 20, style);
    pins = addPin(pins, 'heart', 188, 172, { icon: 'star', color: 'gold' });
    expect(pins.map((p) => p.id)).toEqual([1, 2]);
    pins = restylePin(pins, 1, { color: 'blue' });
    expect(pins[0]).toMatchObject({ icon: 'skull', color: 'blue', x: 10, z: 20 });
    pins = removePin(pins, 1);
    pins = addPin(pins, 'veins', 0, 0, style);
    expect(pins.map((p) => p.id)).toEqual([2, 3]);
  });

  it('caps the list, the oldest pin making room', () => {
    let pins: ReturnType<typeof addPin> = [];
    for (let i = 0; i < RAID_ATLAS_MAX_PINS + 3; i++) pins = addPin(pins, 'veins', i, i, style);
    expect(pins).toHaveLength(RAID_ATLAS_MAX_PINS);
    expect(pins[0].x).toBe(3);
  });

  it('round-trips through storage and drops anything malformed', () => {
    const pins = addPin(addPin([], 'veins', 1.25, -3.5, style), 'heart', 200, 150, style);
    expect(parsePins(serializePins(pins))).toEqual([{ ...pins[0], x: 1.3, z: -3.5 }, pins[1]]);
    expect(parsePins(null)).toEqual([]);
    expect(parsePins('not json')).toEqual([]);
    expect(parsePins('{"v":99,"pins":[]}')).toEqual([]);
    const mixed = JSON.stringify({
      v: 1,
      pins: [
        [1, 'veins', 1, 2, 'star', 'gold'],
        [1, 'veins', 1, 2, 'star', 'gold'], // duplicate id
        [2, 'attic', 1, 2, 'star', 'gold'], // unknown page
        [3, 'veins', 'x', 2, 'star', 'gold'], // not a number
        [4, 'veins', 1, 2, 'cake', 'gold'], // unknown icon
        [5, 'veins', 1, 2, 'star', 'mauve'], // unknown colour
        [6, 'veins', 1e9, 2, 'star', 'gold'], // absurd position
        [7, 'heart', 5, 6, 'flag', 'white'],
      ],
    });
    expect(parsePins(mixed).map((p) => p.id)).toEqual([1, 7]);
  });

  it('keys storage per raid and per character', () => {
    expect(raidAtlasPinKey('smith_heart', 'Ana')).not.toBe(raidAtlasPinKey('smith_heart', 'Bo'));
    expect(raidAtlasPinKey('smith_heart', 'Ana')).toBe('woc.raidAtlas.pins.smith_heart.Ana');
  });

  it('hits the topmost pin head on the page shown', () => {
    const pins = addPin(addPin([], 'veins', 0, 0, style), 'veins', 0, 0, style);
    const project = (x: number, z: number) => ({ sx: 100 + x, sy: 100 + z });
    expect(pinAtScreen(pins, 'veins', project, 100, 75, 12, 25)?.id).toBe(2);
    expect(pinAtScreen(pins, 'heart', project, 100, 75, 12, 25)).toBeNull();
    expect(pinAtScreen(pins, 'veins', project, 160, 75, 12, 25)).toBeNull();
  });
});

describe('raid atlas live frame (Sim- and ClientWorld-shaped worlds)', () => {
  const OX = 3000;
  const OZ = -4000;
  const origin: RaidAtlasOrigin = {
    originX: OX,
    originZ: OZ,
    contains: (x, z) => Math.abs(x - OX) < 300 && Math.abs(z - OZ) < 260,
  };
  type Ent = {
    id: number;
    kind: string;
    templateId: string;
    pos: { x: number; y: number; z: number };
    dead: boolean;
    inCombat: boolean;
  };
  const ent = (
    id: number,
    kind: string,
    templateId: string,
    x: number,
    z: number,
    extra = {},
  ): Ent => ({
    id,
    kind,
    templateId,
    pos: { x: OX + x, y: 0, z: OZ + z },
    dead: false,
    inCombat: false,
    ...extra,
  });
  const world = (ents: Ent[], player = { x: 0, z: 70 }, members: unknown[] = []) => {
    const map = new Map(ents.map((e) => [e.id, e]));
    return {
      entities: map,
      player: {
        id: 1,
        name: 'Ana',
        pos: { x: OX + player.x, y: 0, z: OZ + player.z },
        facing: 0.5,
      },
      partyInfo: members.length ? { leader: 1, raid: true, master: {}, members } : null,
    } as never;
  };

  it('places the player on the page and area they stand in', () => {
    const f = buildRaidAtlasFrame(world([]), plan, origin);
    expect(f.player).toEqual({ x: 0, z: 70, facing: 0.5 });
    expect(f.playerFloor).toBe('veins');
    expect(f.playerArea).toBe('ring');
    const h = buildRaidAtlasFrame(world([], { x: HEART_ROOM.x, z: HEART_ROOM.z }), plan, origin);
    expect(h.playerFloor).toBe('heart');
    expect(defaultRaidAtlasFloor(h)).toBe('heart');
  });

  it('reads no player when the raid is viewed from outside', () => {
    const f = buildRaidAtlasFrame(world([], { x: 5000, z: 0 }), plan, origin);
    expect(f.player).toBeNull();
    expect(f.playerFloor).toBeNull();
  });

  it('keeps only raid members in this instance copy', () => {
    const m = (pid: number, x: number, z: number) => ({
      pid,
      name: `M${pid}`,
      cls: 'mage',
      x,
      z,
      dead: 0,
    });
    const f = buildRaidAtlasFrame(
      world([], { x: 0, z: 0 }, [m(1, OX, OZ), m(2, OX + 10, OZ + 5), m(3, OX + 900, OZ)]),
      plan,
      origin,
    );
    expect(f.members.map((x) => x.name)).toEqual(['M2']);
    expect(f.members[0]).toMatchObject({ x: 10, z: 5, cls: 'mage', dead: false });
  });

  it('reads a boss as standing, fighting or dead from its own body', () => {
    const q = SMITH_HEART_BOSS_SPOTS.quench;
    const quench = SMITH_HEART_GUARDIANS.quench;
    const state = (extra: object) =>
      buildRaidAtlasFrame(
        world([ent(9, 'mob', quench, q.x, q.z, extra)]),
        plan,
        origin,
      ).bosses.find((b) => b.boss.id === 'quench')?.state;
    expect(state({})).toBe('alive');
    expect(state({ inCombat: true })).toBe('engaged');
    expect(state({ dead: true })).toBe('dead');
    // Far away and no seal marker in sight: unknown, never drawn as dead.
    const f = buildRaidAtlasFrame(world([]), plan, origin);
    expect(f.bosses.every((b) => b.state === 'unknown')).toBe(true);
    expect(f.defeated).toBe(0);
  });

  it('needs BOTH council bodies dead for the Hammer to fall', () => {
    const h = SMITH_HEART_BOSS_SPOTS.hammer;
    const [a, b] = SMITH_HEART_COUNCIL;
    const one = buildRaidAtlasFrame(
      world([ent(5, 'mob', a, h.x, h.z, { dead: true }), ent(6, 'mob', b, h.x, h.z)]),
      plan,
      origin,
    );
    expect(one.bosses[0].state).toBe('alive');
    const both = buildRaidAtlasFrame(
      world([
        ent(5, 'mob', a, h.x, h.z, { dead: true }),
        ent(6, 'mob', b, h.x, h.z, { dead: true }),
      ]),
      plan,
      origin,
    );
    expect(both.bosses[0].state).toBe('dead');
  });

  it('reads far-off guardians and the final boss from the seal markers', () => {
    const mask = SMITH_HEART_VEIN_BITS.breath | SMITH_HEART_VEIN_BITS.heat | SMITH_HEART_EXIT_BIT;
    const seal = ent(40, 'object', smithHeartSealTemplate(mask), 0, 0);
    const f = buildRaidAtlasFrame(world([seal]), plan, origin);
    const by = Object.fromEntries(f.bosses.map((b) => [b.boss.id, b.state]));
    expect(by).toEqual({
      hammer: 'unknown',
      breath: 'dead',
      quench: 'unknown',
      heat: 'dead',
      final: 'dead',
    });
    expect(f.defeated).toBe(3);
    // A marker of ANOTHER instance copy is not this raid's seal.
    const foreign = { ...seal, pos: { x: OX + 2000, y: 0, z: OZ } };
    expect(buildRaidAtlasFrame(world([foreign]), plan, origin).defeated).toBe(0);
  });
});
