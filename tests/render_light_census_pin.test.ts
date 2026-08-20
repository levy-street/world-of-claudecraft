// The light census: every directional, hemisphere, spot, and rect-area light
// constructed anywhere under src/render, allowlisted one file at a time with a
// reason.
//
// Why these four and not point lights: three keys a material's program on the
// scene's light census (numDirLights, numHemiLights, numSpotLights,
// numRectAreaLights, numPointLights), so adding, removing, or hiding one of
// them relinks every lit material in view, measured at 100 to 200 ms per
// relink. Point lights already answer to a budget that keeps their count
// pinned (pointLightPadCount pads the census back up, see
// tests/point_light_budget.test.ts), so THEY have a scheduler; these four have
// no pad, and the only safe number of them is the number the renderer's
// constructor built.
//
// The pin is a source scan because there is no unit seam a light producer must
// pass through: a builder can write `new THREE.DirectionalLight(...)` anywhere
// and the group it lands in will simply be added to the scene. So the corpus is
// walked and every hit has to be a file this list knows about.
//
// A hit that is NOT on the list is a post-boot light producer until proven
// otherwise; the fix is a prewarm home or a gate (src/render/CLAUDE.md, "GPU
// work: every new producer is a client of the scheduler"), never a silent new
// row here.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const RENDER_ROOT = fileURLToPath(new URL('../src/render', import.meta.url));

/** The census-keyed light classes. `new THREE.X(` and the bare `new X(` a named
 *  import would produce are both matched: banning one spelling bans one
 *  spelling. */
const CENSUS_LIGHTS = [
  'DirectionalLight',
  'HemisphereLight',
  'SpotLight',
  'RectAreaLight',
] as const;
type CensusLight = (typeof CENSUS_LIGHTS)[number];
/** What a file can do to the census: construct one of the four classes, or
 *  CLONE a light, which `Object3D.clone()` copies class and all. */
type CensusProducer = CensusLight | 'clone';

const CENSUS_LIGHT_PATTERN = new RegExp(
  `new\\s+(?:THREE\\.)?(${CENSUS_LIGHTS.join('|')})\\s*\\(`,
  'g',
);

/**
 * A clone is the spelling `new` misses entirely: `sunLight.clone()` hands back
 * a second DirectionalLight, and adding it relinks every lit material exactly
 * as a `new` would. Matched on the receiver's NAME, since a source scan has no
 * types: any identifier ending in `Light`, plus the world rig's two fields by
 * their literal names. `this.sun` and `this.hemi` are spelled out rather than a
 * bare `sun`, because src/render's `sun` locals are Vector3 directions
 * (sky.ts, gfx.ts) that clone all the time and a name-only rule cannot tell
 * those apart.
 */
const LIGHT_CLONE_PATTERN = /(?:\w*Light|this\.sun|this\.hemi)\s*\.clone\s*\(/g;

interface CensusEntry {
  /** The classes this file is allowed to construct (`clone` for a light copy). */
  readonly kinds: readonly CensusProducer[];
  /** One line: why a light here cannot relink the world scene after boot. */
  readonly reason: string;
}

/** Every file under src/render that may construct a census-keyed light, each
 *  with the reason it is safe. Derived by reading the tree, not by absorbing
 *  whatever the scan happened to find. */
const ALLOWED: Readonly<Record<string, CensusEntry>> = {
  'renderer.ts': {
    kinds: ['HemisphereLight', 'DirectionalLight'],
    reason:
      'the one world rig: the sun and hemisphere the Renderer constructor builds before any content, re-graded per fog state by interior_light_rig.ts and never re-created',
  },
  'foliage_impostor.ts': {
    kinds: ['HemisphereLight'],
    reason:
      'the impostor atlas bake lights a PRIVATE scene rendered into a render target, so it is never part of the world light census',
  },
  'characters/preview.ts': {
    kinds: ['HemisphereLight', 'DirectionalLight'],
    reason:
      "the character-creation / paperdoll preview's own secondary GL context: its own scene, built once in its constructor",
  },
  'characters/portrait.ts': {
    kinds: ['HemisphereLight', 'DirectionalLight'],
    reason:
      "the offscreen portrait headshot rig's own secondary GL context: its own scene, built once when the rig is minted",
  },
  'armory_preview.ts': {
    kinds: ['DirectionalLight'],
    reason:
      "the armory store preview's own secondary GL context: key/fill/rim in its own scene, built once at mount and only re-aimed per preset",
  },
  'wildheart_props.ts': {
    kinds: ['HemisphereLight', 'DirectionalLight'],
    reason:
      'THE NAMED EXCEPTION: the Wildheart caldera interior rig adds a hemisphere and a directional light to the world scene when the interior builds, which is why its buildInterior arm is a deliberate ungated scene.add (pinned in tests/renderer_compile_gate.test.ts); pre-linking a scene-wide light census is backlog, not a precedent',
  },
};

/** The other trees that can reach the world scene graph. src/game and src/ui
 *  own no light today; the scan is here so the first one fails loudly instead
 *  of landing in a tree this census never looked at. src/editor DOES compose
 *  the real Renderer (src/editor/3d/viewport.ts), so it is scanned on the same
 *  terms as src/render: one allowlist row, one reason. */
const OUTSIDE_ROOTS: readonly {
  label: string;
  root: string;
  files: number;
  allowed: Readonly<Record<string, CensusEntry>>;
}[] = [
  {
    label: 'src/game',
    root: fileURLToPath(new URL('../src/game', import.meta.url)),
    files: 100,
    allowed: {},
  },
  {
    label: 'src/ui',
    root: fileURLToPath(new URL('../src/ui', import.meta.url)),
    files: 500,
    allowed: {},
  },
  {
    label: 'src/editor',
    root: fileURLToPath(new URL('../src/editor', import.meta.url)),
    files: 30,
    allowed: {
      'asset_thumbs.ts': {
        kinds: ['DirectionalLight'],
        reason:
          "the asset-browser thumbnail rig's own secondary GL context: a lazily created offscreen WebGLRenderer with its own scene, built once with the context and never added to the world scene the editor viewport composes",
      },
    },
  },
];

function censusHits(source: string): CensusProducer[] {
  const kinds = new Set<CensusProducer>();
  for (const match of source.matchAll(CENSUS_LIGHT_PATTERN)) kinds.add(match[1] as CensusLight);
  if (LIGHT_CLONE_PATTERN.test(source)) kinds.add('clone');
  LIGHT_CLONE_PATTERN.lastIndex = 0;
  return [...kinds].sort();
}

function scanTree(root: string): { files: number; hits: Map<string, CensusProducer[]> } {
  const files = tsFilesUnder(root);
  const hits = new Map<string, CensusProducer[]>();
  for (const { file, full } of files) {
    // Full-line comments are stripped first: the relink hazard is explained in
    // prose right beside the code all over this tree (point_light_budget.ts,
    // fire_light_registry.ts), and a sentence naming DirectionalLight must not
    // register as a producer.
    const kinds = censusHits(codeWithoutLineComments(readFileSync(full, 'utf8')));
    if (kinds.length > 0) hits.set(file, kinds);
  }
  return { files: files.length, hits };
}

const scanRenderTree = (): { files: number; hits: Map<string, CensusProducer[]> } =>
  scanTree(RENDER_ROOT);

describe('the src/render light census', () => {
  it('knows exactly these files, and no more', () => {
    // The allowlist IS the ruling, so its shape is pinned rather than left to
    // whatever a future row adds: a new row is a decision someone made on
    // purpose, and it fails here first.
    expect(Object.keys(ALLOWED).sort()).toEqual([
      'armory_preview.ts',
      'characters/portrait.ts',
      'characters/preview.ts',
      'foliage_impostor.ts',
      'renderer.ts',
      'wildheart_props.ts',
    ]);
  });

  it('scans the whole tree through the shared walker, and the corpus is not empty', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
    const { files, hits } = scanRenderTree();
    // Vacuity floor: src/render is a large tree with a deep characters/ and
    // ability_vfx/ under it, so a walk that returned a handful of files has
    // silently narrowed and every assertion below would pass on nothing.
    expect(files).toBeGreaterThan(300);
    expect(hits.size).toBeGreaterThan(0);
  });

  it('constructs a census-keyed light only in the allowlisted files', () => {
    const { hits } = scanRenderTree();
    const unexpected = [...hits.keys()].filter((file) => ALLOWED[file] === undefined).sort();
    expect(
      unexpected,
      `a directional/hemisphere/spot/rect-area light is constructed in a file this census does not know about. Each of those counts is a three program-cache-key input, so adding, removing, or hiding one relinks every lit material in view. Give it a prewarm home or a gate (src/render/CLAUDE.md, "GPU work: every new producer is a client of the scheduler") and dispatch render-performance-reviewer; do NOT allowlist it silently.`,
    ).toEqual([]);
  });

  it('holds each allowlisted file to the light classes its reason covers', () => {
    const { hits } = scanRenderTree();
    for (const [file, entry] of Object.entries(ALLOWED)) {
      expect(
        hits.get(file),
        `${file} no longer constructs a census-keyed light: drop its row`,
      ).toBeDefined();
      expect(
        hits.get(file),
        `${file} constructs a light class its census reason does not cover (${entry.reason})`,
      ).toEqual([...entry.kinds].sort());
    }
  });

  it('gives every allowlisted file a real reason', () => {
    for (const [file, entry] of Object.entries(ALLOWED)) {
      expect(entry.kinds.length, `${file} has an empty kind list`).toBeGreaterThan(0);
      // A reason has to say WHY the light cannot relink the world scene after
      // boot; a placeholder ("ok", "see above") is the row that lets the next
      // producer in.
      expect(entry.reason.length, `${file} needs a real reason`).toBeGreaterThan(40);
    }
  });

  it('names the world rig, the secondary contexts, and the one exception', () => {
    // The shape of the list is itself the rule: a light belongs to the boot
    // constructor, to a context that is not the world, or to the one arm that
    // is already documented as a defect with a backlog item.
    expect(ALLOWED['renderer.ts'].reason).toContain('constructor');
    for (const context of ['characters/preview.ts', 'characters/portrait.ts', 'armory_preview.ts'])
      expect(ALLOWED[context].reason).toContain('secondary GL context');
    expect(ALLOWED['wildheart_props.ts'].reason).toContain('NAMED EXCEPTION');
    expect(ALLOWED['wildheart_props.ts'].reason).toContain('backlog');
  });

  it('constructs a census-keyed light outside src/render only where allowlisted', () => {
    // The HUD, the input layer and the game-loop glue own no scene lights, and
    // the editor owns exactly one, in its own offscreen context: a light minted
    // anywhere else here would relink the world census from a tree this pin
    // never used to look at. The zero is not vacuous, because the matcher is
    // proven on fixtures below and each tree carries a file-count floor.
    for (const { label, root, files, allowed } of OUTSIDE_ROOTS) {
      const scan = scanTree(root);
      expect(scan.files, `${label} walk narrowed`).toBeGreaterThan(files);
      expect(
        [...scan.hits.keys()].filter((file) => allowed[file] === undefined).sort(),
        `${label} constructs or clones a census-keyed light. Each of those counts is a three program-cache-key input, so it relinks every lit material in view. Give it a prewarm home or a gate (src/render/CLAUDE.md) and dispatch render-performance-reviewer; do NOT allowlist it silently.`,
      ).toEqual([]);
      for (const [file, entry] of Object.entries(allowed)) {
        expect(
          scan.hits.get(file),
          `${label}/${file} no longer constructs a census-keyed light: drop its row`,
        ).toEqual([...entry.kinds].sort());
        expect(entry.reason.length, `${label}/${file} needs a real reason`).toBeGreaterThan(40);
      }
    }
  });

  it('scans src/editor because it composes the real Renderer', () => {
    // The editor viewport builds a live Sim and hands it to the game Renderer,
    // so a light added anywhere in that tree reaches the SAME world scene the
    // census governs. The one row it carries is an offscreen thumbnail rig.
    const editor = OUTSIDE_ROOTS.find((entry) => entry.label === 'src/editor');
    expect(editor).toBeDefined();
    expect(Object.keys(editor?.allowed ?? {})).toEqual(['asset_thumbs.ts']);
    const viewport = readFileSync(new URL('../src/editor/3d/viewport.ts', import.meta.url), 'utf8');
    expect(viewport).toContain("import { Renderer } from '../../render/renderer'");
  });

  it('detects every spelling a producer could use (positive control)', () => {
    const namespaced = 'const sun = new THREE.DirectionalLight(0xffffff, 1);';
    const namedImport = 'const hemi = new HemisphereLight(0xffffff, 0x444444, 1);';
    const spaced = 'const spot = new  THREE.SpotLight (0xffffff);';
    const rect = 'scene.add(new RectAreaLight(0xffffff, 5, 4, 4));';
    expect(censusHits([namespaced, namedImport, spaced, rect].join('\n'))).toEqual([
      'DirectionalLight',
      'HemisphereLight',
      'RectAreaLight',
      'SpotLight',
    ]);
    // A point light is out of scope here: it has a pad budget of its own.
    expect(censusHits('const p = new THREE.PointLight(0xffffff, 5, 10, 2);')).toEqual([]);
    // A CLONE is a producer too, whatever the receiver is called.
    expect(censusHits('const extra = sunLight.clone();')).toEqual(['clone']);
    expect(censusHits('const extra = this.sun.clone( true );')).toEqual(['clone']);
    expect(censusHits('rig.add(this.hemi.clone());')).toEqual(['clone']);
    // ... but a direction vector called `sun` is not a light, and src/render
    // clones those constantly.
    expect(censusHits('const dir = sunDir.clone().normalize();')).toEqual([]);
    expect(censusHits('const c = material.color.clone();')).toEqual([]);
    // Both spellings at once come back as both producers, sorted.
    expect(censusHits('new THREE.SpotLight(1); keyLight.clone();')).toEqual(['SpotLight', 'clone']);
    // ... and prose about the hazard is not a producer.
    expect(censusHits(codeWithoutLineComments('// never new THREE.DirectionalLight here'))).toEqual(
      [],
    );
  });
});
