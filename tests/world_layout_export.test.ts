import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Compile/composition fixtures start from the canonical world, just like the
// exporter. The real activated migration is covered by world_layout_candidate.
vi.mock('../src/sim/world_layout/active', () => ({
  WORLD_LAYOUT: {
    version: 1,
    buildings: {},
    npcs: {},
    camps: [],
    groundObjects: {},
    objectMoves: {},
  },
}));

import {
  compileWorldLayout,
  emitWorldLayoutModule,
  type WorldLayoutReview,
} from '../src/editor/world_layout_export';
import { AUTHORED_TOWNS } from '../src/sim/authored_town_registry';
import { BUILTIN_WORLD } from '../src/sim/data';
import type { MapDoc } from '../src/sim/map_doc';
import { composeWorldLayout } from '../src/sim/world_layout';

const source = readFileSync('data/maps/eastbrook_and_mirefen_changes.map.json', 'utf8');
const map = JSON.parse(source) as MapDoc;
const review = JSON.parse(
  readFileSync('data/world_layout/eastbrook_and_mirefen.review.json', 'utf8'),
) as WorldLayoutReview;
const buildings = AUTHORED_TOWNS.flatMap((town) => town.buildings);

function fixture() {
  const uid = review.buildingBindings.fenbridge_gilded_strongbox;
  const doc: MapDoc = {
    version: map.version,
    meta: map.meta,
    content: { zones: [], camps: [], npcs: {}, objects: [], roads: [] },
    terrainEdits: [],
    placements: [structuredClone(map.placements.find((p) => p.uid === uid)!)],
  };
  const plan: WorldLayoutReview = {
    version: 1,
    sourceSha256: review.sourceSha256,
    baseRevision: review.baseRevision,
    buildingBindings: { fenbridge_gilded_strongbox: uid },
    npcIds: [],
    groundObjectIds: [],
    camps: [],
    objectMoveKeys: [],
    excludedPlacements: {},
    pending: [],
  };
  return { doc, plan };
}

describe('reviewed Studio to built-in world export', () => {
  it('keeps a copy at the old bank position unresolved when the canonical bank moves', () => {
    const { doc, plan } = fixture();
    const bank = buildings.find((building) => building.id === 'fenbridge_gilded_strongbox')!;
    const oldBank = {
      ...doc.placements[0],
      uid: 'copy-at-old-position',
      x: bank.placement.x,
      z: bank.placement.z,
    };
    expect(doc.placements[0].x).not.toBe(oldBank.x);
    doc.placements.push(oldBank);
    plan.preserveMatchingScenery = true;
    const result = compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan, [oldBank]);
    expect(result.unboundPlacementUids).toEqual(['copy-at-old-position']);
    expect(result.preservedScenery).toEqual([]);
    expect(() => emitWorldLayoutModule(result, plan.sourceSha256)).toThrow('export blocked');
  });

  it('requires a fresh baseline and never preserves two copies from one baseline object', () => {
    const { doc, plan } = fixture();
    plan.preserveMatchingScenery = true;
    expect(
      compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan).issues.map((i) => i.id),
    ).toContain('scenery-baseline');
    const rock = { assetId: 'props/rock_large_d', x: 10, z: 20, rotY: 0, scale: 2, collide: true };
    doc.placements.push({ ...rock, uid: 'rock-one' }, { ...rock, uid: 'rock-two' });
    const result = compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan, [rock]);
    expect(result.preservedScenery).toEqual([{ uid: 'rock-one', currentIndex: 0 }]);
    expect(result.unboundPlacementUids).toEqual(['rock-two']);
  });

  it('rejects a different seed even when every placement is resolved', () => {
    const { doc, plan } = fixture();
    doc.meta = { ...doc.meta, seed: doc.meta.seed + 1 };
    const result = compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan);
    expect(result.issues.map((i) => i.id)).toContain('world-seed');
    expect(() => emitWorldLayoutModule(result, plan.sourceSha256)).toThrow('export blocked');
  });

  it('pins review bindings to the actual source bytes', () => {
    expect(createHash('sha256').update(source).digest('hex')).toBe(review.sourceSha256);
    expect(map.placements.some((p) => p.assetId === 'tidehold/highwatch/manor')).toBe(false);
  });

  it('carries confirmed camp counts and dummy removals without losing current gameplay', () => {
    const result = compileWorldLayout(map, BUILTIN_WORLD, buildings, review);
    expect(result.issues.some((i) => i.id === 'composition')).toBe(false);
    const world = composeWorldLayout(BUILTIN_WORLD, result.layout);
    expect(BUILTIN_WORLD.camps.reduce((n, camp) => n + camp.count, 0)).toBe(714);
    expect(world.camps).toHaveLength(314);
    expect(world.camps.reduce((n, camp) => n + camp.count, 0)).toBe(710);
    for (const [id, count] of Object.entries({
      forest_wolf: 10,
      gloam_strider: 7,
      hedge_gnome: 7,
      ridge_stalker: 11,
      thornpeak_ogre: 10,
      topiary_wolf: 11,
      tunnel_rat: 7,
      void_stalker: 5,
    }))
      expect(
        world.camps.filter((c) => c.mobId === id).reduce((n, c) => n + c.count, 0),
        id,
      ).toBe(count);
    const privatePopulations = (camps: typeof world.camps) => {
      const totals: Record<string, number> = {};
      for (const camp of camps)
        if (camp.offStream) totals[camp.mobId] = (totals[camp.mobId] ?? 0) + camp.count;
      return totals;
    };
    expect(privatePopulations(world.camps)).toEqual(privatePopulations(BUILTIN_WORLD.camps));
    for (const [id, npc] of Object.entries(BUILTIN_WORLD.npcs)) {
      const { pos: _oldPos, facing: _oldFacing, ...before } = npc;
      const { pos: _newPos, facing: _newFacing, ...after } = world.npcs[id];
      expect(after, id).toEqual(before);
    }
    expect(world.npcs.fury.vendorItems).toHaveLength(189);
    expect(world.npcs.warmarshal_draven_kole.vendorItems).toHaveLength(189);
    expect(world.services!.mailboxes).toBe(BUILTIN_WORLD.services!.mailboxes);
    expect(world.services!.stations).toHaveLength(BUILTIN_WORLD.services!.stations!.length);
    expect(world.groundObjects.map((o) => o.entityIds)).toEqual(
      BUILTIN_WORLD.groundObjects.map((o) => o.entityIds),
    );
    expect(world.groundObjects[0].positions).toEqual(map.content.objects[0].positions);
    expect(
      Object.entries(world.objectMoves!)
        .filter(([, move]) => move.removed)
        .map(([key]) => key)
        .sort(),
    ).toEqual(
      ['caster', 'ranger', 'scout', 'soldier', 'tank'].map(
        (role) => `practiceDummy:healing_dummy_${role}`,
      ),
    );
    expect(world.objectMoves!['practiceDummy:hub_healing_dummy'].removed).toBeUndefined();
  });

  it('imports exact road bindings and new paths while preserving newer inn access routes', () => {
    const result = compileWorldLayout(map, BUILTIN_WORLD, buildings, review);
    expect(result.layout.roads?.edits).toHaveLength(13);
    expect(result.layout.roads?.additions).toHaveLength(44);
    expect(result.issues.filter((i) => i.id.startsWith('road:'))).toEqual([]);
    const unreviewed = compileWorldLayout(map, BUILTIN_WORLD, buildings, {
      ...review,
      preservedRecords: {},
    });
    expect(unreviewed.issues.filter((i) => i.id.startsWith('road:')).map((i) => i.id)).toEqual([
      'road:43',
      'road:51',
    ]);
    const world = composeWorldLayout(BUILTIN_WORLD, result.layout);
    expect(world.roads).toHaveLength(147);
    expect(world.roads[43]).toBe(BUILTIN_WORLD.roads[43]);
    expect(world.roads[51]).toBe(BUILTIN_WORLD.roads[51]);
    expect(world.roads[0]).toEqual(
      map.roadEdits?.['0'] && 'points' in map.roadEdits['0'] ? map.roadEdits['0'].points : null,
    );
    expect(world.roads.slice(103)).toEqual(map.roadDefs?.map((road) => road.points));
    const stale = structuredClone(review);
    if (!stale.roads) throw new Error('Missing review fixture');
    stale.roads.edits['0'][0].x += 1;
    const invalid = compileWorldLayout(map, BUILTIN_WORLD, buildings, stale);
    expect(invalid.issues.some((issue) => issue.id === 'composition')).toBe(true);
    expect(() => emitWorldLayoutModule(invalid, review.sourceSha256)).toThrow();
  });

  it.each(['x', 'z', 'y', 'facing', 'scale'] as const)(
    'detects a ground-object %s edit while ignoring key order and missing reserved IDs',
    (field) => {
      const { doc, plan } = fixture();
      const current = BUILTIN_WORLD.groundObjects.find(
        (object) =>
          object.itemId === 'wreckfield_flotsam_crate' && object.name === 'Shipwreck Debris',
      );
      if (!current) throw new Error('Missing canonical shipwreck debris');
      doc.content.objects = [
        {
          ...current,
          entityIds: undefined,
          positions: current.positions.map(({ x, y, z, facing, scale }) => ({
            x,
            z,
            scale,
            facing,
            y,
          })),
        },
      ];
      expect(compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan).issues).toEqual([]);
      const position = doc.content.objects[0].positions[0];
      position[field] = (position[field] ?? 0) + 1;
      expect(
        compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan).issues.map((i) => i.id),
      ).toContain('object:wreckfield_flotsam_crate:Shipwreck Debris');
    },
  );

  it('compiles an explicit road removal and rejects false or contradictory removal markers', () => {
    const { doc, plan } = fixture();
    doc.content.roads = [structuredClone(BUILTIN_WORLD.roads[0])];
    doc.roadEdits = { '0': { removed: true } };
    plan.roads = { edits: { '0': doc.content.roads[0] }, additionIds: [] };
    plan.preservedLayers = { 'content.roads': 'The fixture selects one base road for editing.' };
    const valid = compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan);
    expect(valid.issues).toEqual([]);
    expect(composeWorldLayout(BUILTIN_WORLD, valid.layout).roads).toEqual(
      BUILTIN_WORLD.roads.slice(1),
    );
    for (const invalid of [{ removed: false }, { removed: true, points: doc.content.roads[0] }]) {
      doc.roadEdits['0'] = invalid as (typeof doc.roadEdits)[string];
      const result = compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan);
      expect(result.issues.some((issue) => issue.id === 'road:0')).toBe(true);
      expect(() => emitWorldLayoutModule(result, plan.sourceSha256)).toThrow('export blocked');
    }
  });

  it.each(['unreviewed', 'unsupported-kind'] as const)('blocks an %s authored path', (variant) => {
    const { doc, plan } = fixture();
    doc.roadDefs = [
      {
        id: 'new-path',
        kind: 'path',
        points: [
          { x: 0, z: 0 },
          { x: 1, z: 1 },
        ],
      },
    ];
    if (variant === 'unsupported-kind') {
      Object.assign(doc.roadDefs[0], { kind: 'unknown-kind' });
      plan.roads = { edits: {}, additionIds: ['new-path'] };
    }
    const result = compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan);
    expect(result.issues.some((issue) => issue.id === 'roadDef:new-path')).toBe(true);
    expect(() => emitWorldLayoutModule(result, plan.sourceSha256)).toThrow('export blocked');
  });

  it('cannot activate the incomplete migration by deleting the handwritten pending list', () => {
    const result = compileWorldLayout(map, BUILTIN_WORLD, buildings, {
      ...review,
      environment: undefined,
      pending: [],
    });
    expect(result.issues.some((i) => i.id === 'layer:terrainEdits')).toBe(true);
    expect(result.issues.some((i) => i.id === 'scenery-baseline')).toBe(true);
    expect(result.unboundPlacementUids.length).toBeGreaterThan(0);
    expect(() => emitWorldLayoutModule(result, review.sourceSha256)).toThrow('export blocked');
  });

  it('exports a completely resolved building deterministically, including its fixed seat', () => {
    const { doc, plan } = fixture();
    const result = compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan);
    expect(result.issues).toEqual([]);
    expect(result.layout.buildings.fenbridge_gilded_strongbox.groundY).toBe(1.1168982661567985);
    expect(emitWorldLayoutModule(result, plan.sourceSha256)).toBe(
      emitWorldLayoutModule(
        compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan),
        plan.sourceSha256,
      ),
    );
  });

  it('rejects duplicate ids, unsupported transforms and stale bindings', () => {
    const { doc, plan } = fixture();
    doc.placements.push({ ...doc.placements[0] });
    doc.placements[0].scaleX = 2;
    doc.placements[1].scaleX = 2;
    const result = compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan);
    expect(result.issues.map((i) => i.reason)).toContain('Duplicate placement UID.');
    expect(result.issues.map((i) => i.reason)).toContain(
      'Town buildings require yaw-only rotation and uniform scale.',
    );
    plan.npcIds.push('missing_npc');
    expect(
      compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan).issues.some(
        (i) => i.id === 'missing_npc',
      ),
    ).toBe(true);
  });

  it.each([
    { rotX: 0.1 },
    { rotZ: 0.1 },
    { scaleX: 2 },
    { scaleY: 2 },
    { scaleZ: 2 },
    { scale: 22 },
    { detached: true, groundY: undefined },
    { collide: false },
    { collisionMode: 'basic' as const },
  ])('rejects an unsupported town transform %j', (edit) => {
    const { doc, plan } = fixture();
    Object.assign(doc.placements[0], edit);
    const result = compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan);
    expect(result.issues.some((i) => i.id === 'fenbridge_gilded_strongbox')).toBe(true);
    expect(() => emitWorldLayoutModule(result, plan.sourceSha256)).toThrow('export blocked');
  });

  it('requires an import or explicit preservation decision for every changed spatial record', () => {
    const { doc, plan } = fixture();
    doc.content.npcs.fury = { ...BUILTIN_WORLD.npcs.fury, pos: { x: 1, z: 2 } };
    doc.content.camps.push({ ...BUILTIN_WORLD.camps[0], center: { x: 1, z: 2 } });
    doc.content.objects.push({ ...BUILTIN_WORLD.groundObjects[0], positions: [{ x: 1, z: 2 }] });
    doc.objectMoves = { 'practiceDummy:healing_dummy_tank': { x: 1, z: 2, removed: true } };
    const result = compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan);
    const ids = result.issues.map((i) => i.id);
    expect(ids).toContain('npc:fury');
    expect(ids).toContain('camp:0');
    expect(ids).toContain('object:supply_crate:Stolen Supply Crate');
    expect(ids).toContain('practiceDummy:healing_dummy_tank');
    plan.preservedRecords = Object.fromEntries(
      ids.map((id) => [id, 'Keep the current game record for this reviewed source snapshot.']),
    );
    expect(compileWorldLayout(doc, BUILTIN_WORLD, buildings, plan).issues).toEqual([]);
  });

  it('requires separate approval for population and seeded spawn changes', () => {
    const result = compileWorldLayout(map, BUILTIN_WORLD, buildings, {
      ...review,
      campPopulationChanges: {},
      campSpawnMigrationReason: undefined,
    });
    expect(result.issues.filter((i) => i.id.startsWith('population:'))).toHaveLength(8);
    expect(result.issues.some((i) => i.id === 'camp-spawn-order')).toBe(true);
  });
});
