// Verification harness for a local Scorching Wastes map bundle
// (scorching-wastes-trunk-collision.wocmap.zip, the latest build; point the
// WOC_SCORCHING_WASTES_BUNDLE env var at it, it is not checked in).
// Reads map.json out of the zip, runs it through the real sanitizer, projects
// it to WorldContent, boots the real Sim, and checks spawn integrity,
// walkability of quest-critical positions, water carving, asset validity, and
// quest-chain reachability (every NPC quest id, giver, turn-in, kill target,
// and collect/interact source resolves) -- i.e. that the quests are wired up.
// Skips cleanly when the bundle is absent, so it is safe to keep in tests/.
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { assetById } from '../src/editor/asset_catalog.generated';
import { zipRead } from '../src/editor/bundle';
import { customMapToWorldContent } from '../src/editor/custom_map';
import { MOBS, QUESTS, SPIRIT_HEALER_NPC_ID, setActiveWorldContent } from '../src/sim/data';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { Sim } from '../src/sim/sim';
import { terrainHeight, terrainSteepness } from '../src/sim/world';

const BUNDLE_PATH = process.env.WOC_SCORCHING_WASTES_BUNDLE ?? '';
const CLIMB_LIMIT = 1.5; // mirrors tests/terrain_walls.test.ts
const SEED = 20061;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe('scorching wastes generated map', () => {
  if (!existsSync(BUNDLE_PATH)) {
    it.skip('scorching-wastes.wocmap.zip not present', () => {});
    return;
  }
  const bundle = zipRead(new Uint8Array(readFileSync(BUNDLE_PATH))) ?? [];
  const entry = bundle.find((f) => f.path === 'map.json');
  const raw = JSON.parse(new TextDecoder().decode(entry!.bytes));
  const doc = sanitizeMapDoc(raw);

  afterEach(() => setActiveWorldContent(null));

  it('sanitizes without dropping content', () => {
    expect(doc).toBeTruthy();
    const d = doc as Any;
    expect(d.terrainEdits.length).toBe(raw.terrainEdits.length);
    expect(d.placements.length).toBe(raw.placements.length);
    expect(d.content.camps.length).toBe(raw.content.camps.length);
    expect(Object.keys(d.content.npcs).length).toBe(Object.keys(raw.content.npcs).length);
    expect(d.content.objects.length).toBe(raw.content.objects.length);
    expect(d.content.roads.length).toBe(raw.content.roads.length);
    expect(d.lights.length).toBe(raw.lights.length);
    expect(d.locations.length).toBe(raw.locations.length);
    expect(d.markers.length).toBe(raw.markers.length);
    expect(d.biomePaint.custom.length).toBe(raw.biomePaint.custom.length);
    expect(d.biomePaint.ids.length).toBe(raw.biomePaint.ids.length);
    expect(d.waterLevel).toBe(raw.waterLevel);
    expect(d.playerStart).toEqual(raw.playerStart);
  });

  it('every placement assetId resolves (catalog, collider, waterfall, grass)', () => {
    const bad: string[] = [];
    for (const p of (doc as Any).placements) {
      const id: string = p.assetId;
      if (id.startsWith('collider/') || id === 'water/waterfall' || id === 'grass/patch') continue;
      if (!assetById(id)) bad.push(id);
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it('every camp mob and npc quest id resolves in the registries', () => {
    const problems: string[] = [];
    for (const c of (doc as Any).content.camps) {
      if (!MOBS[c.mobId]) problems.push(`camp mob ${c.mobId}`);
    }
    for (const npc of Object.values((doc as Any).content.npcs) as Any[]) {
      for (const q of npc.questIds) if (!QUESTS[q]) problems.push(`${npc.id}: quest ${q}`);
    }
    expect(problems).toEqual([]);
  });

  it('quest chain is completable on this map (givers, targets, sources)', () => {
    const d = doc as Any;
    const npcIds = new Set(Object.keys(d.content.npcs));
    const campMobs = new Set(d.content.camps.map((c: Any) => c.mobId));
    // summoned adds count as killable too
    for (const mobId of [...campMobs]) {
      const t = MOBS[mobId as string] as Any;
      if (t?.summonAdds) campMobs.add(t.summonAdds.mobId);
    }
    const objectItems = new Set(d.content.objects.map((o: Any) => o.itemId));
    const lootable = new Set<string>();
    for (const mobId of campMobs) {
      for (const l of (MOBS[mobId as string]?.loot ?? []) as Any[]) {
        if (l.itemId) lootable.add(l.itemId);
      }
    }
    const problems: string[] = [];
    const swQuests = Object.values(QUESTS).filter((q) => q.id.startsWith('q_sw_'));
    expect(swQuests.length).toBe(20);
    for (const q of swQuests) {
      if (!npcIds.has(q.giverNpcId)) problems.push(`${q.id}: giver ${q.giverNpcId} not on map`);
      if (!npcIds.has(q.turnInNpcId)) problems.push(`${q.id}: turn-in ${q.turnInNpcId} not on map`);
      for (const o of q.objectives as Any[]) {
        if (o.type === 'kill' && !campMobs.has(o.targetMobId)) {
          problems.push(`${q.id}: no camp spawns ${o.targetMobId}`);
        }
        if (o.type === 'collect' && !lootable.has(o.itemId) && !objectItems.has(o.itemId)) {
          problems.push(`${q.id}: ${o.itemId} unobtainable on map`);
        }
        if (
          o.type === 'interact' &&
          o.targetObjectItemId &&
          !objectItems.has(o.targetObjectItemId)
        ) {
          problems.push(`${q.id}: object ${o.targetObjectItemId} not placed`);
        }
        if (o.type === 'interact' && o.targetNpcId && !npcIds.has(o.targetNpcId)) {
          problems.push(`${q.id}: interact npc ${o.targetNpcId} not on map`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('boots the Sim: pale keeper at spawn, all camps + npcs + sparkles live', () => {
    const content = customMapToWorldContent(doc as Any);
    setActiveWorldContent(content);
    const sim = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      autoEquip: true,
      world: content,
    }) as Any;
    // ticks run without throwing
    for (let i = 0; i < 50; i++) sim.tick();
    const ents = [...sim.entities.values()];
    const keepers = ents.filter(
      (e: Any) => e.kind === 'npc' && e.templateId === SPIRIT_HEALER_NPC_ID,
    );
    expect(keepers.length).toBe(1);
    const d = doc as Any;
    // every authored NPC stands in the world
    for (const id of Object.keys(d.content.npcs)) {
      expect(
        ents.some((e: Any) => e.kind === 'npc' && e.templateId === id),
        `npc ${id} spawned`,
      ).toBe(true);
    }
    // every camp put its mobs on the field
    const byMob = new Map<string, number>();
    for (const e of ents) {
      if (e.kind === 'mob') byMob.set(e.templateId, (byMob.get(e.templateId) ?? 0) + 1);
    }
    for (const c of d.content.camps) {
      expect(byMob.get(c.mobId) ?? 0, `camp mob ${c.mobId}`).toBeGreaterThan(0);
    }
    // ground sparkles all present
    const sparkles = ents.filter((e: Any) => String(e.templateId ?? '').startsWith('ground_'));
    const expected = d.content.objects.reduce((a: number, o: Any) => a + o.positions.length, 0);
    expect(sparkles.length).toBe(expected);
  });

  it('quest-critical positions are walkable and dry; ponds hold water', () => {
    const content = customMapToWorldContent(doc as Any);
    setActiveWorldContent(content);
    const d = doc as Any;
    const problems: string[] = [];
    const check = (x: number, z: number, label: string) => {
      const steep = terrainSteepness(x, z, SEED);
      if (steep > CLIMB_LIMIT)
        problems.push(`${label} at (${x},${z}) too steep (${steep.toFixed(2)})`);
      const h = terrainHeight(x, z, SEED);
      if (h < d.waterLevel - 0.4)
        problems.push(`${label} at (${x},${z}) underwater (h=${h.toFixed(2)})`);
    };
    for (const npc of Object.values(d.content.npcs) as Any[])
      check(npc.pos.x, npc.pos.z, `npc ${npc.id}`);
    for (const c of d.content.camps) check(c.center.x, c.center.z, `camp ${c.mobId}`);
    for (const o of d.content.objects) {
      for (const p of o.positions) check(p.x, p.z, `object ${o.itemId}`);
    }
    for (const [ri, road] of d.content.roads.entries()) {
      for (let i = 0; i + 1 < road.length; i++) {
        const a = road[i];
        const b = road[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 6));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const h = terrainHeight(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, SEED);
          if (h < d.waterLevel - 0.4) {
            problems.push(
              `road ${ri} underwater near (${(a.x + (b.x - a.x) * t).toFixed(0)},${(a.z + (b.z - a.z) * t).toFixed(0)})`,
            );
          }
        }
      }
    }
    check(d.playerStart.x, d.playerStart.z, 'playerStart');
    expect(problems).toEqual([]);
    // the three water bodies are genuinely below the water plane
    for (const [x, z, label] of [
      [0, 108, 'hub oasis pond'],
      [0, 62, 'heartspring pool'],
      [178, -52, 'mirror of kings'],
    ] as [number, number, string][]) {
      expect(terrainHeight(x, z, SEED), label).toBeLessThan(d.waterLevel - 0.5);
    }
    // the falls shelf is high and dry with a spring bowl on top
    expect(terrainHeight(0, 10, SEED)).toBeGreaterThan(10);
  });
});
