// The WoW-style hierarchical map atlas (map_atlas_view.ts): navigation rules,
// hit-testing over the painted-art polygons, projection, and the invariant
// that the atlas and the live zone table can never drift apart.

import { describe, expect, it } from 'vitest';
import { ZONES } from '../src/sim/data';
import {
  atlasFit,
  atlasHitTest,
  atlasLevelUp,
  atlasNodeForZone,
  atlasNodeLevelRange,
  atlasParentLevel,
  BREACH_LEVEL_ZONE_IDS,
  buildAtlasModel,
  ISLAND_ZONE_IDS,
  MAP_ATLAS,
  resolveAtlasTarget,
} from '../src/ui/map_atlas_view';

describe('atlas coverage', () => {
  it('every zone in the world is reachable from the atlas', () => {
    const reachable = new Set<string>([...ISLAND_ZONE_IDS]);
    for (const level of Object.values(MAP_ATLAS)) {
      for (const node of level.nodes) {
        if (node.target.kind === 'zone') reachable.add(node.target.zoneId);
      }
    }
    for (const zone of ZONES) {
      expect(reachable.has(zone.id), `zone ${zone.id} unreachable from the atlas`).toBe(true);
    }
  });

  it('every atlas zone target is a real zone', () => {
    const ids = new Set(ZONES.map((z) => z.id));
    for (const level of Object.values(MAP_ATLAS)) {
      for (const node of level.nodes) {
        if (node.target.kind === 'zone') {
          expect(ids.has(node.target.zoneId), `${level.id}/${node.id}`).toBe(true);
        }
      }
    }
  });

  it('every shape has at least one ring and an in-art label anchor', () => {
    for (const level of Object.values(MAP_ATLAS)) {
      for (const node of level.nodes) {
        expect(node.polys.length).toBeGreaterThan(0);
        for (const poly of node.polys) expect(poly.length).toBeGreaterThanOrEqual(4);
        const [lx, ly] = node.label;
        expect(lx).toBeGreaterThan(0);
        expect(lx).toBeLessThan(level.artW);
        expect(ly).toBeGreaterThan(0);
        expect(ly).toBeLessThan(level.artH);
      }
    }
  });
});

describe('navigation rules', () => {
  it('zones walk up to their painted parent level', () => {
    expect(atlasParentLevel('eastbrook_vale')).toBe('world');
    expect(atlasParentLevel('ossara_domain')).toBe('world');
    expect(atlasParentLevel('kael_empire')).toBe('world');
    for (const id of BREACH_LEVEL_ZONE_IDS) expect(atlasParentLevel(id)).toBe('breach');
  });

  it('the breach level walks up to the world; the world is the top', () => {
    expect(atlasLevelUp('breach')).toBe('world');
    expect(atlasLevelUp('world')).toBeNull();
  });

  it('the island shape opens the player Landing band, else Eastbrook', () => {
    const landing = MAP_ATLAS.world.nodes.find((n) => n.id === 'landing')!;
    expect(resolveAtlasTarget(landing, 'mirefen_marsh')).toEqual({
      kind: 'zone',
      zoneId: 'mirefen_marsh',
    });
    expect(resolveAtlasTarget(landing, 'ossara_domain')).toEqual({
      kind: 'zone',
      zoneId: 'eastbrook_vale',
    });
  });

  it('the breach shape on the world map opens the breach level', () => {
    const breach = MAP_ATLAS.world.nodes.find((n) => n.id === 'breach')!;
    expect(resolveAtlasTarget(breach, 'eastbrook_vale')).toEqual({
      kind: 'level',
      level: 'breach',
    });
  });
});

describe('you-are-here resolution', () => {
  it('island bands collapse into the landing shape on the world map', () => {
    for (const id of ISLAND_ZONE_IDS) {
      expect(atlasNodeForZone('world', id)?.id).toBe('landing');
    }
  });

  it('breach-ring bands collapse into the breach shape on the world map', () => {
    expect(atlasNodeForZone('world', 'the_breach')?.id).toBe('breach');
    expect(atlasNodeForZone('world', 'redspire_pass')?.id).toBe('breach');
  });

  it('each ring band resolves to its own shape on the breach level', () => {
    expect(atlasNodeForZone('breach', 'the_breach')?.id).toBe('breach_core');
    expect(atlasNodeForZone('breach', 'saltbone_flats')?.id).toBe('saltbone');
    expect(atlasNodeForZone('breach', 'ironpass_crossing')?.id).toBe('ironpass');
  });
});

describe('hit-testing and projection', () => {
  // A 1264x848 canvas makes canvas px == art px (scale 1, no letterbox).
  const fit = atlasFit('world', 1264, 848);

  it('label anchors hit their own shape', () => {
    for (const level of ['world', 'breach'] as const) {
      const f = atlasFit(level, 1264, 848);
      for (const node of MAP_ATLAS[level].nodes) {
        const hit = atlasHitTest(level, node.label[0], node.label[1], f);
        expect(hit?.id, `${level}/${node.id} label anchor`).toBe(node.id);
      }
    }
  });

  it('open sea and letterbox miss every shape', () => {
    expect(atlasHitTest('world', 30, 30, fit)).toBeNull();
    const small = atlasFit('world', 400, 400); // letterboxed square canvas
    expect(atlasHitTest('world', 200, 5, small)).toBeNull();
  });

  it('the breach core wins the overlap with the territory ring', () => {
    const f = atlasFit('breach', 1264, 848);
    expect(atlasHitTest('breach', 632, 420, f)?.id).toBe('breach_core');
  });

  it('contain-fit letterboxes and centres', () => {
    const f = atlasFit('world', 400, 400);
    expect(f.scale).toBeCloseTo(400 / 1264, 5);
    expect(f.dx).toBe(0);
    expect(f.dy).toBeCloseTo((400 - 848 * f.scale) / 2, 5);
  });
});

describe('draw model', () => {
  it('level bands derive from the live zone table', () => {
    const world = MAP_ATLAS.world.nodes;
    const kael = world.find((n) => n.id === 'kael')!;
    const zone = ZONES.find((z) => z.id === 'kael_empire')!;
    expect(atlasNodeLevelRange(kael)).toEqual(zone.levelRange);
    const landing = world.find((n) => n.id === 'landing')!;
    expect(atlasNodeLevelRange(landing)).toEqual([1, 20]);
    const breach = world.find((n) => n.id === 'breach')!;
    const [min, max] = atlasNodeLevelRange(breach);
    expect(min).toBe(28);
    expect(max).toBe(60);
  });

  it('projects shapes and labels and flags hover + player location', () => {
    const model = buildAtlasModel({
      level: 'world',
      canvasW: 632,
      canvasH: 424,
      playerZoneId: 'mirefen_marsh',
      hoverNodeId: 'ossara',
    });
    expect(model.shapes).toHaveLength(MAP_ATLAS.world.nodes.length);
    expect(model.labels).toHaveLength(MAP_ATLAS.world.nodes.length);
    const landing = model.shapes.find((s) => s.nodeId === 'landing')!;
    expect(landing.playerHere).toBe(true);
    const ossara = model.shapes.find((s) => s.nodeId === 'ossara')!;
    expect(ossara.hover).toBe(true);
    // half-size canvas halves every projected coordinate
    const kaelLabel = model.labels.find((l) => l.nodeId === 'kael')!;
    expect(kaelLabel.mx).toBeCloseTo(816 / 2, 3);
    expect(kaelLabel.my).toBeCloseTo(208 / 2, 3);
    expect(kaelLabel.zoneId).toBe('kael_empire');
    const landingLabel = model.labels.find((l) => l.nodeId === 'landing')!;
    expect(landingLabel.zoneId).toBeNull();
  });

  it('is deterministic (same input, same output)', () => {
    const input = {
      level: 'breach' as const,
      canvasW: 512,
      canvasH: 512,
      playerZoneId: 'the_breach',
      hoverNodeId: null,
    };
    expect(buildAtlasModel(input)).toEqual(buildAtlasModel(input));
  });
});
