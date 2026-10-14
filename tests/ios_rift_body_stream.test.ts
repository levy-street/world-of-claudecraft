// The iOS memory profile keeps the bodies only Rift content draws out of the
// unconditional post-entry stream and fetches them when a Rift or a Buried Hoard
// becomes reachable (src/render/characters/rift_body_stream_core.ts). Measured
// on an iPhone-impersonating Chrome at v0.44.0: those bodies cost 110 to 125 MB
// of ArrayBuffers at world entry while no overworld view ever draws them.
//
// Pinned here: the class is derived from content, covers every body only Rift
// content draws and never claims a body the overworld shares; the two lanes
// follow what each kind of content can spawn (natural Rifts never need the hoard
// lane); desktop and Android split exactly as before; the lanes are paced so
// they never crowd the post-entry stream; the trigger fires on the treasure map,
// a reachable entrance, or the player inside, and nowhere else; and the iOS
// post-entry creature stream stays under a stated on-disk budget.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  characterPreloadUrls,
  fallbackVisualKeys,
  mobKeyTemplateIds,
  VISUALS,
  type VisualDef,
  visualKeyFor,
  weaponSkinModelUrls,
} from '../src/render/characters/manifest';
import {
  characterStreamPlan,
  isStreamedBodyUrl,
  type RiftBodyDemand,
  type RiftBodyLaneHost,
  RiftBodyLanes,
  RiftBodyStreamTrigger,
  type RiftBodyStreamWorld,
  riftEntranceMinLevel,
  riftOnlyBodyLanes,
  riftOnlyVisualKeys,
  riftTemplateIds,
} from '../src/render/characters/rift_body_stream_core';
import { HOARD_MOBS, RIFT_MOBS } from '../src/sim/content/rift/mobs';
import { HOARD_MIN_LEVEL } from '../src/sim/content/treasure_maps';
import { MOBS, NPCS, RIFT_X_MIN } from '../src/sim/data';
import { RIFT_MIN_LEVEL } from '../src/sim/rift/portals';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { generateRiftFloor, riftFloorCount } from '../src/sim/rift/rift_gen';
import {
  HOARD_ENTRANCE_TEMPLATE_ID,
  makeVaultSeed,
  vaultSeedTier,
} from '../src/sim/rift/vault_seed';
import { ALL_CLASSES, type Entity, PLAYER_INTEREST_RADIUS } from '../src/sim/types';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const preload = characterPreloadUrls(false);
const skins = new Set(weaponSkinModelUrls());
const ios = characterStreamPlan(preload, skins, true);
const other = characterStreamPlan(preload, skins, false);
const bodies = preload.filter(isStreamedBodyUrl);

const defUrls = (def: VisualDef): string[] => [
  def.url,
  ...(def.animUrls ?? []),
  ...(def.attach ?? []).map((a) => a.url),
];
const mobKey = (templateId: string): string => visualKeyFor({ kind: 'mob', templateId } as Entity);
const rift = riftTemplateIds();
const nonRiftTemplates = [...new Set([...Object.keys(MOBS), ...mobKeyTemplateIds()])].filter(
  (id) => !rift.has(id),
);

describe('the Rift body class is derived from content', () => {
  it('holds exactly the hoard creature bodies the manifest ships today (a deliberate tripwire)', () => {
    // The classifier reads content, not file names; this list is the one place
    // a file name appears, as a tripwire: a new Rift body under another name,
    // or a hoard body the overworld starts drawing, fails here until the list
    // is updated on purpose. The rule itself is pinned by the witness tests below.
    const hoardBodies = bodies.filter((url) => url.includes('/hoard_')).sort();
    expect(hoardBodies.length).toBeGreaterThanOrEqual(28);
    expect([...ios.rift, ...ios.hoard].sort()).toEqual(hoardBodies);
  });

  it('leaves no body only Rift templates draw in the post-entry stream', () => {
    // Independent of the classifier: every body url a Rift template's visual
    // def references either rides a Rift lane, or has a WITNESS outside Rift
    // content that keeps it in the entry stream (a non-Rift template, a
    // fallback or NPC route drawing the same url).
    const sharedUrls = new Set<string>();
    for (const id of nonRiftTemplates) {
      for (const url of defUrls(VISUALS[mobKey(id)])) sharedUrls.add(url);
    }
    for (const key of fallbackVisualKeys()) {
      for (const url of defUrls(VISUALS[key])) sharedUrls.add(url);
    }
    const postEntry = new Set(ios.postEntry);
    const lanes = new Set([...ios.rift, ...ios.hoard]);
    let checked = 0;
    for (const id of rift) {
      for (const url of defUrls(VISUALS[mobKey(id)])) {
        if (!isStreamedBodyUrl(url)) continue;
        checked++;
        if (postEntry.has(url)) {
          expect(sharedUrls.has(url), `${url} (${id}) rides the entry stream with no witness`).toBe(
            true,
          );
        } else {
          expect(lanes.has(url), `${url} (${id})`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(28);
  });

  it('never moves a body the overworld draws out of the entry stream', () => {
    const laneUrls = new Set([...ios.rift, ...ios.hoard]);
    const reached: Array<[string, string]> = [];
    for (const id of nonRiftTemplates) reached.push([id, mobKey(id)]);
    for (const key of fallbackVisualKeys()) reached.push([`fallback ${key}`, key]);
    for (const id of Object.keys(NPCS)) {
      reached.push([`npc ${id}`, visualKeyFor({ kind: 'npc', templateId: id } as Entity)]);
    }
    for (const cls of ALL_CLASSES) {
      reached.push([`player ${cls}`, visualKeyFor({ kind: 'player', templateId: cls } as Entity)]);
    }
    for (const [route, key] of reached) {
      for (const url of defUrls(VISUALS[key])) {
        expect(laneUrls.has(url), `${url} is drawn by ${route}`).toBe(false);
      }
    }
    expect(reached.length).toBeGreaterThan(350);
    // Concrete witnesses the Rift content shares with the overworld.
    expect(riftOnlyVisualKeys().has('mob_spider_egg_sac')).toBe(false);
    expect(riftOnlyVisualKeys().has('skel_golem')).toBe(false);
    expect(ios.postEntry).toContain(VISUALS.mob_spider_egg_sac.url);
    expect(ios.postEntry).toContain(VISUALS.rift_ritualist.url);
  });

  it('names no Rift-only key anywhere but the manifest', () => {
    // A key built by hand (a form, a cutscene actor, a preview) bypasses the
    // template dispatch this class is derived from, so it would draw a body the
    // entry stream no longer holds.
    const srcRoot = fileURLToPath(new URL('../src', import.meta.url));
    const files = tsFilesUnder(srcRoot).filter((f) => f.file !== 'render/characters/manifest.ts');
    expect(files.length).toBeGreaterThan(2000);
    const keys = [...riftOnlyVisualKeys()];
    expect(keys.length).toBeGreaterThanOrEqual(28);
    for (const { file, full } of files) {
      const text = readFileSync(full, 'utf8');
      for (const key of keys) {
        expect(text.includes(`'${key}'`) || text.includes(`"${key}"`), `${file} names ${key}`).toBe(
          false,
        );
      }
    }
  });

  it('spawns Rift templates from Rift content only', () => {
    // The template half of "reachable only from Rift content": outside the
    // Rift modules, a Rift or Buried Hoard template id may appear only in the
    // two tables that credit their kills (hoard boss loot, Reliquary drop
    // pages), never in a camp, a dungeon, a quest, a summon or a server spawn.
    const allowed = new Set(['sim/content/hoard_loot.ts', 'sim/content/reliquary.ts']);
    const roots = [
      ['sim/', fileURLToPath(new URL('../src/sim', import.meta.url))],
      ['server/', fileURLToPath(new URL('../server', import.meta.url))],
    ] as const;
    let scanned = 0;
    for (const [prefix, root] of roots) {
      for (const { file, full } of tsFilesUnder(root)) {
        const path = `${prefix}${file}`;
        if (path.startsWith('sim/rift/') || path.startsWith('sim/content/rift/')) continue;
        if (allowed.has(path)) continue;
        scanned++;
        const text = readFileSync(full, 'utf8');
        for (const id of rift) {
          const named = new RegExp(`['"\`]${id}['"\`]|\\b${id}\\s*:`).test(text);
          expect(named, `${path} names the Rift template ${id}`).toBe(false);
        }
      }
    }
    expect(scanned).toBeGreaterThan(1000);
    expect(rift.size).toBeGreaterThanOrEqual(45);
  });

  it('reads the tree through the shared walker only', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});

describe('the two lanes follow what each kind of content spawns', () => {
  it('puts every body a Rift template draws in the Rift lane, and only Buried Hoard bodies in the hoard lane', () => {
    const riftDrawn = new Set<string>();
    for (const id of Object.keys(RIFT_MOBS)) {
      for (const url of defUrls(VISUALS[mobKey(id)])) riftDrawn.add(url);
    }
    const hoardDrawn = new Set<string>();
    for (const id of Object.keys(HOARD_MOBS)) {
      for (const url of defUrls(VISUALS[mobKey(id)])) hoardDrawn.add(url);
    }
    for (const url of ios.rift) expect(riftDrawn.has(url), url).toBe(true);
    for (const url of ios.hoard) {
      expect(riftDrawn.has(url), `${url} is drawn by a Rift template`).toBe(false);
      expect(hoardDrawn.has(url), url).toBe(true);
    }
    // Both lanes are populated today: natural Rifts draw part of the hoard_*
    // art (the themed trash and bosses), Buried Hoards alone draw the rest.
    expect(ios.rift.length).toBeGreaterThan(0);
    expect(ios.hoard.length).toBeGreaterThan(0);
    for (const [url, lane] of riftOnlyBodyLanes()) {
      expect(lane === 'rift' ? ios.rift : ios.hoard, url).toContain(url);
    }
  });

  it('never needs the hoard lane on a natural Rift floor', () => {
    // Every natural rank, a spread of seeds, every floor of each run: what the
    // floor spawns is a Rift template whose body rides the entry stream or the
    // Rift lane, never a Buried Hoard template or a hoard-lane body. Boss adds
    // are Rift templates too.
    const hoardLane = new Set(ios.hoard);
    const drawable = new Set([...ios.postEntry, ...ios.rift]);
    const spawned = new Set<string>();
    let floors = 0;
    for (const baseLevel of Object.values(RIFT_RANK_BASE_LEVEL)) {
      for (let n = 1; n <= 60; n++) {
        const seed = n * 7919;
        expect(vaultSeedTier(seed)).toBeNull();
        for (let f = 0; f < riftFloorCount(seed, baseLevel); f++) {
          floors++;
          for (const s of generateRiftFloor(seed, baseLevel, f).spawns) spawned.add(s.templateId);
        }
      }
    }
    expect(floors).toBeGreaterThan(500);
    for (const id of Object.keys(RIFT_MOBS)) {
      const add = RIFT_MOBS[id].summonAdds?.mobId;
      if (add) spawned.add(add);
    }
    for (const id of spawned) {
      expect(HOARD_MOBS[id], `${id} is a Buried Hoard template`).toBeUndefined();
      for (const url of defUrls(VISUALS[mobKey(id)])) {
        if (!isStreamedBodyUrl(url)) continue;
        expect(hoardLane.has(url), `${id} draws hoard-lane ${url}`).toBe(false);
        expect(drawable.has(url), `${id} draws ${url}`).toBe(true);
      }
    }
    // The themed trash and bosses really do draw Rift-lane bodies.
    expect([...spawned].some((id) => ios.rift.includes(VISUALS[mobKey(id)].url))).toBe(true);
  });
});

describe('the stream plan per profile', () => {
  it('keeps every non-iOS profile exactly as before: bodies gated, skins on demand', () => {
    expect(other.postEntry).toEqual([]);
    expect(other.rift).toEqual([]);
    expect(other.hoard).toEqual([]);
    expect(other.streamed).toEqual(preload.filter((url) => skins.has(url)));
  });

  it('streams every iOS body exactly once, in one of the three lanes', () => {
    expect(ios.streamed).toEqual(preload.filter((url) => skins.has(url) || isStreamedBodyUrl(url)));
    const all = [...ios.postEntry, ...ios.rift, ...ios.hoard];
    expect(all.sort()).toEqual([...bodies].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps the iOS post-entry creature stream under its on-disk budget', () => {
    // The iOS WebContent budget is about 1.5 GB whatever the device, WebGL
    // included, and this stream is resident on every iOS page life from its
    // first minutes. Measured at v0.44.0, a body in this stream costs about 3.2
    // times its size on disk in ArrayBuffers (the 36.3 MB of Rift bodies held
    // 110 to 125 MB at entry), and adding those bodies came with the iOS
    // silent-kill rate rising from 21 to 35 percent of page lives. The bound is
    // the overworld creature set the fleet already carried before them (38.1 MB
    // on disk at v0.45.0) plus about 10 percent: room for a few new creatures,
    // never for a drop the size of the Rift set. Crossing it means choosing a
    // trigger for the new bodies (like the Rift lanes) or raising the bound on a
    // measured entry A/B, never raising it on sight.
    const IOS_POST_ENTRY_CREATURE_STREAM_MAX_MB = 42;
    const bytes = ios.postEntry.reduce(
      (sum, url) =>
        sum + statSync(fileURLToPath(new URL(`../public/${url}`, import.meta.url))).size,
      0,
    );
    const mb = bytes / (1024 * 1024);
    expect(mb).toBeGreaterThan(20);
    expect(mb, `iOS post-entry creature stream is ${mb.toFixed(1)} MB on disk`).toBeLessThanOrEqual(
      IOS_POST_ENTRY_CREATURE_STREAM_MAX_MB,
    );
  });
});

interface FakeFetch {
  url: string;
  resolve: () => void;
  reject: () => void;
}

function fakeHost(postEntry = true) {
  const fetches: FakeFetch[] = [];
  const started: string[] = [];
  let postEntryStarted = postEntry;
  const host: RiftBodyLaneHost = {
    fetch: (url) =>
      new Promise<void>((resolve, reject) => {
        fetches.push({ url, resolve, reject: () => reject(new Error('404')) });
      }),
    postEntryStarted: () => postEntryStarted,
    onLaneStart: (lane) => started.push(lane),
  };
  return {
    host,
    fetches,
    started,
    kickPostEntry: () => {
      postEntryStarted = true;
    },
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const demand = (d: Partial<RiftBodyDemand>): RiftBodyDemand => ({
  rift: false,
  hoard: false,
  inside: false,
  ...d,
});

describe('the lanes are paced behind the post-entry stream', () => {
  it('holds one fetch in flight and walks the Rift lane before the hoard lane', async () => {
    const h = fakeHost();
    const lanes = new RiftBodyLanes(h.host);
    lanes.setUrls(['r1', 'r2'], ['h1']);
    lanes.demand(demand({ rift: true, hoard: true }));
    lanes.demand(demand({ rift: true, hoard: true }));
    expect(h.fetches.map((f) => f.url)).toEqual(['r1']);
    h.fetches[0].resolve();
    await flush();
    expect(h.fetches.map((f) => f.url)).toEqual(['r1', 'r2']);
    h.fetches[1].reject();
    await flush();
    // A failed body is left to the build-miss path: the lane moves on.
    expect(h.fetches.map((f) => f.url)).toEqual(['r1', 'r2', 'h1']);
    h.fetches[2].resolve();
    await flush();
    expect(lanes.pending()).toBe(false);
    expect(h.started).toEqual(['rift', 'hoard']);
  });

  it('waits for the post-entry stream to be queued first, unless the player is inside', async () => {
    const h = fakeHost(false);
    const lanes = new RiftBodyLanes(h.host);
    lanes.setUrls(['r1'], []);
    lanes.demand(demand({ rift: true }));
    expect(h.fetches).toEqual([]);
    h.kickPostEntry();
    lanes.demand(demand({ rift: true }));
    expect(h.fetches.map((f) => f.url)).toEqual(['r1']);

    const inside = fakeHost(false);
    const urgent = new RiftBodyLanes(inside.host);
    urgent.setUrls(['r1'], []);
    urgent.demand(demand({ rift: true, inside: true }));
    expect(inside.fetches.map((f) => f.url)).toEqual(['r1']);
  });

  it('never fetches a hoard-lane body for a natural Rift', async () => {
    const h = fakeHost();
    const lanes = new RiftBodyLanes(h.host);
    lanes.setUrls(['r1'], ['h1']);
    lanes.demand(demand({ rift: true }));
    h.fetches[0].resolve();
    await flush();
    expect(h.fetches.map((f) => f.url)).toEqual(['r1']);
    expect(lanes.pending()).toBe(true);
  });

  it('restarts a lane walk when a profile change hands it a new list', async () => {
    const h = fakeHost();
    const lanes = new RiftBodyLanes(h.host);
    lanes.setUrls(['r1'], []);
    lanes.demand(demand({ rift: true }));
    h.fetches[0].resolve();
    await flush();
    expect(lanes.pending()).toBe(false);
    lanes.setUrls(['r1'], []);
    expect(lanes.pending()).toBe(false);
    lanes.setUrls(['r1', 'r3'], []);
    expect(lanes.pending()).toBe(true);
  });

  it('has nothing to do on a profile whose lanes are empty', () => {
    const lanes = new RiftBodyLanes(fakeHost().host);
    lanes.setUrls(other.rift, other.hoard);
    expect(lanes.pending()).toBe(false);
  });
});

interface FakeEntity {
  id: number;
  kind: string;
  templateId: string;
  pos: { x: number; z: number };
}

type FakeWorld = RiftBodyStreamWorld & {
  player: { level: number; pos: { x: number; z: number } };
  entityRosterVersion: number;
};

function fakeWorld(
  entities: FakeEntity[],
  opts: {
    level?: number;
    x?: number;
    riftFloor?: { seed: number } | null;
    map?: boolean;
    roster?: number;
  } = {},
): FakeWorld {
  return {
    riftFloor: opts.riftFloor ?? null,
    treasureMap: opts.map ? { rarity: 'rare', siteId: 'site' } : null,
    player: { level: opts.level ?? RIFT_MIN_LEVEL, pos: { x: opts.x ?? 0, z: 0 } },
    entities: new Map(entities.map((e) => [e.id, e])),
    entityRosterVersion: opts.roster ?? 1,
  };
}

const entranceAt = (x: number, templateId = 'rift_portal'): FakeEntity => ({
  id: 7,
  kind: 'object',
  templateId,
  pos: { x, z: 0 },
});

const demandOf = (world: RiftBodyStreamWorld) => {
  const d = new RiftBodyStreamTrigger({ pending: () => true, demand: () => {} }).demandOf(world);
  return { rift: d.rift, hoard: d.hoard, inside: d.inside };
};
const natural = { rift: true, hoard: false, inside: false };
const hoard = { rift: true, hoard: true, inside: false };
const none = { rift: false, hoard: false, inside: false };

describe('the trigger', () => {
  it('asks for both lanes from the moment a treasure map is read, at the level that can enter', () => {
    expect(demandOf(fakeWorld([], { map: true, level: HOARD_MIN_LEVEL }))).toEqual(hoard);
    expect(demandOf(fakeWorld([], { map: true, level: HOARD_MIN_LEVEL - 1 }))).toEqual(none);
    expect(demandOf(fakeWorld([], { level: 60 }))).toEqual(none);
  });

  it('asks a natural Rift portal for the Rift lane only, inside the interest radius', () => {
    const r = PLAYER_INTEREST_RADIUS;
    expect(demandOf(fakeWorld([entranceAt(r)]))).toEqual(natural);
    expect(demandOf(fakeWorld([entranceAt(r + 1)]))).toEqual(none);
    expect(demandOf(fakeWorld([entranceAt(10)], { level: RIFT_MIN_LEVEL - 1 }))).toEqual(none);
    expect(demandOf(fakeWorld([entranceAt(10, 'dungeon_door')], { level: 60 }))).toEqual(none);
  });

  it('asks a Buried Hoard entrance for both lanes (the digger party, who hold no map)', () => {
    const at = entranceAt(10, HOARD_ENTRANCE_TEMPLATE_ID);
    expect(demandOf(fakeWorld([at], { level: HOARD_MIN_LEVEL }))).toEqual(hoard);
    expect(demandOf(fakeWorld([at], { level: HOARD_MIN_LEVEL - 1 }))).toEqual(none);
    expect(riftEntranceMinLevel('rift_portal')).toBe(RIFT_MIN_LEVEL);
    expect(riftEntranceMinLevel(HOARD_ENTRANCE_TEMPLATE_ID)).toBe(HOARD_MIN_LEVEL);
    expect(riftEntranceMinLevel('rift_exit')).toBeNull();
  });

  it('asks from inside: the Rift lane at once, the hoard lane once the floor names a hoard', () => {
    const vaultSeed = makeVaultSeed(1, 12345);
    expect(vaultSeedTier(vaultSeed)).not.toBeNull();
    // A login on the spot, before the first floor state lands: the position.
    expect(demandOf(fakeWorld([], { x: RIFT_X_MIN, level: 1 }))).toEqual({
      ...natural,
      inside: true,
    });
    expect(demandOf(fakeWorld([], { x: RIFT_X_MIN, riftFloor: { seed: 424242 } }))).toEqual({
      ...natural,
      inside: true,
    });
    expect(demandOf(fakeWorld([], { x: RIFT_X_MIN, riftFloor: { seed: vaultSeed } }))).toEqual({
      ...hoard,
      inside: true,
    });
  });

  it('fires on the frame a player levels up while already standing in range', () => {
    const asked: RiftBodyDemand[] = [];
    const trigger = new RiftBodyStreamTrigger({
      pending: () => true,
      demand: (d) => asked.push({ ...d }),
    });
    const world = fakeWorld([entranceAt(30)], { level: RIFT_MIN_LEVEL - 1, roster: 4 });
    trigger.update(world);
    expect(asked).toEqual([]);
    world.player.level = RIFT_MIN_LEVEL;
    trigger.update(world);
    expect(asked).toEqual([natural]);
  });

  it('re-lists entrances when the roster changes', () => {
    const trigger = new RiftBodyStreamTrigger({ pending: () => true, demand: () => {} });
    expect(trigger.demandOf(fakeWorld([], { roster: 1 })).rift).toBe(false);
    expect(trigger.demandOf(fakeWorld([entranceAt(20)], { roster: 2 })).rift).toBe(true);
  });

  it('never reads the world while the lanes have nothing to start', () => {
    // Every non-iOS profile, and iOS once both lanes walked: one call a frame.
    const trigger = new RiftBodyStreamTrigger({
      pending: () => false,
      demand: () => {
        throw new Error('demand');
      },
    });
    const world = fakeWorld([entranceAt(10)], { map: true });
    for (const key of ['entities', 'player', 'riftFloor', 'treasureMap'] as const) {
      Object.defineProperty(world, key, {
        get() {
          throw new Error(`${key} read`);
        },
      });
    }
    expect(() => trigger.update(world)).not.toThrow();
  });
});

describe('the client loop wires the trigger', () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
  const mainSource = read('../src/main.ts');
  const assetsSource = read('../src/render/characters/assets.ts');

  it('polls the lanes every ticking frame through one call', () => {
    const frameAt = mainSource.indexOf('function frame(now: number): void {');
    const pollAt = mainSource.indexOf('pollRiftCharacterStream(world);', frameAt);
    const tickGateAt = mainSource.indexOf('if (!gate.tick) {', frameAt);
    expect(frameAt).toBeGreaterThan(-1);
    expect(tickGateAt).toBeGreaterThan(frameAt);
    expect(pollAt).toBeGreaterThan(tickGateAt);
    expect(mainSource.split('pollRiftCharacterStream').length - 1).toBe(2);
  });

  it('paces the lanes behind the post-entry kick and keeps them re-armable', () => {
    // A lane body stays out of the boot gate on iOS and inside streamedUrlSet,
    // so a view that asks before its lane reaches it (or after a failed fetch)
    // kicks the fetch itself through resolvedGltf, then waits behind the live
    // compile gate like every streamed body.
    expect(assetsSource).toContain('postEntryStarted: () => streamedStarted,');
    expect(assetsSource).toContain(
      'riftLanes.setUrls(initialStreamPlan.rift, initialStreamPlan.hoard);',
    );
    expect(assetsSource).toContain('riftLanes.setUrls(nextPlan.rift, nextPlan.hoard);');
    expect(assetsSource).toContain(
      'if (streamedUrlSet.has(url) || lazyOnDemandUrls.has(url)) ensureCharacterUrl(url);',
    );
  });
});
