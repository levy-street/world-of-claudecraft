import { describe, expect, it } from 'vitest';
import { buildEntities, diffMoved, formatPatch, snapshot, zoneIdAt } from '../src/editor/model';
import { Camera, type Handle, pickHandle } from '../src/editor/view';

const VP = { width: 800, height: 600 };

describe('Camera transform', () => {
  it('round-trips world -> screen -> world', () => {
    const cam = new Camera({ x: 10, z: -20 }, 3);
    const p = { x: 42, z: 17 };
    const s = cam.worldToScreen(p, VP);
    const back = cam.screenToWorld(s, VP);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.z).toBeCloseTo(p.z, 9);
  });

  it('puts the camera centre at the viewport centre', () => {
    const cam = new Camera({ x: 5, z: 5 }, 2);
    const s = cam.worldToScreen({ x: 5, z: 5 }, VP);
    expect(s.sx).toBeCloseTo(VP.width / 2, 9);
    expect(s.sy).toBeCloseTo(VP.height / 2, 9);
  });

  it('keeps the anchored world point fixed while zooming', () => {
    const cam = new Camera({ x: 0, z: 0 }, 2);
    const anchor = { sx: 700, sy: 120 };
    const worldUnder = cam.screenToWorld(anchor, VP);
    cam.zoomAt(anchor, 2.5, VP);
    const after = cam.worldToScreen(worldUnder, VP);
    expect(after.sx).toBeCloseTo(anchor.sx, 6);
    expect(after.sy).toBeCloseTo(anchor.sy, 6);
  });

  it('clamps zoom to its bounds', () => {
    const cam = new Camera({ x: 0, z: 0 }, 2, 0.5, 8);
    cam.zoomAt({ sx: 400, sy: 300 }, 100, VP);
    expect(cam.pxPerYard).toBe(8);
    cam.zoomAt({ sx: 400, sy: 300 }, 0.0001, VP);
    expect(cam.pxPerYard).toBe(0.5);
  });

  it('pans by a pixel delta in world units', () => {
    const cam = new Camera({ x: 0, z: 0 }, 4);
    cam.panByPixels(40, -20); // drag content right/up
    expect(cam.center.x).toBeCloseTo(-10, 9);
    expect(cam.center.z).toBeCloseTo(5, 9);
  });

  it('frames a bounding box centred and scaled to fit', () => {
    const cam = new Camera({ x: 0, z: 0 }, 1);
    cam.frame({ x: -100, z: -100 }, { x: 100, z: 100 }, VP, 0);
    expect(cam.center.x).toBeCloseTo(0, 9);
    expect(cam.center.z).toBeCloseTo(0, 9);
    // 200-yard span into the 600px-tall (limiting) viewport -> 3 px/yard.
    expect(cam.pxPerYard).toBeCloseTo(3, 9);
  });
});

describe('pickHandle', () => {
  const cam = new Camera({ x: 0, z: 0 }, 2);
  const handles: Handle[] = [
    { id: 'a', x: 0, z: 0, radius: 2 },
    { id: 'b', x: 50, z: 0, radius: 2 },
  ];

  it('hits a handle under the cursor', () => {
    const s = cam.worldToScreen({ x: 50, z: 0 }, VP);
    expect(pickHandle(handles, s, cam, VP)?.id).toBe('b');
  });

  it('misses empty space', () => {
    const s = cam.worldToScreen({ x: 200, z: 200 }, VP);
    expect(pickHandle(handles, s, cam, VP)).toBeNull();
  });

  it('prefers the last (topmost) overlapping handle', () => {
    const stacked: Handle[] = [
      { id: 'under', x: 0, z: 0, radius: 4 },
      { id: 'over', x: 0, z: 0, radius: 4 },
    ];
    const s = cam.worldToScreen({ x: 0, z: 0 }, VP);
    expect(pickHandle(stacked, s, cam, VP)?.id).toBe('over');
  });
});

describe('model: build + diff + patch', () => {
  const content = {
    zones: [
      {
        id: 'z1',
        name: 'Zone One',
        zMin: -100,
        zMax: 100,
        levelRange: [1, 7] as [number, number],
        biome: 'vale' as never,
        hub: { x: 0, z: 0, radius: 10, name: 'Town' },
        graveyard: { x: -5, z: -5 },
        lakes: [{ x: 30, z: 40, radius: 12 }],
        pois: [{ x: 10, z: 10, label: 'Lookout' }],
        welcome: 'hi',
      },
    ],
    camps: [{ mobId: 'wolf', center: { x: 20, z: 20 }, radius: 5, count: 3 }],
    npcs: {
      gus: {
        id: 'gus',
        name: 'Gus',
        title: '',
        pos: { x: 1, z: 1 },
        facing: 0,
        color: 0,
        questIds: [],
        greeting: '',
      },
      ghost: {
        id: 'ghost',
        name: 'Ghost',
        title: '',
        pos: { x: 2, z: 2 },
        facing: 0,
        color: 0,
        questIds: [],
        greeting: '',
        dynamic: true,
      },
    },
    objects: [
      {
        itemId: 'herb',
        name: 'Herb',
        positions: [
          { x: 7, z: 8 },
          { x: 9, z: 9 },
        ],
      },
    ],
  };

  it('builds one handle per spatial marker and skips dynamic npcs', () => {
    const ents = buildEntities(content);
    const kinds = ents.map((e) => e.kind).sort();
    // hub, graveyard, lake, poi, camp, npc(gus only), object x2
    expect(ents.find((e) => e.label === 'Ghost')).toBeUndefined();
    expect(kinds.filter((k) => k === 'object')).toHaveLength(2);
    expect(ents.filter((e) => e.kind === 'npc')).toHaveLength(1);
  });

  it('assigns camps/npcs to the zone whose z-band contains them', () => {
    expect(zoneIdAt(content.zones, { x: 0, z: 20 })).toBe('z1');
    expect(zoneIdAt(content.zones, { x: 0, z: 9999 })).toBeNull();
    const ents = buildEntities(content);
    expect(ents.find((e) => e.kind === 'camp')?.zoneId).toBe('z1');
  });

  it('detects moved markers via a live point reference', () => {
    const ents = buildEntities(content);
    const base = snapshot(ents);
    const poi = ents.find((e) => e.kind === 'poi');
    if (!poi) throw new Error('fixture has no poi entity');
    poi.point.x = 99; // simulate a drag mutating the live ref
    poi.point.z = 88;
    const moved = diffMoved(ents, base);
    expect(moved).toHaveLength(1);
    expect(moved[0].from).toEqual({ x: 10, z: 10 });
    expect(moved[0].to).toEqual({ x: 99, z: 88 });
    expect(formatPatch(moved)).toContain('Lookout');
  });

  it('ignores sub-precision float noise', () => {
    const ents = buildEntities(content);
    const base = snapshot(ents);
    ents[0].point.x += 0.0001;
    expect(diffMoved(ents, base, 2)).toHaveLength(0);
  });
});
