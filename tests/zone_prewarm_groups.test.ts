// Paired test for src/render/zone_prewarm_groups.ts: drives all four extracted
// builders (buildEntityPrewarmGroup, buildNpcPrewarmGroup,
// buildPlayerPrewarmGroup, buildObjectPrewarmGroup) through a fake
// ZonePrewarmGroupHost so their contracts are pinned by behavior (the
// prewarm_policy source pin proves the NPC rule only by text order, and the
// untyped host seam removed the compiler's reach). createCharacterVisual and
// buildGroundQuestObject are mocked so the asset-unavailable arm and the build
// counts are controllable from the test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PooledObjectView } from '../src/render/ground_object_pool';
import {
  buildEntityPrewarmGroup,
  buildNpcPrewarmGroup,
  buildObjectPrewarmGroup,
  buildPlayerPrewarmGroup,
  PREWARM_MOB_POOL_COPIES,
  PREWARM_OBJECT_ITEM_IDS,
  PREWARM_OBJECT_POOL_COPIES,
  type ZonePrewarmGroupHost,
} from '../src/render/zone_prewarm_groups';
import { ALL_CLASSES, type Entity, type ZoneDef } from '../src/sim/types';
import { stripComments } from './helpers/strip_comments';

const state = vi.hoisted(() => ({
  createCalls: [] as string[],
  createForms: [] as (string | undefined)[],
  activeCalls: [] as string[],
  auraGlowCalls: [] as string[],
  unavailable: new Set<string>(),
  modelKeys: {} as Record<string, string>,
  buildQuestObject: null as ((itemId: string, id: number) => unknown) | null,
}));

vi.mock('../src/render/characters', async () => {
  const MockThree = await import('three');
  return {
    createCharacterVisual: (entity: Pick<Entity, 'templateId'>, form?: string) => {
      state.createCalls.push(entity.templateId);
      state.createForms.push(form);
      if (state.unavailable.has(entity.templateId)) return null;
      return {
        root: new MockThree.Object3D(),
        setActive: (on: boolean) => state.activeCalls.push(`${entity.templateId}:${on}`),
        setAuraGlow: () => state.auraGlowCalls.push(entity.templateId),
      };
    },
  };
});

// The builder dedups by model key; the mapping is test-owned so two npc ids can
// share one model on demand. skinCount feeds the player builder: one variant
// per class keeps the plannedVisuals arithmetic legible below.
vi.mock('../src/render/characters/manifest', () => ({
  skinCount: () => 1,
  visualKeyFor: (entity: Pick<Entity, 'templateId'>) =>
    state.modelKeys[entity.templateId] ?? `model:${entity.templateId}`,
}));

// Static records under test control: three NPC ids, one PREWARM_MOB_COMMON_IDS
// member (forest_wolf) and one uncommon mob for the copy-count split.
vi.mock('../src/sim/data', () => ({
  CLASSES: { warlock: { color: 0x8844cc } },
  MOBS: {
    forest_wolf: { id: 'forest_wolf', color: 0x445566, scale: 1 },
    rare_oddity: { id: 'rare_oddity', color: 0x665544, scale: 1.2 },
  },
  NPCS: {
    npc_guard: { id: 'npc_guard', color: 0x111111 },
    npc_knight: { id: 'npc_knight', color: 0x222222 },
    npc_mage: { id: 'npc_mage', color: 0x333333 },
  },
}));

// Only the object builder reaches quest objects; the impl is test-injected so
// importing the module under test never touches the asset pipeline.
vi.mock('../src/render/quest_objects', () => ({
  buildGroundQuestObject: (itemId: string, id: number) => {
    if (!state.buildQuestObject) throw new Error('buildQuestObject not stubbed');
    return state.buildQuestObject(itemId, id);
  },
}));

const ZONE = { id: 'test_zone' } as ZoneDef;
const NO_DEADLINE = Number.MAX_SAFE_INTEGER;

const makeHost = (npcIds: string[]): ZonePrewarmGroupHost => ({
  sim: { player: { pos: { x: 3, y: 1, z: -2 } } },
  prewarmEntity: (kind, templateId, color, scale, skin = 0, id = -10_000) =>
    ({ kind, templateId, color, scale, skin, id }) as unknown as Entity,
  storePooledObject: () => {},
  templateIdsInZone: () => npcIds,
  prewarmedMobTemplates: new Set<string>(),
  prewarmedNpcModels: new Set<string>(),
});

beforeEach(() => {
  state.createCalls.length = 0;
  state.createForms.length = 0;
  state.activeCalls.length = 0;
  state.auraGlowCalls.length = 0;
  state.unavailable.clear();
  state.modelKeys = {};
  state.buildQuestObject = null;
});

describe('buildNpcPrewarmGroup warmed/planned/trimmed semantics', () => {
  it('leaves an asset-skipped id uncounted and its model unmarked, so a later pass retries it', () => {
    state.unavailable.add('npc_guard');
    const host = makeHost(['npc_guard', 'npc_knight']);
    const built = buildNpcPrewarmGroup(host, ZONE, NO_DEADLINE);
    expect(built.planned).toBe(2);
    expect(built.warmed).toBe(1);
    expect(built.trimmed).toBe(false);
    expect(host.prewarmedNpcModels.has('model:npc_knight')).toBe(true);
    expect(host.prewarmedNpcModels.has('model:npc_guard')).toBe(false);
    // The skipped id stays retryable: with the asset available, the same host
    // warms it on the next zone preparation and the count reaches planned.
    state.unavailable.clear();
    const retry = buildNpcPrewarmGroup(host, ZONE, NO_DEADLINE);
    expect(retry.warmed).toBe(2);
    expect(host.prewarmedNpcModels.has('model:npc_guard')).toBe(true);
  });

  it('counts each id sharing a model as done while building the shared visual once', () => {
    state.modelKeys = { npc_knight: 'model:shared', npc_mage: 'model:shared' };
    const host = makeHost(['npc_knight', 'npc_mage']);
    const built = buildNpcPrewarmGroup(host, ZONE, NO_DEADLINE);
    expect(built.warmed).toBe(2);
    expect(built.planned).toBe(2);
    expect(state.createCalls).toEqual(['npc_knight']);
    expect(built.pooled).toHaveLength(1);
    expect(built.pooled[0].key).toBe('npc:npc_knight:0');
    expect(built.group.children).toHaveLength(1);
  });

  it('counts an id with no static NPC record done with nothing built', () => {
    const host = makeHost(['dynamic_only_template']);
    const built = buildNpcPrewarmGroup(host, ZONE, NO_DEADLINE);
    expect(built.warmed).toBe(1);
    expect(built.planned).toBe(1);
    expect(state.createCalls).toEqual([]);
    expect(built.group.children).toHaveLength(0);
  });

  it('reports a deadline trim with the remainder unwarmed instead of masquerading as complete', () => {
    const host = makeHost(['npc_guard', 'npc_knight']);
    const built = buildNpcPrewarmGroup(host, ZONE, 0);
    expect(built.trimmed).toBe(true);
    expect(built.warmed).toBe(0);
    expect(built.planned).toBe(2);
    expect(host.prewarmedNpcModels.size).toBe(0);
  });
});

describe('buildEntityPrewarmGroup copy counts and session dedupe', () => {
  it('pools a PREWARM_MOB_COMMON_IDS template several-deep and every other template once', () => {
    // forest_wolf is in the common set (group spawner), rare_oddity is not:
    // the copy split is the pool-depth rule the extraction carried over.
    const host = makeHost(['forest_wolf', 'rare_oddity']);
    const built = buildEntityPrewarmGroup(host, ZONE);
    // Decisiveness floor: at 1 copy the split this case is named for
    // collapses and every assertion below passes vacuously.
    expect(PREWARM_MOB_POOL_COPIES).toBeGreaterThan(1);
    expect(state.createCalls.filter((id) => id === 'forest_wolf')).toHaveLength(
      PREWARM_MOB_POOL_COPIES,
    );
    expect(state.createCalls.filter((id) => id === 'rare_oddity')).toHaveLength(1);
    expect(built.group.children).toHaveLength(PREWARM_MOB_POOL_COPIES + 1);
    expect(host.prewarmedMobTemplates.has('forest_wolf')).toBe(true);
    expect(host.prewarmedMobTemplates.has('rare_oddity')).toBe(true);
  });

  it('skips templates the session already warmed (prewarmedMobTemplates dedupe)', () => {
    // The per-template set is HOST-owned and persists across transitions, so
    // a second zone preparation on the same host builds nothing again.
    const host = makeHost(['forest_wolf', 'rare_oddity']);
    buildEntityPrewarmGroup(host, ZONE);
    state.createCalls.length = 0;
    const second = buildEntityPrewarmGroup(host, ZONE);
    expect(state.createCalls).toEqual([]);
    expect(second.group.children).toHaveLength(0);
  });
});

describe('buildPlayerPrewarmGroup metamorph ordering, arithmetic, and the trim arm', () => {
  it('builds the Metamorphosis rig FIRST, then a skin pass and an aura-glow pass per class', () => {
    const host = makeHost([]);
    const built = buildPlayerPrewarmGroup(host, NO_DEADLINE);
    // Metamorph before regular variants: first activation must never pay
    // prepareVisual's clone/traversal/bake cost mid-combat.
    expect(state.createCalls[0]).toBe('warlock');
    expect(state.createForms[0]).toBe('form_metamorph');
    expect(state.activeCalls).toEqual(['warlock:true']);
    // plannedVisuals arithmetic: one skin variant per class (mocked skinCount)
    // plus one aura-glow rig per class; the metamorph rig rides as an extra.
    expect(built.plannedVisuals).toBe(ALL_CLASSES.length * 2);
    expect(built.visuals).toHaveLength(ALL_CLASSES.length * 2 + 1);
    expect(built.visualCount).toBe(ALL_CLASSES.length * 2 + 1);
    expect(built.trimmed).toBe(false);
    expect(state.auraGlowCalls).toHaveLength(ALL_CLASSES.length);
  });

  it('a deadline that lands mid-loop reports trimmed with plannedVisuals intact', () => {
    // performance.now ticks once per loop check, so a deadline of 2 admits the
    // metamorph (built before any check) plus two skins, then trims.
    let tick = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => tick++);
    try {
      const host = makeHost([]);
      const built = buildPlayerPrewarmGroup(host, 2);
      expect(built.trimmed).toBe(true);
      expect(built.visuals).toHaveLength(3);
      expect(built.visualCount).toBe(3);
      expect(built.plannedVisuals).toBe(ALL_CLASSES.length * 2);
      expect(built.visuals.length).toBeLessThan(built.plannedVisuals);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe('buildObjectPrewarmGroup pooled copies and the point-light hide', () => {
  it('stores PREWARM_OBJECT_POOL_COPIES per id and every spawned light ends hidden', () => {
    const stored: { key: string; view: { group: THREE.Group } }[] = [];
    const host = makeHost([]);
    host.storePooledObject = (key, object) =>
      stored.push({ key, view: object as unknown as { group: THREE.Group } });
    state.buildQuestObject = () => {
      const group = new THREE.Group();
      const light = new THREE.PointLight();
      light.visible = true;
      group.add(light);
      return { group } as unknown as PooledObjectView;
    };
    const group = buildObjectPrewarmGroup(host);
    // Vacuity floor: with an emptied id list every count below is 0 == 0.
    expect(PREWARM_OBJECT_ITEM_IDS.length).toBeGreaterThan(0);
    expect(PREWARM_OBJECT_POOL_COPIES).toBeGreaterThan(0);
    expect(group.children).toHaveLength(
      PREWARM_OBJECT_ITEM_IDS.length * PREWARM_OBJECT_POOL_COPIES,
    );
    for (const itemId of PREWARM_OBJECT_ITEM_IDS) {
      expect(stored.filter((s) => s.key === `object:${itemId}`)).toHaveLength(
        PREWARM_OBJECT_POOL_COPIES,
      );
    }
    // Every point light must end visible=false during the prewarm: a visible
    // light would inflate numPointLights, a three.js program-cache-key input,
    // so every material would compile against one more light than the open
    // world's constant budget ever shows and relink on first travel.
    let lights = 0;
    for (const { view } of stored) {
      expect(view.group.visible).toBe(true);
      view.group.traverse((o) => {
        if ((o as THREE.PointLight).isPointLight) {
          lights++;
          expect(o.visible).toBe(false);
        }
      });
    }
    expect(lights).toBe(stored.length);
  });
});

describe('the untyped host seam stays welded to the renderer', () => {
  // The builders take host: object and cast to ZonePrewarmGroupHost because
  // the consumed Renderer members are PRIVATE (structural typing cannot see
  // them), so tsc proves nothing about the renderer's conformance and the
  // fake-host suite above cannot either. These source pins are the weld: a
  // rename of a consumed member, or logic growing inside the wrapper the
  // builders bypass, reds here instead of throwing at runtime during zone
  // prepare.
  // Comments stripped before scanning (the architecture-test rule): a comment
  // spelling an anchor must never satisfy the weld after the member is gone.
  // Through the shared order-safe helper: the hand-rolled block-first two-pass
  // shape opens a false block on a bare /* inside a line comment (the
  // strip_comments.ts header documents the ~1,950-line src/main.ts exemption
  // that shipped from exactly this).
  const renderer = stripComments(
    readFileSync(fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url)), 'utf8'),
  );

  it('renderer.ts still declares every member the host cast consumes, full signature', () => {
    // FULL signatures, not name prefixes (the Phase 16 QA): the cast is
    // untyped, so a parameter inserted, reordered, retyped, or a Set field
    // renamed by suffix (prewarmedMobTemplatesByZone) would keep a bare-name
    // anchor green and break at runtime during zone prepare. Anchoring the
    // whole declaration makes any signature drift red here first; on a red,
    // update ZonePrewarmGroupHost + the builders + these anchors together.
    for (const anchor of [
      "private prewarmEntity(\n    kind: 'player' | 'mob' | 'npc',\n" +
        '    templateId: string,\n    color: number,\n    scale: number,\n' +
        '    skin = 0,\n    id = -10_000,\n  ): Entity {',
      'private storePooledObject(key: string, object: PooledObjectView): void {',
      "private templateIdsInZone(zone: ZoneDef, kind: 'mob' | 'npc'): string[] {",
      'private prewarmedMobTemplates = new Set<string>();',
      'private prewarmedNpcModels = new Set<string>();',
      // the host's `sim.player.pos` read: the renderer's sim field must stand
      'private sim: IWorld,',
    ]) {
      expect(
        renderer,
        `${anchor} renamed or removed: update ZonePrewarmGroupHost and the builders`,
      ).toContain(anchor);
    }
  });

  it('the bypassed visualPoolKeyFor wrapper stays a pure delegation', () => {
    // The extracted builders call characterVisualPoolKey DIRECTLY; the
    // renderer keeps this wrapper for its remaining call site. If logic ever
    // grows inside it, the builders silently diverge, so pin the body to the
    // bare delegation (comments stripped by slicing to the return statement).
    const at = renderer.indexOf('private visualPoolKeyFor(');
    expect(at, 'visualPoolKeyFor removed: re-point the builders or this pin').toBeGreaterThan(-1);
    // Slice from the OPEN BRACE, not by filtering 'private'-prefixed lines
    // (the Phase 16 QA): a statement written ON the signature line would be
    // dropped by a prefix filter and the wrapper could diverge invisibly.
    const openAt = renderer.indexOf('{', at);
    expect(openAt, 'visualPoolKeyFor has no body').toBeGreaterThan(at);
    const body = renderer.slice(openAt + 1, renderer.indexOf('}', openAt));
    const statements = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//'));
    expect(
      statements,
      'logic grew inside the wrapper: mirror it in zone_prewarm_groups.ts',
    ).toEqual(['return characterVisualPoolKey(e);']);
  });

  it('every builder call goes through the typed adapter, never the bare untyped host', () => {
    // The Phase 18 weld arm: renderer.ts binds its private members to
    // ZonePrewarmGroupHost in one adapter object, so a signature drift on any
    // consumed member is a tsc error at the binding (the source anchors above
    // stay as the second arm, since the adapter's arrows carry no types of
    // their own). The pin here is that the adapter is what the builders get:
    // a call site handing `this` again would bypass the weld silently, since
    // the builders still accept `host: object`.
    const adapterAt = renderer.indexOf('private zonePrewarmHost(): ZonePrewarmGroupHost {');
    expect(adapterAt, 'the typed adapter is missing from renderer.ts').toBeGreaterThan(-1);
    const adapter = renderer.slice(adapterAt, renderer.indexOf('\n  }', adapterAt));
    for (const binding of [
      'sim: this.sim,',
      'this.prewarmEntity(kind, templateId, color, scale, skin, id),',
      'storePooledObject: (key, object) => this.storePooledObject(key, object),',
      'templateIdsInZone: (zone, kind) => this.templateIdsInZone(zone, kind),',
      'prewarmedMobTemplates: this.prewarmedMobTemplates,',
      'prewarmedNpcModels: this.prewarmedNpcModels,',
    ]) {
      expect(adapter, `adapter binding missing: ${binding}`).toContain(binding);
    }
    // The first argument, up to its separating comma or the call's own `);`
    // (lazy, so the adapter's `()` stays inside the capture).
    const builderCalls = [
      ...renderer.matchAll(
        /\b(buildEntityPrewarmGroup|buildNpcPrewarmGroup|buildPlayerPrewarmGroup|buildObjectPrewarmGroup)\(([^\n]*?)(?:, |\);)/g,
      ),
    ];
    // Four builders, every call site: the adapter, never `this`.
    expect(builderCalls.length).toBeGreaterThanOrEqual(4);
    for (const call of builderCalls) {
      expect(call[2].trim(), `${call[1]} bypasses the weld: ${call[0]}`).toBe(
        'this.zonePrewarmHost()',
      );
    }
    expect(renderer).toContain('type ZonePrewarmGroupHost,');
  });
});
