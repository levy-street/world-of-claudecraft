import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PALADIN_SYNTHESIZED_CLIP_SOURCES } from '../src/render/characters/assets';
import {
  type ClipMap,
  modularVisualKey,
  VISUALS,
  type VisualDef,
  visualAssetUrlForGraphics,
} from '../src/render/characters/manifest';

// A clip name the shipped GLB does not carry fails SILENTLY at every layer:
// baseAction() falls back, fadeTo()/playOneShot() return early, and the
// prepareVisual far-LOD bake falls back to BIND POSE (the T-pose) when the idle
// clip is the one missing. Nothing else in CI compares the ClipMaps against the
// GLBs actually served out of public/, so a rename in an asset update ships a
// rig that quietly stops animating. This is that gate.

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

interface GlbJson {
  animations?: { name?: string; channels?: { target?: { node?: number } }[] }[];
  nodes?: { name?: string }[];
}

/** Minimal glTF-binary reader: 12-byte header, then chunks; the JSON chunk
 *  carries the animation and node lists. Deliberately dependency-free, so the
 *  gate cannot be fooled by (or fail with) whatever the runtime loader stack
 *  does. */
function glbJsonChunk(publicPath: string): GlbJson {
  const buf = readFileSync(publicPath);
  expect(buf.length, `${publicPath} is not a GLB`).toBeGreaterThan(12);
  expect(buf.readUInt32LE(0), `${publicPath} magic`).toBe(GLB_MAGIC);
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    if (type === CHUNK_JSON) {
      return JSON.parse(buf.toString('utf8', offset + 8, offset + 8 + length)) as GlbJson;
    }
    offset += 8 + length + ((4 - (length % 4)) % 4); // chunks are 4-byte aligned
  }
  throw new Error(`${publicPath} has no JSON chunk`);
}

function glbAnimationNames(publicPath: string): string[] {
  return (glbJsonChunk(publicPath).animations ?? []).map((a) => a.name ?? '');
}

/** three's GLTFLoader runs PropertyBinding.sanitizeNodeName over node names
 *  and track paths alike (spaces to underscores, then the reserved characters
 *  stripped), so the gate compares sanitized-to-sanitized exactly as the
 *  runtime resolver does: a raw mismatch that sanitizes equal still binds. */
function sanitizeNodeName(name: string): string {
  return name.replace(/\s/g, '_').replace(/[[\].:/]/g, '');
}

/** Node names in the GLB scene graph: the name pool three's PropertyBinding
 *  resolves animation tracks against after a donor clip is merged onto a body
 *  rig (assets.ts optimizedScene pushes donor clips by NAME, not by node). */
function glbNodeNames(publicPath: string): Set<string> {
  return new Set(
    (glbJsonChunk(publicPath).nodes ?? [])
      .map((n) => n.name)
      .filter((name): name is string => !!name)
      .map(sanitizeNodeName),
  );
}

/** clip name -> the node names its channels target. A clip merged onto a rig
 *  that has NONE of these nodes binds nothing: the action still plays and
 *  finishes, but drives no bone, freezing the rig at its last sampled pose for
 *  the clip's whole duration (the Grix the Tunnelking mid-swing statue). */
function glbClipTargets(publicPath: string): Map<string, Set<string>> {
  const json = glbJsonChunk(publicPath);
  const nodeName = (index: number | undefined): string | null =>
    index === undefined ? null : (json.nodes?.[index]?.name ?? null);
  const targets = new Map<string, Set<string>>();
  for (const anim of json.animations ?? []) {
    const names = new Set<string>();
    for (const channel of anim.channels ?? []) {
      const name = nodeName(channel.target?.node);
      if (name) names.add(sanitizeNodeName(name));
    }
    targets.set(anim.name ?? '', names);
  }
  return targets;
}

function publicPath(url: string): string {
  return fileURLToPath(new URL(`../public/${url}`, import.meta.url));
}

const namesByUrl = new Map<string, string[]>();
function animationNamesOf(url: string): string[] {
  const hit = namesByUrl.get(url);
  if (hit) return hit;
  const names = glbAnimationNames(publicPath(url));
  namesByUrl.set(url, names);
  return names;
}

const nodeNamesByUrl = new Map<string, Set<string>>();
function nodeNamesOf(url: string): Set<string> {
  const hit = nodeNamesByUrl.get(url);
  if (hit) return hit;
  const names = glbNodeNames(publicPath(url));
  nodeNamesByUrl.set(url, names);
  return names;
}

const clipTargetsByUrl = new Map<string, Map<string, Set<string>>>();
function clipTargetsOf(url: string): Map<string, Set<string>> {
  const hit = clipTargetsByUrl.get(url);
  if (hit) return hit;
  const targets = glbClipTargets(publicPath(url));
  clipTargetsByUrl.set(url, targets);
  return targets;
}

/**
 * Every clip name the rig can resolve, both graphics tiers: placement swaps the
 * body GLB through visualAssetUrlForGraphics (LOW_URL_ALIAS), so a clip present
 * only on the standard-materials body would T-pose the low tier alone.
 */
function loadedClipNames(def: VisualDef, standardMaterials: boolean, key?: string): Set<string> {
  const urls = [
    visualAssetUrlForGraphics(def.url, standardMaterials),
    ...(def.animUrls ?? []).map((url) => visualAssetUrlForGraphics(url, standardMaterials)),
  ];
  const names = new Set<string>();
  for (const url of urls) for (const name of animationNamesOf(url)) names.add(name);
  // The two paladin attack clips are synthesized at prepare time from a GLB
  // source clip (assets.ts's PALADIN_SYNTHESIZED_CLIP_SOURCES), for the classic
  // and modular keys alike: a synthesized name resolves exactly when its source
  // does, so a trimmed-away source still fails this gate.
  if (key === 'player_paladin' || key === modularVisualKey('paladin')) {
    for (const [synthesized, source] of Object.entries(PALADIN_SYNTHESIZED_CLIP_SOURCES)) {
      if (names.has(source)) names.add(synthesized);
    }
  }
  return names;
}

/** Names visual.ts binds one-for-one; a missing one silently does nothing. */
function requiredClipNames(clips: ClipMap): string[] {
  return [
    clips.idle,
    clips.walk,
    clips.run,
    clips.death,
    clips.cast,
    clips.sitDown,
    clips.sitIdle,
    clips.swim,
    clips.swimSurface,
    clips.swimIdle,
    clips.wade,
    clips.jump,
    clips.land,
    clips.walkBack,
    clips.flourish,
    clips.stow,
    ...clips.attack,
    ...(clips.hit ?? []),
    ...Object.values(clips.attackByAbility ?? {}),
    ...Object.values(clips.attackByHand ?? {}),
  ].filter((name): name is string => !!name);
}

/** Emote specs are a fallback CHAIN (firstLoadedEmoteClip), so one is enough. */
function emoteChains(clips: ClipMap): [string, readonly string[]][] {
  return Object.entries(clips.emote ?? {}).map(([id, spec]) => [id, spec.clips]);
}

// Every field the gate knows how to check. A new ClipMap field must be added to
// requiredClipNames (or to this list, if it names no clip), or the gate would
// silently stop covering it.
const COVERED_CLIP_FIELDS = new Set<keyof ClipMap>([
  'idle',
  'walk',
  'run',
  'death',
  'cast',
  'sitDown',
  'sitIdle',
  'swim',
  'swimSurface',
  'swimIdle',
  'wade',
  'jump',
  'fall',
  'land',
  'walkBack',
  'flourish',
  'stow',
  'attack',
  'hit',
  'attackByAbility',
  'attackTimeScaleByAbility',
  'attackByHand',
  'emote',
]);

/**
 * Rigs whose GLB deliberately ships NO animation clips: the prop-lane mounts
 * that bob procedurally instead (src/render/mount_visuals.ts) and static set
 * dressing. They borrow an animated sibling's ClipMap purely to satisfy the
 * type and resolve no action at all at runtime, so there is no pose to lose.
 * The gate still pins that each one is genuinely clip-LESS, so a rig that
 * silently loses its clips in an asset update is not waved through here.
 */
const CLIPLESS_RIGS = new Set([
  'mount_stalkglider_snail',
  'mount_aether_hover_cycle',
  'mob_glimmerwisp',
  'mob_duskwisp',
  'mob_spider_egg_sac',
  // the dragonkin clutch shell: a two-state prop whose GLB ships no clips
  // (alive/dead is a mesh-visibility swap, VisualDef.corpseMeshSwap)
  'mob_dragon_egg',
]);

/** mob_yumi_cat is a single-clip objective prop: its ClipMap names the one real
 *  clip for `hit` and parks every other required field on this sentinel. */
const SENTINEL_CLIP_NAME = 'None';

const rigs = Object.entries(VISUALS).filter(([key]) => !CLIPLESS_RIGS.has(key));
const tiers: [string, boolean][] = [
  ['standard materials', true],
  ['low graphics', false],
];

describe('character ClipMaps match the shipped GLBs', () => {
  it('covers every visual key in the manifest', () => {
    expect(rigs.length).toBeGreaterThan(50);
    expect(rigs.length).toBe(Object.keys(VISUALS).length - CLIPLESS_RIGS.size);
    for (const [key, def] of rigs) {
      expect(existsSync(publicPath(def.url)), `${key}: ${def.url} is missing`).toBe(true);
      for (const url of def.animUrls ?? []) {
        expect(existsSync(publicPath(url)), `${key}: ${url} is missing`).toBe(true);
      }
    }
  });

  it('checks every ClipMap field (a new field must join the gate)', () => {
    for (const [key, def] of rigs) {
      const unknown = Object.keys(def.clips).filter(
        (field) => !COVERED_CLIP_FIELDS.has(field as keyof ClipMap),
      );
      expect(unknown, `${key} has ClipMap fields the gate does not check`).toEqual([]);
    }
  });

  it('keeps the clip-less exemptions honest (those GLBs really carry no clips)', () => {
    for (const key of CLIPLESS_RIGS) {
      const def = VISUALS[key];
      expect(def, `${key} is exempted but no longer in the manifest`).toBeDefined();
      expect(animationNamesOf(def.url), `${key} now ships clips: drop the exemption`).toEqual([]);
    }
    // the sentinel really is a name no rig ships
    const yumi = VISUALS.mob_yumi_cat;
    expect(yumi.clips.idle).toBe(SENTINEL_CLIP_NAME);
    expect(animationNamesOf(yumi.url)).not.toContain(SENTINEL_CLIP_NAME);
  });

  for (const [tierName, standardMaterials] of tiers) {
    it(`resolves every named clip out of the GLB on ${tierName}`, () => {
      const missing: string[] = [];
      for (const [key, def] of rigs) {
        const loaded = loadedClipNames(def, standardMaterials, key);
        for (const name of new Set(requiredClipNames(def.clips))) {
          if (name === SENTINEL_CLIP_NAME) continue;
          if (!loaded.has(name)) missing.push(`${key}: ${name}`);
        }
      }
      expect(missing).toEqual([]);
    });

    it(`binds every resolved clip to nodes the rig actually has on ${tierName}`, () => {
      // Name resolution (above) is only half the contract. Donor clips merge
      // onto the body rig and rebind BY NODE NAME (assets.ts optimizedScene),
      // so a donor authored for another skeleton resolves fine and then binds
      // nothing at runtime: the one-shot plays silently, drives no bone, and
      // the rig freezes at its last sampled pose for the clip's duration. The
      // zero-weight watchdog cannot see it (the action's weight is 1), which
      // is how Grix the Tunnelking shipped as a mid-swing statue: his
      // mixamorig drop wired goblin_hit_variety_anims.glb, whose tracks
      // target the goblin rig (Head/Arm.L/Arm.R/Body).
      const unbindable: string[] = [];
      for (const [key, def] of rigs) {
        const bodyUrl = visualAssetUrlForGraphics(def.url, standardMaterials);
        const rigNodes = nodeNamesOf(bodyUrl);
        const referenced = new Set([
          ...requiredClipNames(def.clips),
          ...emoteChains(def.clips).flatMap(([, chain]) => chain),
        ]);
        const sources = [
          bodyUrl,
          ...(def.animUrls ?? []).map((url) => visualAssetUrlForGraphics(url, standardMaterials)),
        ];
        for (const url of new Set(sources)) {
          for (const [clipName, targets] of clipTargetsOf(url)) {
            if (!referenced.has(clipName)) continue;
            // No node-targeted channels (pure morph/extension tracks): nothing
            // to rebind by name, so nothing this gate can lose.
            if (targets.size === 0) continue;
            // EVERY targeted node must exist: a clip binding 1 of 20 bones is
            // still a near-statue, the partial cousin of the zero-overlap bug.
            // Measured at adoption: every referenced clip on every rig binds
            // 100% of its targets, so this costs nothing today; a future
            // deliberately-partial donor loosens this with a written reason.
            const missing = [...targets].filter((name) => !rigNodes.has(name));
            if (missing.length > 0) {
              unbindable.push(
                `${key}: ${clipName} (from ${url}) targets nodes ${bodyUrl} lacks: ${missing.join(', ')}`,
              );
            }
          }
        }
      }
      expect(unbindable).toEqual([]);
    });

    it(`leaves every overhead emote at least one clip on ${tierName}`, () => {
      const empty: string[] = [];
      for (const [key, def] of rigs) {
        const loaded = loadedClipNames(def, standardMaterials);
        for (const [id, chain] of emoteChains(def.clips)) {
          if (!chain.some((name) => loaded.has(name))) empty.push(`${key}: ${id}`);
        }
      }
      expect(empty).toEqual([]);
    });
  }

  it('bakes the far-LOD proxy from a real idle pose, never bind pose', () => {
    // prepareVisual poses a throwaway clone on clips.idle before baking the
    // static far mesh; with no idle clip resolved it bakes the BIND pose, and
    // every rig that crosses the far band flashes a T-pose.
    const bindPosed: string[] = [];
    for (const [key, def] of rigs) {
      if (def.clips.idle === SENTINEL_CLIP_NAME) continue; // a clip-less prop either way
      for (const [, standardMaterials] of tiers) {
        if (!loadedClipNames(def, standardMaterials).has(def.clips.idle)) bindPosed.push(key);
      }
    }
    expect([...new Set(bindPosed)]).toEqual([]);
  });
});
