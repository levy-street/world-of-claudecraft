import { describe, expect, it } from 'vitest';
import {
  buildCharacterVisualOptions,
  buildMobCatalogOptions,
  catalogMatches,
} from '../src/editor/entity_authoring';
import { visualKeyFor } from '../src/render/characters/manifest';
import {
  applySessionCollisionOverride,
  boxesForAssetId,
  collisionOverrideFor,
} from '../src/sim/asset_collision';
import { resolveCampLevelRange } from '../src/sim/camp_authoring';
import { MOBS } from '../src/sim/data';
import { createNpc } from '../src/sim/entity';
import { sanitizeMapDoc } from '../src/sim/map_doc';

const ZONE = {
  id: 'z',
  name: 'Z',
  zMin: -10,
  zMax: 100,
  hub: { x: 0, z: 0, radius: 5, name: 'H' },
};

function rawDoc(content: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 2,
    meta: { id: 'authoring', name: 'Authoring', seed: 7 },
    content: { zones: [ZONE], camps: [], npcs: {}, objects: [], roads: [], ...content },
    terrainEdits: [],
    placements: [],
  };
}

describe('entity authoring catalogs', () => {
  it('builds a stable searchable inventory of every supplied rig key', () => {
    const rows = buildCharacterVisualOptions([
      'player_mage',
      'npc_knight',
      'mob_spider',
      'npc_knight',
    ]);
    expect(rows.map((row) => row.key)).toEqual(['mob_spider', 'npc_knight', 'player_mage']);
    expect(rows.find((row) => row.key === 'npc_knight')).toMatchObject({
      label: 'Knight',
      category: 'npc',
    });
    expect(catalogMatches('spid', rows[0].label, rows[0].key)).toBe(true);
  });

  it('surfaces combat and roster metadata for mob selection cards', () => {
    const template = MOBS.wild_boar;
    const rows = buildMobCatalogOptions({ wild_boar: template }, () => 'Wild Boar');
    expect(rows[0]).toMatchObject({
      id: 'wild_boar',
      label: 'Wild Boar',
      family: template.family,
      minLevel: template.minLevel,
      maxLevel: template.maxLevel,
    });
  });
});

describe('persisted NPC and mob authoring', () => {
  it('normalizes camp level overrides and preserves AI notes and VFX', () => {
    const doc = sanitizeMapDoc(
      rawDoc({
        camps: [
          {
            mobId: 'wild_boar',
            center: { x: 4, z: 8 },
            radius: 12,
            count: 4,
            levelMin: 18,
            levelMax: 7,
            authorVfx: { preset: 'fire', intensity: 9 },
            aiNotes: 'Protect the ruined gate.',
            questNotes: 'Credit the player after four kills.',
          },
        ],
      }),
    );
    expect(doc?.content.camps[0]).toMatchObject({
      levelMin: 7,
      levelMax: 18,
      authorVfx: { preset: 'fire', intensity: 3 },
      aiNotes: 'Protect the ruined gate.',
      questNotes: 'Credit the player after four kills.',
    });
    if (!doc) throw new Error('authoring document did not sanitize');
    expect(resolveCampLevelRange(doc.content.camps[0], MOBS.wild_boar)).toEqual({
      min: 7,
      max: 18,
      overridden: true,
    });
  });

  it('copies an authored NPC rig and VFX into the rendered entity', () => {
    const doc = sanitizeMapDoc(
      rawDoc({
        npcs: {
          guide: {
            id: 'guide',
            name: 'Mara',
            title: 'Wayfinder',
            pos: { x: 1, z: 2 },
            facing: 0,
            color: 0xffffff,
            questIds: [],
            greeting: 'Hello.',
            visualKey: 'npc_knight',
            authorVfx: { preset: 'holy', intensity: 1.5 },
            authorRole: 'Quest giver',
            aiNotes: 'Calm and direct.',
            questNotes: 'Introduces the zone.',
          },
        },
      }),
    );
    if (!doc) throw new Error('NPC authoring document did not sanitize');
    const npc = doc.content.npcs.guide;
    const entity = createNpc(9, npc, { x: 1, y: 0, z: 2 });
    expect(visualKeyFor(entity)).toBe('npc_knight');
    expect(entity.authorVfx).toEqual({ preset: 'holy', intensity: 1.5 });
    expect(npc.questNotes).toBe('Introduces the zone.');
  });
});

describe('live Collision Master saves', () => {
  it('uses the session override immediately without importing a new module', () => {
    const assetId = 'test/session_collision_override';
    const override = {
      mode: 'baked' as const,
      boxes: [{ x: 0, y: 1, z: 0, hx: 2, hy: 1, hz: 3 }],
    };
    applySessionCollisionOverride(assetId, override);
    expect(collisionOverrideFor(assetId)).toBe(override);
    expect(boxesForAssetId(assetId)?.[0]).toMatchObject({ hx: 2, hz: 3 });
    applySessionCollisionOverride(assetId, null);
    expect(collisionOverrideFor(assetId)).toBeNull();
  });
});
