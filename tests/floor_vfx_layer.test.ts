import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GroundDecals } from '../src/render/ability_vfx/decals';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { GroundAuras } from '../src/render/ability_vfx/ground_auras';
import { ShockRings } from '../src/render/ability_vfx/rings';
import { applyFloorVfxLayer } from '../src/render/floor_vfx_layer';
import {
  FLOOR_VFX_LAYER_BASE,
  FLOOR_VFX_LAYER_SPAN,
  FLOOR_VFX_LAYERS,
  type FloorVfxLayer,
  floorVfxLayerOf,
  floorVfxLayerTopOrder,
  floorVfxRenderOrder,
} from '../src/render/floor_vfx_layer_core';
import { GroundAimReticleVisual } from '../src/render/ground_aim_reticle_visual';
import { buildIgnivarFrontalTelegraph } from '../src/render/ignivar_frontal_telegraph';
import { buildIgnivarSoakTelegraph } from '../src/render/ignivar_soak_telegraph';
import { MageGroundFx } from '../src/render/mage_ground_fx';
import { buildNythraxisBindingSigilPrewarmVisual } from '../src/render/nythraxis_sigil_visual';
import { PaladinConsecrationVisuals } from '../src/render/paladin_consecration_visual';
import { NYTHRAXIS_GRAVE_ERUPTION_CAST_ID } from '../src/sim/nythraxis_grave_eruption';

// The floor VFX ladder (src/render/floor_vfx_layer_core.ts) is what keeps a
// boss telegraph painting over a player's ground effects: every floor mesh is
// transparent with depth-write off, so renderOrder is the only arbiter, and
// before the ladder each module picked its own integer. These pins hold the
// ladder's shape, the Group trap, the module registry and its completeness
// sweep, and the end-to-end outcome on the real builders.

const repoRoot = join(__dirname, '..');
const renderRoot = join(repoRoot, 'src', 'render');

interface FloorVfxModule {
  file: string;
  /** The band the module's floor pieces ride. */
  layer: FloorVfxLayer;
  /** Further bands the module may name (a builder that serves two callers). */
  alsoNames?: readonly FloorVfxLayer[];
  /**
   * Strict modules take EVERY renderOrder from the seam (no bare integer
   * literal survives). The two non-strict ones are large files whose floor
   * pieces are layered while their unrelated meshes keep their own orders
   * (renderer.ts: the god-ray sprites; ignivar_fire_vfx.ts: the projectile and
   * impact pieces around its ground-fire AoE).
   */
  strict: boolean;
}

/** Every module that draws floor-anchored VFX, and the band it belongs to. */
const FLOOR_VFX_LAYERED_MODULES: readonly FloorVfxModule[] = [
  // the world's own marks
  { file: 'src/render/blob_shadows.ts', layer: 'ground', strict: true },
  { file: 'src/render/mob_night_glow.ts', layer: 'ground', strict: true },
  { file: 'src/render/torch_glow_decal.ts', layer: 'ground', strict: true },
  { file: 'src/render/ember_pools.ts', layer: 'ground', strict: true },
  { file: 'src/render/camp_braziers.ts', layer: 'ground', strict: true },
  { file: 'src/render/streetlamps.ts', layer: 'ground', strict: true },
  { file: 'src/render/decor_torch_fx.ts', layer: 'ground', strict: true },
  { file: 'src/render/impact_site.ts', layer: 'ground', strict: true },
  // player class ability ground VFX
  { file: 'src/render/ability_vfx/decals.ts', layer: 'player', strict: true },
  { file: 'src/render/ability_vfx/ground_auras.ts', layer: 'player', strict: true },
  { file: 'src/render/ability_vfx/rings.ts', layer: 'player', strict: true },
  { file: 'src/render/player_aura_rings.ts', layer: 'player', strict: true },
  // The meteor telegraph serves the mage's own Meteor AND the sim's world
  // warnings (Ignivar meteors, Varkhul anvils and forgestorm, Nythraxis grave
  // eruptions), so it picks its band per spawn.
  { file: 'src/render/mage_ground_fx.ts', layer: 'player', alsoNames: ['encounter'], strict: true },
  { file: 'src/render/necromancy_ground_fx.ts', layer: 'player', strict: true },
  { file: 'src/render/paladin_consecration_visual.ts', layer: 'player', strict: true },
  { file: 'src/render/paladin_aegis_visual.ts', layer: 'player', strict: true },
  { file: 'src/render/paladin_ascension_visual.ts', layer: 'player', strict: true },
  { file: 'src/render/ring_of_frost_visual.ts', layer: 'player', strict: true },
  { file: 'src/render/frost_nova_root_visual.ts', layer: 'player', strict: true },
  { file: 'src/render/glacial_front_visual.ts', layer: 'player', strict: true },
  { file: 'src/render/abyssal_rift_fx.ts', layer: 'player', strict: true },
  { file: 'src/render/umbral_anchor_marker.ts', layer: 'player', strict: true },
  { file: 'src/render/warlock_meteor_fx.ts', layer: 'player', strict: true },
  { file: 'src/render/sentence_vfx.ts', layer: 'player', strict: true },
  // The player's own click-to-move marker and AoE landing flash: normal-blended
  // feedback, so it rides the TOP of the player band rather than the reticle
  // band, and never covers a telegraph.
  { file: 'src/render/renderer.ts', layer: 'player', strict: false },
  // boss and encounter mechanics
  { file: 'src/render/ignivar_frontal_telegraph.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_soak_telegraph.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_brand_telegraph.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_rotating_rays.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_conduit.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_fire_beams.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_forge_judgment.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_lava_moat.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_fire_vfx.ts', layer: 'encounter', strict: false },
  { file: 'src/render/nythraxis_sigil_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/nythraxis_soul_rend_marker.ts', layer: 'encounter', strict: true },
  { file: 'src/render/nythraxis_gravefire_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/nythraxis_grave_flame_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_forgestorm_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_cinder_orb_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_assembly_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_intercept_beam_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_forge_beam_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_worldfire_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_encounter.ts', layer: 'encounter', strict: true },
  { file: 'src/render/rift_death_zone.ts', layer: 'encounter', strict: true },
  // the player's own ground aim guide (additive: it brightens what lies under it)
  { file: 'src/render/ground_aim_reticle_visual.ts', layer: 'reticle', strict: true },
];

/**
 * Render modules that set a bare renderOrder and are deliberately OFF the
 * ladder (docs/design/vfx-floor-layering.md, "out of scope"): vertical VFX
 * that stands up from the ground, static dungeon and zone dressing, water and
 * sky, camera-attached overlays, character parts, and world markers far from
 * any raid floor. A NEW render module that sets a bare renderOrder must either
 * register above or be added here with a reason; the sweep below fails
 * otherwise, so a floor mechanic cannot ship outside the ladder unnoticed.
 */
const FLOOR_VFX_OUT_OF_SCOPE: readonly string[] = [
  // pooled ability VFX families that stand up from the ground
  'src/render/ability_vfx/flipbooks.ts',
  'src/render/ability_vfx/overlay_sprites.ts',
  'src/render/ability_vfx/pillars.ts',
  'src/render/ability_vfx/ribbons.ts',
  'src/render/ability_vfx/shells.ts',
  'src/render/ability_vfx/spirits.ts',
  'src/render/vfx.ts',
  // vertical or body-anchored class VFX
  'src/render/burning_pact_markers.ts',
  'src/render/characters/paladin_templars_verdict_fx.ts',
  'src/render/characters/visual.ts',
  'src/render/drain_life_vfx.ts',
  'src/render/evil_eye_markers.ts',
  'src/render/fireball_travel_visual.ts',
  'src/render/goblin_rocket_sled_fx.ts',
  'src/render/ice_block_visual.ts',
  'src/render/mage_barrier_visual.ts',
  'src/render/necromancy_army_portal_fx.ts',
  'src/render/paladin_oath_chain_visual.ts',
  'src/render/weapon_vfx.ts',
  // Ignivar dressing that is not a floor mechanic
  'src/render/ignivar_arena_atmosphere.ts',
  'src/render/ignivar_mist_gate.ts',
  'src/render/ignivar_model_vfx.ts',
  // static dungeon, zone and town dressing, water and sky
  'src/render/delve_marsh_dressing.ts',
  'src/render/dungeon.ts',
  'src/render/fenbridge_town.ts',
  'src/render/frost_sky.ts',
  'src/render/haunt_features.ts',
  'src/render/placed_assets.ts',
  'src/render/props.ts',
  'src/render/realm_builder_monument_fx.ts',
  'src/render/rift_decor.ts',
  'src/render/underwater.ts',
  'src/render/weather.ts',
  'src/render/wildheart_props.ts',
  'src/render/wildheart_terrain.ts',
  // battleground objective marks and world markers far from any raid floor
  'src/render/battleground.ts',
  'src/render/battleground_fx.ts',
  'src/render/battleground_lantern_fx.ts',
  'src/render/battleground_rune_vfx.ts',
  'src/render/coach_trail.ts',
  'src/render/corpse_beacon.ts',
  'src/render/mount_beacon.ts',
  'src/render/mount_glow.ts',
  'src/render/race_line.ts',
];

/**
 * Pre-existing Group renderOrders, all far from any raid floor. A Group's
 * renderOrder is three's groupOrder sort key and outranks the whole ladder, so
 * this list must only ever shrink; a new entry means a floor mechanic can be
 * painted over by a marker.
 */
const KNOWN_GROUP_ORDER_FILES: readonly string[] = [
  'src/render/mount_beacon.ts',
  'src/render/race_line.ts',
  'src/render/underwater.ts',
];

const SEAM_IMPORT_RE = /from '(?:\.\.\/|\.\/)floor_vfx_layer(?:_core)?'/;
const BARE_LITERAL_RE = /renderOrder\s*=\s*-?\d/;
const LAYER_CALL_RE =
  /(?:floorVfxRenderOrder|floorVfxLayerTopOrder)\(\s*'(\w+)'|applyFloorVfxLayer\([^)]*?,\s*'(\w+)'/g;

type Renderable = THREE.Object3D & {
  isMesh?: boolean;
  isPoints?: boolean;
  isSprite?: boolean;
  isLine?: boolean;
};

function isRenderable(object: THREE.Object3D): boolean {
  const r = object as Renderable;
  return Boolean(r.isMesh || r.isPoints || r.isSprite || r.isLine);
}

function renderOrders(root: THREE.Object3D): number[] {
  const orders: number[] = [];
  root.traverse((object) => {
    if (isRenderable(object)) orders.push(object.renderOrder);
  });
  return orders;
}

function groupOrders(root: THREE.Object3D): number[] {
  const orders: number[] = [];
  root.traverse((object) => {
    if ((object as THREE.Group).isGroup) orders.push(object.renderOrder);
  });
  return orders;
}

function renderSourceFiles(): string[] {
  return readdirSync(renderRoot, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => join(renderRoot, f))
    .filter((f) => statSync(f).isFile())
    .map((f) => relative(repoRoot, f))
    .sort();
}

/** Identifiers a file binds to `new THREE.Group()`, locals and `this.` fields. */
function groupIdentifiers(source: string): Set<string> {
  const names = new Set<string>();
  const local = /(?:const|let)\s+(\w+)(?::\s*THREE\.Group)?\s*=\s*new THREE\.Group\(\)/g;
  for (const m of source.matchAll(local)) names.add(m[1]);
  for (const m of source.matchAll(/this\.(\w+)\s*=\s*new THREE\.Group\(\)/g)) {
    names.add(`this.${m[1]}`);
  }
  for (const m of source.matchAll(/(?:readonly\s+)?(\w+)\s*=\s*new THREE\.Group\(\);/g)) {
    names.add(`this.${m[1]}`);
  }
  return names;
}

function groupOrderAssignments(file: string): string[] {
  const source = readFileSync(join(repoRoot, file), 'utf8');
  const hits: string[] = [];
  const names = groupIdentifiers(source);
  if (names.size === 0) return hits;
  source.split('\n').forEach((line, index) => {
    for (const name of names) {
      const re = new RegExp(`(^|[^\\w.])${name.replace('.', '\\.')}\\.renderOrder\\s*=`);
      if (re.test(line)) hits.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

function textures(): AbilityVfxTextures {
  const texture = () => new THREE.Texture();
  return {
    noise: texture(),
    ember: texture(),
    rime: texture(),
    rune: texture(),
    crack: texture(),
    char: texture(),
  } as unknown as AbilityVfxTextures;
}

describe('floor VFX ladder (core)', () => {
  it('pins the four bands, bottom to top, with the orders they own', () => {
    expect(FLOOR_VFX_LAYERS).toEqual(['ground', 'player', 'encounter', 'reticle']);
    expect(FLOOR_VFX_LAYER_BASE).toEqual({ ground: 1, player: 10, encounter: 20, reticle: 50 });
    expect(FLOOR_VFX_LAYER_SPAN).toEqual({ ground: 8, player: 10, encounter: 30, reticle: 4 });
  });

  it('keeps the bands disjoint and ordered: every rung of a band paints under the next band', () => {
    for (let i = 1; i < FLOOR_VFX_LAYERS.length; i++) {
      const below = FLOOR_VFX_LAYERS[i - 1];
      const above = FLOOR_VFX_LAYERS[i];
      expect(floorVfxLayerTopOrder(below)).toBeLessThan(floorVfxRenderOrder(above, 0));
    }
    // The objective in one line: no player rung reaches any encounter rung.
    expect(floorVfxLayerTopOrder('player')).toBeLessThan(floorVfxRenderOrder('encounter', 0));
    // The ladder sits above the water surface (0) and the world's default band.
    expect(floorVfxRenderOrder('ground', 0)).toBeGreaterThan(0);
  });

  it('gives the encounter band room for the legacy-minus-one rule up to the judgment cue beams', () => {
    // The highest order any boss module shipped with before the ladder was the
    // forge judgment cue beams at 30; legacy minus one is step 29, the top rung.
    expect(floorVfxRenderOrder('encounter', 29)).toBe(floorVfxLayerTopOrder('encounter'));
  });

  it('steps inside a band and clamps at its top instead of crossing into the next band', () => {
    expect(floorVfxRenderOrder('encounter')).toBe(20);
    expect(floorVfxRenderOrder('encounter', 3)).toBe(23);
    expect(floorVfxRenderOrder('encounter', 29)).toBe(49);
    expect(floorVfxRenderOrder('encounter', 30)).toBe(49);
    expect(floorVfxRenderOrder('encounter', 1000)).toBe(floorVfxLayerTopOrder('encounter'));
    expect(floorVfxRenderOrder('player', 9)).toBe(19);
    expect(floorVfxRenderOrder('player', 10)).toBe(19);
    expect(floorVfxRenderOrder('reticle', 3)).toBe(53);
    expect(floorVfxRenderOrder('reticle', 4)).toBe(53);
  });

  it('treats a negative, fractional, or non-finite step as the bottom rung or its floor', () => {
    expect(floorVfxRenderOrder('player', -3)).toBe(10);
    expect(floorVfxRenderOrder('player', 2.9)).toBe(12);
    expect(floorVfxRenderOrder('player', Number.NaN)).toBe(10);
    expect(floorVfxRenderOrder('player', Number.POSITIVE_INFINITY)).toBe(10);
  });

  it('classifies an order back to its band, and nothing outside the ladder', () => {
    for (const layer of FLOOR_VFX_LAYERS) {
      expect(floorVfxLayerOf(floorVfxRenderOrder(layer, 0))).toBe(layer);
      expect(floorVfxLayerOf(floorVfxLayerTopOrder(layer))).toBe(layer);
    }
    expect(floorVfxLayerOf(0)).toBeNull();
    expect(floorVfxLayerOf(-1)).toBeNull();
    expect(floorVfxLayerOf(9)).toBeNull();
    expect(floorVfxLayerOf(9990)).toBeNull();
  });
});

describe('applyFloorVfxLayer (painter)', () => {
  it('sets the rung on every renderable leaf and resets every Group so groupOrder cannot hijack', () => {
    const root = new THREE.Group();
    root.renderOrder = 3;
    const inner = new THREE.Group();
    inner.renderOrder = 7;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
    const line = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    inner.add(mesh, points);
    root.add(inner, line, sprite);

    const applied = applyFloorVfxLayer(root, 'encounter', 4);

    expect(applied).toBe(24);
    expect(root.renderOrder).toBe(0);
    expect(inner.renderOrder).toBe(0);
    expect(mesh.renderOrder).toBe(24);
    expect(points.renderOrder).toBe(24);
    expect(line.renderOrder).toBe(24);
    expect(sprite.renderOrder).toBe(24);
  });

  it('applies to a bare renderable root as well', () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    expect(applyFloorVfxLayer(mesh, 'reticle')).toBe(50);
    expect(mesh.renderOrder).toBe(50);
  });

  it('three.js promotes a Group renderOrder to groupOrder, which is why the ladder lives on leaves', () => {
    // Pin the engine fact the painter is built around, from three's own source,
    // so a three bump that changes it fails here instead of in a raid.
    const source = readFileSync(
      join(repoRoot, 'node_modules', 'three', 'build', 'three.module.js'),
      'utf8',
    );
    expect(source).toMatch(/if \( object\.isGroup \) \{\s*groupOrder = object\.renderOrder;/);
  });
});

describe('floor VFX module registry', () => {
  it('lists only files that exist, each once, with the out-of-scope list disjoint from it', () => {
    const registered = FLOOR_VFX_LAYERED_MODULES.map((m) => m.file);
    const missing = [...registered, ...FLOOR_VFX_OUT_OF_SCOPE].filter(
      (f) => !existsSync(join(repoRoot, f)),
    );
    expect(missing).toEqual([]);
    expect(new Set(registered).size).toBe(registered.length);
    expect(new Set(FLOOR_VFX_OUT_OF_SCOPE).size).toBe(FLOOR_VFX_OUT_OF_SCOPE.length);
    expect(FLOOR_VFX_OUT_OF_SCOPE.filter((f) => registered.includes(f))).toEqual([]);
  });

  it('every registered module imports the seam and names only the bands it is registered for', () => {
    const violations: string[] = [];
    for (const { file, layer, alsoNames = [] } of FLOOR_VFX_LAYERED_MODULES) {
      const source = readFileSync(join(repoRoot, file), 'utf8');
      if (!SEAM_IMPORT_RE.test(source)) violations.push(`${file}: does not import floor_vfx_layer`);
      const named = new Set<string>();
      for (const match of source.matchAll(LAYER_CALL_RE)) named.add(match[1] ?? match[2]);
      if (named.size === 0) violations.push(`${file}: never calls the seam`);
      const allowed = new Set<string>([layer, ...alsoNames]);
      for (const other of named) {
        if (!allowed.has(other)) {
          violations.push(`${file}: names band '${other}', registered as '${layer}'`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('strict modules leave no bare integer renderOrder literal', () => {
    const violations: string[] = [];
    for (const { file, strict } of FLOOR_VFX_LAYERED_MODULES) {
      if (!strict) continue;
      const lines = readFileSync(join(repoRoot, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (BARE_LITERAL_RE.test(line)) violations.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(violations).toEqual([]);
  });

  // COMPLETENESS: a render module that sets a bare renderOrder is either on the
  // ladder or named out of scope with a reason. Nothing else may set one.
  it('every src/render module with a bare renderOrder is registered or named out of scope', () => {
    const registered = new Set(FLOOR_VFX_LAYERED_MODULES.map((m) => m.file));
    const outOfScope = new Set(FLOOR_VFX_OUT_OF_SCOPE);
    const unaccounted: string[] = [];
    const stale: string[] = [];
    for (const file of renderSourceFiles()) {
      const hasLiteral = BARE_LITERAL_RE.test(readFileSync(join(repoRoot, file), 'utf8'));
      if (hasLiteral && !registered.has(file) && !outOfScope.has(file)) unaccounted.push(file);
      if (!hasLiteral && outOfScope.has(file)) stale.push(file);
    }
    expect(
      unaccounted,
      'a render module sets a bare renderOrder: put it on the ladder (FLOOR_VFX_LAYERED_MODULES) or name it in FLOOR_VFX_OUT_OF_SCOPE with a reason',
    ).toEqual([]);
    expect(stale, 'out-of-scope entries with no bare renderOrder left: remove them').toEqual([]);
  });

  // The Group trap, repo-wide: a Group renderOrder becomes three's groupOrder and
  // outranks every rung, so the known pre-existing carriers are pinned and the
  // list may only shrink.
  it('no src/render module puts a renderOrder on a Group beyond the pinned pre-existing carriers', () => {
    const known = new Set(KNOWN_GROUP_ORDER_FILES);
    const offenders: string[] = [];
    const carriers = new Set<string>();
    for (const file of renderSourceFiles()) {
      const hits = groupOrderAssignments(file);
      if (hits.length === 0) continue;
      carriers.add(file);
      if (!known.has(file)) offenders.push(...hits);
    }
    expect(
      offenders,
      'a Group renderOrder outranks the whole floor ladder: put the order on the leaves (applyFloorVfxLayer)',
    ).toEqual([]);
    const gone = [...known].filter((f) => !carriers.has(f));
    expect(gone, 'pinned carriers that no longer carry a Group order: drop them').toEqual([]);
  });
});

describe('floor VFX ladder (end to end on the real builders)', () => {
  /** A live player scene: the three pooled ground families, a consecration, a meteor. */
  function playerScene(): THREE.Scene {
    const scene = new THREE.Scene();
    new GroundDecals(scene, textures(), () => 0);
    new GroundAuras(scene, textures());
    new ShockRings(scene, textures(), () => 0);
    const consecration = new PaladinConsecrationVisuals(scene, () => 2);
    consecration.sync([
      { id: 'consecration:1:20', x: 4, z: 7, radius: 6, duration: 9, remaining: 4 },
    ]);
    const mage = new MageGroundFx(scene, () => 0, vi.fn());
    mage.spawnMeteor({ x: 4, z: 7, radius: 2.4, duration: 3, showTelegraph: true });
    return scene;
  }

  /**
   * The FLOOR pieces of that scene: the pooled family meshes (direct scene
   * children), the consecration subtree, and the meteor's ground telegraph. The
   * falling meteor body is airborne and deliberately outside the ladder.
   */
  function playerFloorRoots(scene: THREE.Scene): THREE.Object3D[] {
    const pooled = scene.children.filter((child) => (child as THREE.Mesh).isMesh);
    const consecration = scene.getObjectByName('paladin-consecration');
    const telegraph = scene.getObjectByName('mage-meteor-telegraph');
    expect(pooled.length).toBeGreaterThan(0);
    expect(consecration).toBeDefined();
    expect(telegraph).toBeDefined();
    return [...pooled, consecration as THREE.Object3D, telegraph as THREE.Object3D];
  }

  function encounterRoots(): THREE.Object3D[] {
    return [
      buildIgnivarSoakTelegraph(),
      buildIgnivarFrontalTelegraph(),
      buildNythraxisBindingSigilPrewarmVisual(),
    ];
  }

  it('every boss telegraph renderable paints over every player ground renderable', () => {
    const player = playerFloorRoots(playerScene()).flatMap(renderOrders);
    const encounter = encounterRoots().flatMap(renderOrders);
    expect(player.length).toBeGreaterThan(10);
    expect(encounter.length).toBeGreaterThan(10);
    expect(Math.min(...encounter)).toBeGreaterThan(Math.max(...player));
  });

  it('classifies every floor renderable of each side into its own band', () => {
    for (const order of playerFloorRoots(playerScene()).flatMap(renderOrders)) {
      expect(floorVfxLayerOf(order), `player order ${order}`).toBe('player');
    }
    for (const order of encounterRoots().flatMap(renderOrders)) {
      expect(floorVfxLayerOf(order), `encounter order ${order}`).toBe('encounter');
    }
  });

  it('leaves every Group at renderOrder 0 so groupOrder never outranks the ladder', () => {
    for (const root of [playerScene(), ...encounterRoots()]) {
      const offenders = groupOrders(root).filter((order) => order !== 0);
      expect(offenders, `${root.name} has Groups carrying an order`).toEqual([]);
    }
  });

  it("puts a boss or world meteor warning on the encounter band and the mage's own Meteor on the player band", () => {
    const telegraphOrders = (spawn: Parameters<MageGroundFx['spawnMeteor']>[0]): number[] => {
      const scene = new THREE.Scene();
      const fx = new MageGroundFx(scene, () => 0, vi.fn());
      fx.spawnMeteor(spawn);
      const telegraph = scene.getObjectByName('mage-meteor-telegraph');
      expect(telegraph).toBeDefined();
      const orders = renderOrders(telegraph as THREE.Object3D);
      expect(orders.length).toBeGreaterThan(3);
      return orders;
    };
    const own = telegraphOrders({ x: 0, z: 0, radius: 3, duration: 3, showTelegraph: true });
    const world = telegraphOrders({
      x: 0,
      z: 0,
      radius: 3,
      duration: 3,
      showTelegraph: true,
      persistentId: 'ignivar-meteor:1',
    });
    const grave = telegraphOrders({
      x: 0,
      z: 0,
      radius: 3,
      duration: 3,
      showTelegraph: true,
      ability: NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
    });
    for (const order of own) expect(floorVfxLayerOf(order), `own ${order}`).toBe('player');
    for (const order of world) expect(floorVfxLayerOf(order), `world ${order}`).toBe('encounter');
    for (const order of grave) expect(floorVfxLayerOf(order), `grave ${order}`).toBe('encounter');
    // The same rungs in either band: the stack does not change shape with the caller.
    const shape = (orders: number[]) => orders.map((o) => o - Math.min(...orders)).sort();
    expect(shape(world)).toEqual(shape(own));
  });

  it('keeps the ground aim reticle above the encounter band, additive so it hides nothing', () => {
    const scene = new THREE.Scene();
    const reticle = new GroundAimReticleVisual(scene, () => 0, 1);
    const orders = renderOrders(reticle.group);
    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) expect(floorVfxLayerOf(order)).toBe('reticle');
    expect(Math.min(...orders)).toBeGreaterThan(floorVfxLayerTopOrder('encounter'));
    reticle.group.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | undefined;
      if (material) expect(material.blending).toBe(THREE.AdditiveBlending);
    });
  });
});
