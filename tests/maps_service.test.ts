// MapsService (server/maps.ts): create/save/fork/publish rules against an
// in-memory MapsDb fake, mirroring the SocialService/FakeDb idiom in
// social_system.test.ts. No Postgres: the fake reproduces the db contract
// (cap check, slug unique violation, conditional version update, fork copy).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_MAPS_PER_ACCOUNT,
  type MapRecord,
  type MapStatus,
  type MapSummary,
  type MapsDb,
  MapsService,
  mapSlugBase,
  mapSummaryJson,
  mapsErrorStatus,
  normalizeMapName,
} from '../server/maps';
import type { MapDoc } from '../src/sim/map_doc';

function uniqueViolation(): Error {
  const err = new Error('duplicate key value violates unique constraint');
  (err as Error & { code: string }).code = '23505';
  return err;
}

class FakeMapsDb implements MapsDb {
  rows = new Map<number, MapRecord>();
  private nextId = 1;

  private countFor(accountId: number): number {
    return [...this.rows.values()].filter((m) => m.accountId === accountId).length;
  }

  private slugTaken(slug: string): boolean {
    return [...this.rows.values()].some((m) => m.slug === slug);
  }

  private summary(map: MapRecord): MapSummary {
    const { doc: _doc, ...rest } = map;
    return structuredClone(rest);
  }

  async insertMapCapped(
    input: { accountId: number; name: string; slug: string; doc: MapDoc },
    cap: number,
  ): Promise<MapRecord | null> {
    if (this.countFor(input.accountId) >= cap) return null;
    if (this.slugTaken(input.slug)) throw uniqueViolation();
    const now = new Date().toISOString();
    const map: MapRecord = {
      id: this.nextId++,
      accountId: input.accountId,
      name: input.name,
      slug: input.slug,
      doc: structuredClone(input.doc),
      version: 1,
      parentMapId: null,
      forkedFromVersion: null,
      status: 'private',
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(map.id, map);
    return structuredClone(map);
  }

  async insertForkCapped(
    input: { sourceId: number; accountId: number; name: string; slug: string; newDocId: string },
    cap: number,
  ): Promise<MapRecord | 'cap_reached' | 'source_unavailable'> {
    if (this.countFor(input.accountId) >= cap) return 'cap_reached';
    const source = this.rows.get(input.sourceId);
    if (!source || (source.status !== 'public' && source.accountId !== input.accountId)) {
      return 'source_unavailable';
    }
    if (this.slugTaken(input.slug)) throw uniqueViolation();
    const doc = structuredClone(source.doc);
    doc.meta.name = input.name;
    doc.meta.parentId = String(source.id);
    doc.meta.id = input.newDocId; // mirrors the jsonb_set meta.id rewrite in maps_db.ts
    const now = new Date().toISOString();
    const map: MapRecord = {
      id: this.nextId++,
      accountId: input.accountId,
      name: input.name,
      slug: input.slug,
      doc,
      version: 1,
      parentMapId: source.id,
      forkedFromVersion: source.version,
      status: 'private',
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(map.id, map);
    return structuredClone(map);
  }

  async getMap(id: number): Promise<MapRecord | null> {
    const map = this.rows.get(id);
    return map ? structuredClone(map) : null;
  }

  async listForAccount(accountId: number): Promise<MapSummary[]> {
    return [...this.rows.values()]
      .filter((m) => m.accountId === accountId)
      .map((m) => this.summary(m));
  }

  async listPublic(limit: number, offset: number): Promise<{ rows: MapSummary[]; total: number }> {
    const pub = [...this.rows.values()].filter((m) => m.status === 'public');
    return {
      rows: pub.slice(offset, offset + limit).map((m) => this.summary(m)),
      total: pub.length,
    };
  }

  async updateMapIfVersion(
    id: number,
    accountId: number,
    expectedVersion: number,
    doc: MapDoc,
    name: string | null,
  ): Promise<MapRecord | null> {
    const map = this.rows.get(id);
    if (!map || map.accountId !== accountId || map.version !== expectedVersion) return null;
    if (name !== null) map.name = name;
    map.doc = structuredClone(doc);
    map.doc.meta.name = map.name; // mirrors the jsonb_set name sync in maps_db.ts
    // mirrors the jsonb_set parentId sync: JSONB lineage always matches the column
    map.doc.meta.parentId = map.parentMapId === null ? '' : String(map.parentMapId);
    map.version += 1;
    map.updatedAt = new Date().toISOString();
    return structuredClone(map);
  }

  async setStatus(id: number, accountId: number | null, status: MapStatus): Promise<boolean> {
    const map = this.rows.get(id);
    if (!map || (accountId !== null && map.accountId !== accountId)) return false;
    map.status = status;
    return true;
  }

  async deleteMap(id: number, accountId: number): Promise<boolean> {
    const map = this.rows.get(id);
    if (!map || map.accountId !== accountId) return false;
    this.rows.delete(id);
    return true;
  }
}

// A raw (untrusted) document the sanitizer accepts: one usable zone, plus one
// valid and one garbage placement so the sanitizer's effect is observable.
function rawDoc(name = 'Test Map'): Record<string, unknown> {
  return {
    version: 2,
    meta: {
      id: 'local-1',
      name,
      description: '',
      createdAt: 1,
      updatedAt: 1,
      seed: 7,
      parentId: 'spoofed',
    },
    content: {
      zones: [{ id: 'z1', zMin: 0, zMax: 100, hub: { x: 0, z: 10 } }],
      camps: [],
      npcs: {},
      objects: [],
      roads: [],
    },
    terrainEdits: [{ x: 1, z: 2, radius: 5, delta: 3, falloff: 'smooth' }],
    placements: [
      { assetId: 'props/well', x: 1, z: 2, rotY: 0, scale: 1, collide: true },
      { assetId: 'props/bad', x: Number.NaN, z: 0, rotY: 0, scale: 1, collide: false },
    ],
  };
}

let db: FakeMapsDb;
let service: MapsService;
let suffixCounter = 0;

beforeEach(() => {
  db = new FakeMapsDb();
  suffixCounter = 0;
  service = new MapsService(db, () => `s${suffixCounter++}`);
});

async function createOk(accountId: number, name?: string): Promise<MapRecord> {
  const result = await service.createMap(accountId, name, rawDoc(name));
  if (!result.ok) throw new Error(`create failed: ${result.error}`);
  return result.map;
}

describe('MapsService.createMap', () => {
  it('creates a private v1 map with a slug from the name and a sanitized doc', async () => {
    const result = await service.createMap(1, 'My First Map', rawDoc());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.map.slug).toBe('my-first-map');
    expect(result.map.version).toBe(1);
    expect(result.map.status).toBe('private');
    expect(result.map.name).toBe('My First Map');
    // sanitizeMapDoc ran: the NaN placement is gone, the valid one kept
    expect(result.map.doc.placements).toHaveLength(1);
    expect(result.map.doc.placements[0].assetId).toBe('props/well');
    // the server owns the stored meta: name synced, spoofed lineage cleared
    expect(result.map.doc.meta.name).toBe('My First Map');
    expect(result.map.doc.meta.parentId).toBe('');
  });

  it('falls back to the document meta name when no name is supplied', async () => {
    const result = await service.createMap(1, undefined, rawDoc('Doc Named'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.map.name).toBe('Doc Named');
  });

  it('rejects an invalid name and an offensive name with distinct codes', async () => {
    expect(await service.createMap(1, 'x', rawDoc())).toEqual({
      ok: false,
      error: 'invalid_map_name',
    });
    expect(await service.createMap(1, 'Bad!Name', rawDoc())).toEqual({
      ok: false,
      error: 'invalid_map_name',
    });
    expect(await service.createMap(1, 'hitler fortress', rawDoc())).toEqual({
      ok: false,
      error: 'map_name_not_allowed',
    });
  });

  it('rejects an unsalvageable document', async () => {
    const doc = rawDoc();
    (doc.content as Record<string, unknown>).zones = [];
    expect(await service.createMap(1, 'Fine Name', doc)).toEqual({
      ok: false,
      error: 'invalid_map_doc',
    });
    expect(await service.createMap(1, 'Fine Name', 'not even json {{')).toEqual({
      ok: false,
      error: 'invalid_map_doc',
    });
  });

  it('enforces the per-account cap of 24 maps', async () => {
    for (let i = 0; i < MAX_MAPS_PER_ACCOUNT; i++) await createOk(1, `Map Number ${i}`);
    expect(await service.createMap(1, 'One Too Many', rawDoc())).toEqual({
      ok: false,
      error: 'map_limit_reached',
    });
    // another account is unaffected
    expect((await service.createMap(2, 'Other Account', rawDoc())).ok).toBe(true);
  });

  it('retries a taken slug with a suffix (unique-violation idiom)', async () => {
    const first = await createOk(1, 'Same Name');
    const second = await createOk(2, 'Same Name');
    expect(first.slug).toBe('same-name');
    expect(second.slug).toBe('same-name-s0');
  });

  it('gives up with slug_unavailable when every candidate is taken', async () => {
    const stuck = new MapsService(db, () => 'dup');
    await createOk(1, 'Same Name'); // takes 'same-name'
    const second = await stuck.createMap(2, 'Same Name', rawDoc()); // takes 'same-name-dup'
    expect(second.ok).toBe(true);
    expect(await stuck.createMap(3, 'Same Name', rawDoc())).toEqual({
      ok: false,
      error: 'slug_unavailable',
    });
  });
});

describe('MapsService.saveMap (optimistic concurrency)', () => {
  it('bumps the version on a matching save and keeps meta.name synced', async () => {
    const map = await createOk(1, 'Versioned');
    const saved = await service.saveMap(1, map.id, rawDoc(), 1);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.map.version).toBe(2);
    expect(saved.map.name).toBe('Versioned');
    expect(saved.map.doc.meta.name).toBe('Versioned');
  });

  it('answers a stale save with version_conflict and the current version', async () => {
    const map = await createOk(1, 'Versioned');
    await service.saveMap(1, map.id, rawDoc(), 1);
    const stale = await service.saveMap(1, map.id, rawDoc(), 1);
    expect(stale).toEqual({ ok: false, error: 'version_conflict', currentVersion: 2 });
  });

  it('rejects a missing or non-integer expected version', async () => {
    const map = await createOk(1, 'Versioned');
    expect(await service.saveMap(1, map.id, rawDoc(), undefined)).toEqual({
      ok: false,
      error: 'invalid_version',
    });
    expect(await service.saveMap(1, map.id, rawDoc(), 1.5)).toEqual({
      ok: false,
      error: 'invalid_version',
    });
    expect(await service.saveMap(1, map.id, rawDoc(), 0)).toEqual({
      ok: false,
      error: 'invalid_version',
    });
  });

  it('denies saving a map you do not own with the same 404 as a missing map', async () => {
    const map = await createOk(1, 'Owned By One');
    expect(await service.saveMap(2, map.id, rawDoc(), 1)).toEqual({
      ok: false,
      error: 'map_not_found',
    });
    expect(await service.saveMap(1, 999, rawDoc(), 1)).toEqual({
      ok: false,
      error: 'map_not_found',
    });
    // the denied save changed nothing
    expect(db.rows.get(map.id)?.version).toBe(1);
  });

  it('overwrites client-spoofed meta.parentId from the row lineage on save', async () => {
    // An original work: rawDoc() carries parentId 'spoofed', the row has none.
    const original = await createOk(1, 'Original Work');
    const saved = await service.saveMap(1, original.id, rawDoc(), 1);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.map.doc.meta.parentId).toBe('');
    // A fork: the stored lineage always matches the parent_map_id column.
    const fork = await service.forkMap(1, original.id);
    expect(fork.ok).toBe(true);
    if (!fork.ok) return;
    const forkSaved = await service.saveMap(1, fork.map.id, rawDoc(), 1);
    expect(forkSaved.ok).toBe(true);
    if (!forkSaved.ok) return;
    expect(forkSaved.map.doc.meta.parentId).toBe(String(original.id));
  });

  it('renames when a name is supplied and validates it', async () => {
    const map = await createOk(1, 'Old Name');
    const renamed = await service.saveMap(1, map.id, rawDoc(), 1, 'New Name');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.map.name).toBe('New Name');
    expect(renamed.map.doc.meta.name).toBe('New Name');
    expect(await service.saveMap(1, map.id, rawDoc(), 2, '!!!')).toEqual({
      ok: false,
      error: 'invalid_map_name',
    });
  });
});

describe('MapsService.forkMap (lineage)', () => {
  it('forks your own private map with parent and version lineage', async () => {
    const source = await createOk(1, 'Original Work');
    const fork = await service.forkMap(1, source.id);
    expect(fork.ok).toBe(true);
    if (!fork.ok) return;
    expect(fork.map.parentMapId).toBe(source.id);
    expect(fork.map.forkedFromVersion).toBe(1);
    expect(fork.map.version).toBe(1);
    expect(fork.map.status).toBe('private');
    expect(fork.map.doc.meta.parentId).toBe(String(source.id));
    expect(fork.map.slug).not.toBe(source.slug);
  });

  it('mints a fresh doc meta.id for the fork (never the source document identity)', async () => {
    const source = await createOk(1, 'Identity Source');
    const sourceDocId = db.rows.get(source.id)?.doc.meta.id ?? '';
    const fork = await service.forkMap(1, source.id);
    expect(fork.ok).toBe(true);
    if (!fork.ok) return;
    // The editor client keys its local server-links by meta.id: a fork that
    // kept the source's id would repoint the original map's link.
    expect(fork.map.doc.meta.id).not.toBe(sourceDocId);
    expect(fork.map.doc.meta.id.length).toBeGreaterThan(0);
    // Two forks of the same source get distinct identities too.
    const second = await service.forkMap(1, source.id);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.map.doc.meta.id).not.toBe(fork.map.doc.meta.id);
    // The source row is untouched.
    expect(db.rows.get(source.id)?.doc.meta.id).toBe(sourceDocId);
  });

  it('forks a PUBLIC map of another account and records the forked version', async () => {
    const source = await createOk(1, 'Shared Map');
    await service.saveMap(1, source.id, rawDoc(), 1);
    await service.saveMap(1, source.id, rawDoc(), 2); // version now 3
    await service.setPublished(1, source.id, true);
    const fork = await service.forkMap(2, source.id, 'My Copy');
    expect(fork.ok).toBe(true);
    if (!fork.ok) return;
    expect(fork.map.accountId).toBe(2);
    expect(fork.map.name).toBe('My Copy');
    expect(fork.map.parentMapId).toBe(source.id);
    expect(fork.map.forkedFromVersion).toBe(3);
  });

  it('denies forking a private map you do not own', async () => {
    const source = await createOk(1, 'Private Work');
    expect(await service.forkMap(2, source.id)).toEqual({ ok: false, error: 'map_not_found' });
    expect(await service.forkMap(2, 999)).toEqual({ ok: false, error: 'map_not_found' });
  });

  it('answers map_not_found when the source is unpublished mid-fork (race)', async () => {
    const source = await createOk(1, 'Was Public');
    // the access check sees a public map, but the atomic copy finds it private
    vi.spyOn(db, 'getMap').mockResolvedValueOnce({ ...source, status: 'public' });
    expect(await service.forkMap(2, source.id)).toEqual({ ok: false, error: 'map_not_found' });
  });

  it('enforces the per-account cap on fork too', async () => {
    const source = await createOk(1, 'Popular Map');
    await service.setPublished(1, source.id, true);
    for (let i = 0; i < MAX_MAPS_PER_ACCOUNT; i++) await createOk(2, `Filler Map ${i}`);
    expect(await service.forkMap(2, source.id)).toEqual({
      ok: false,
      error: 'map_limit_reached',
    });
  });
});

describe('publish / visibility / delete', () => {
  it('publish exposes a map in the public browse; unpublish removes it', async () => {
    const map = await createOk(1, 'Browsable');
    expect((await service.listPublic(1, 25)).total).toBe(0);
    expect(await service.setPublished(1, map.id, true)).toBe(true);
    const listed = await service.listPublic(1, 25);
    expect(listed.total).toBe(1);
    expect(listed.rows[0].slug).toBe('browsable');
    expect(await service.setPublished(1, map.id, false)).toBe(true);
    expect((await service.listPublic(1, 25)).total).toBe(0);
  });

  it('publish and delete are owner-only', async () => {
    const map = await createOk(1, 'Owner Only');
    expect(await service.setPublished(2, map.id, true)).toBe(false);
    expect(await service.deleteMap(2, map.id)).toBe(false);
    expect(db.rows.has(map.id)).toBe(true);
    expect(await service.deleteMap(1, map.id)).toBe(true);
    expect(db.rows.has(map.id)).toBe(false);
  });

  it('adminUnpublish forces any map private regardless of owner', async () => {
    const map = await createOk(1, 'Moderated');
    await service.setPublished(1, map.id, true);
    expect(await service.adminUnpublish(map.id)).toBe(true);
    expect(db.rows.get(map.id)?.status).toBe('private');
    expect(await service.adminUnpublish(999)).toBe(false);
  });

  it('getMapForViewer: owner always, others and anonymous only when public', async () => {
    const map = await createOk(1, 'Read Rules');
    expect(await service.getMapForViewer(1, map.id)).not.toBeNull();
    expect(await service.getMapForViewer(2, map.id)).toBeNull();
    expect(await service.getMapForViewer(null, map.id)).toBeNull();
    await service.setPublished(1, map.id, true);
    expect(await service.getMapForViewer(2, map.id)).not.toBeNull();
    expect(await service.getMapForViewer(null, map.id)).not.toBeNull();
  });

  it('listMine returns summaries without the document', async () => {
    await createOk(1, 'Mine A');
    await createOk(1, 'Mine B');
    await createOk(2, 'Not Mine');
    const mine = await service.listMine(1);
    expect(mine).toHaveLength(2);
    expect(mine.every((m) => !('doc' in m))).toBe(true);
  });
});

describe('helpers', () => {
  it('normalizeMapName trims, collapses whitespace, and bounds length', () => {
    expect(normalizeMapName('  My   Map  ')).toBe('My Map');
    expect(normalizeMapName("Del Mar's Rest-2")).toBe("Del Mar's Rest-2");
    expect(normalizeMapName('x')).toBeNull();
    expect(normalizeMapName('a'.repeat(61))).toBeNull();
    expect(normalizeMapName('a'.repeat(60))).toBe('a'.repeat(60));
    expect(normalizeMapName('-leading-hyphen')).toBeNull();
    expect(normalizeMapName('emoji \u{1F600} name')).toBeNull();
    expect(normalizeMapName(42)).toBeNull();
  });

  it('mapSlugBase mirrors the player-card slugify and never returns empty', () => {
    expect(mapSlugBase("Del Mar's Rest")).toBe('del-mar-s-rest');
    expect(mapSlugBase("''''")).toBe('map');
  });

  it('mapsErrorStatus maps codes onto the documented statuses', () => {
    expect(mapsErrorStatus('map_not_found')).toBe(404);
    expect(mapsErrorStatus('version_conflict')).toBe(409);
    expect(mapsErrorStatus('slug_unavailable')).toBe(409);
    expect(mapsErrorStatus('invalid_map_doc')).toBe(400);
    expect(mapsErrorStatus('map_limit_reached')).toBe(400);
  });

  it('mapSummaryJson never leaks the account id', async () => {
    const map = await createOk(7, 'No Leaks');
    expect(mapSummaryJson(map)).not.toHaveProperty('accountId');
    expect(mapSummaryJson(map)).not.toHaveProperty('account_id');
  });
});
