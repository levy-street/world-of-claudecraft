// The registry-completeness pin of the WebGL context restore
// (src/render/context_restore_registry.ts). A WebGL context restore gives
// three an empty GPU state, so every record under src/render that says some
// GPU work is DONE (a set or flag named prepared, prewarmed, warmed, uploaded,
// ready, linked, compiled, touched, resident, started or claimed) either
// registers a reset or re-bake, or carries an exemption that says why the
// restore leaves it alone. The scan below finds the record shapes; the
// inventory answers each one. A new record with no answer fails here, which is
// what keeps the restore from quietly drifting back to stale proofs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_RESTORE_REBAKE_IDS,
  CONTEXT_RESTORE_RESET_IDS,
  type ContextRestoreRebakeId,
  type ContextRestoreResetId,
} from '../src/render/context_restore_registry';

const ROOT = join(__dirname, '..');
const RENDER = join(ROOT, 'src/render');

type Answer =
  | { reset: ContextRestoreResetId | ContextRestoreRebakeId; site?: string }
  | { exempt: string };

// Keyed `file:name` (a record re-assigned inside its module scans twice and
// answers once).
const INVENTORY: Record<string, Answer> = {
  'src/render/renderer.ts:prewarmedZonePrograms': {
    reset: 'renderer.zone-programs',
    site: 'src/render/context_restore.ts',
  },
  'src/render/renderer.ts:prewarmedMobTemplates': {
    reset: 'renderer.zone-programs',
    site: 'src/render/context_restore.ts',
  },
  'src/render/renderer.ts:prewarmedNpcModels': {
    reset: 'renderer.zone-programs',
    site: 'src/render/context_restore.ts',
  },
  'src/render/renderer.ts:preparedZones': {
    exempt:
      'CPU state: the zone geometry is built and survives; its GPU halves are the environment re-bake, the texture ledger and the program sets',
  },
  'src/render/renderer.ts:shutdownStarted': { exempt: 'renderer lifetime, not GPU state' },
  'src/render/texture_residency_ledger.ts:ready': { reset: 'texture-residency' },
  'src/render/hoard_entrance.ts:alreadyOpen': {
    exempt: 'the hatch pose read from the sim (a rift floor exists), not a GPU proof',
  },
  'src/render/vfx.ts:cloudWarmed': { reset: 'vfx-cloud' },
  'src/render/ability_vfx/overlay_sprites.ts:warmed': { reset: 'overlay-sprites' },
  'src/render/ability_vfx/ribbons.ts:warmed': { reset: 'ribbons' },
  'src/render/ability_vfx/guard_prewarm.ts:touched': { reset: 'guard-prewarm' },
  'src/render/ability_vfx/guard_prewarm.ts:uploaded': { reset: 'guard-prewarm' },
  'src/render/ability_vfx/crest_prewarm.ts:compiled': { reset: 'crest-prewarm' },
  'src/render/ability_vfx/crest_prewarm.ts:touched': { reset: 'crest-prewarm' },
  'src/render/ability_vfx/crest_prewarm.ts:uploaded': { reset: 'crest-prewarm' },
  'src/render/ability_vfx/painter.ts:warmedSpiritClasses': {
    exempt: 'CPU: the spirit GLB loads a first sighting starts, not a GPU proof',
  },
  'src/render/characters/visual.ts:linkedEffectMaterials': { reset: 'character-visual' },
  'src/render/characters/form_adornments.ts:moonwingLinked': { reset: 'form-adornments' },
  'src/render/characters/form_adornments.ts:veilLinked': { reset: 'form-adornments' },
  'src/render/post_shed.ts:twinReady': { reset: 'post-shed' },
  'src/render/interior_encounter_prewarm_pass.ts:startedByHost': {
    exempt:
      'the claimed SET survives (its bodies are built); the restore relinks the kept-alive roots instead (interior-encounter-prewarm)',
  },
  'src/render/interior_encounter_prewarm_pass.ts:liveWarmedByVisual': {
    reset: 'interior-encounter-prewarm',
  },
  'src/render/linked_program_readiness.ts:knownReady': {
    exempt:
      'keyed by the program object: the restored context mints new programs, which start unproven',
  },
  'src/render/glider_course_visual.ts:ready': {
    exempt:
      'a gated attach already revealed: drawn content, linked by the hold or the resident debt',
  },
  'src/render/wisp_maze_visual.ts:ready': {
    exempt:
      'a gated attach already revealed: drawn content, linked by the hold or the resident debt',
  },
  'src/render/shadow_infiltration_visual.ts:ready': {
    exempt:
      'a gated attach already revealed: drawn content, linked by the hold or the resident debt',
  },
  'src/render/fenbridge_town.ts:preparedTemplates': { exempt: 'CPU: parsed asset templates' },
  'src/render/eastbrook_town.ts:preparedTemplates': { exempt: 'CPU: parsed asset templates' },
  'src/render/quest_objects.ts:preparedByItem': { exempt: 'CPU: built object templates' },
  'src/render/streetlamp_assets.ts:preparedAssets': { exempt: 'CPU: parsed asset templates' },
  'src/render/nythraxis_prop_assets.ts:preparedAssets': { exempt: 'CPU: parsed asset templates' },
  'src/render/characters/assets.ts:prepared': { exempt: 'CPU: parsed character definitions' },
  'src/render/characters/assets.ts:characterAssetReadyListeners': {
    exempt: 'CPU: asset-load listeners',
  },
  'src/render/characters/assets.ts:streamedStarted': { exempt: 'CPU: the asset stream started' },
  'src/render/characters/portrait.ts:readyListeners': {
    exempt: 'CPU: asset-load listeners of the portrait context',
  },
  'src/render/characters/portrait.ts:assetsAreReady': {
    exempt: 'CPU: asset-load state of the portrait context',
  },
  'src/render/characters/warrior_rush_pose.ts:arrivalStarted': {
    exempt: 'animation state, not GPU state',
  },
};

// Records the scan cannot see by shape (closure latches, object-literal
// fields, keyed maps) that the restore answers all the same: pinned so a
// rename cannot silently drop their registration.
const SHAPELESS_RECORDS: {
  file: string;
  record: string;
  id: ContextRestoreResetId | ContextRestoreRebakeId;
}[] = [
  { file: 'src/render/cast_vfx_prewarm.ts', record: 'readyBits', id: 'cast-vfx-readiness' },
  { file: 'src/render/reveal_gate.ts', record: 'warm keys', id: 'reveal-gate' },
  { file: 'src/render/occluder_fade_gate.ts', record: 'escalated', id: 'occluder-fade-gate' },
  { file: 'src/render/ability_vfx/active_kit_prewarm.ts', record: 'done', id: 'active-kit' },
  { file: 'src/render/ability_vfx/spirits.ts', record: 'compiled', id: 'spirit-apparitions' },
  { file: 'src/render/ability_vfx/guard_prewarm.ts', record: 'compiled', id: 'guard-prewarm' },
  { file: 'src/render/grass_ground_bake.ts', record: 'activeBake', id: 'grass-ground-bake' },
  { file: 'src/render/foliage_impostor.ts', record: 'liveAtlas', id: 'impostor-atlas' },
  { file: 'src/render/scene_sampling.ts', record: 'target', id: 'scene-sampling' },
  { file: 'src/render/context_restore.ts', record: 'envRTs', id: 'environment-maps' },
  { file: 'src/render/context_restore.ts', record: 'selfSpirit.warmed', id: 'self-spirit' },
];

const NAMES =
  '(?:[Pp]repared|[Pp]rewarmed|[Ww]armed|[Uu]ploaded|[Rr]eady|[Ll]inked|[Cc]ompiled|[Tt]ouched|[Rr]esident|[Ss]tarted|[Cc]laimed)';
const VALUE = '=\\s*(?:new (?:Weak)?(?:Set|Map)\\b|false\\b)';
// A class field (two-space indent, a modifier or a bare field) or a
// module-scope binding.
const FIELD = new RegExp(
  `^  (?:(?:private|protected|public|readonly) )*([A-Za-z_]*${NAMES}[A-Za-z_]*)\\s*(?::[^=;]{0,80})?${VALUE}`,
);
const MODULE = new RegExp(
  `^(?:let|const) ([A-Za-z_]*${NAMES}[A-Za-z_]*)\\s*(?::[^=;]{0,80})?${VALUE}`,
);

function renderFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...renderFiles(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

function scan(): Set<string> {
  const found = new Set<string>();
  for (const path of renderFiles(RENDER)) {
    const file = relative(ROOT, path).split('\\').join('/');
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = FIELD.exec(line) ?? MODULE.exec(line);
      if (match) found.add(`${file}:${match[1]}`);
    }
  }
  return found;
}

const source = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

/** Source with comments removed, so a registration named in a comment (or
 *  commented out) is never taken for a live one. */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

describe('every GPU "done" record answers what a context restore does to it', () => {
  const found = scan();

  it('the scan still sees the record shapes it exists for (a vacuous pattern would pass everything)', () => {
    expect(found.has('src/render/renderer.ts:prewarmedZonePrograms')).toBe(true);
    expect(found.has('src/render/ability_vfx/guard_prewarm.ts:uploaded')).toBe(true);
    expect(found.has('src/render/characters/visual.ts:linkedEffectMaterials')).toBe(true);
    // Bounded both ways: a pattern that widened into locals would flood the
    // inventory with noise, one that narrowed would pass everything.
    expect(found.size).toBeGreaterThanOrEqual(30);
    expect(found.size).toBeLessThanOrEqual(60);
  });

  it('every record the scan finds is registered for a reset or exempted with a reason', () => {
    const unanswered = [...found].filter((key) => !(key in INVENTORY)).sort();
    expect(
      unanswered,
      'register a reset (context_restore_registry.ts) next to each record, or add an exemption with its reason here',
    ).toEqual([]);
  });

  it('no inventory row outlives its record', () => {
    const stale = Object.keys(INVENTORY)
      .filter((key) => !found.has(key))
      .sort();
    expect(stale).toEqual([]);
  });

  it('every answered record is registered, by its owner, under a live id', () => {
    const missing: string[] = [];
    const answers: { file: string; id: string; site?: string }[] = [
      ...Object.entries(INVENTORY).flatMap(([key, answer]) =>
        'reset' in answer ? [{ file: key.split(':')[0], id: answer.reset, site: answer.site }] : [],
      ),
      ...SHAPELESS_RECORDS.map((row) => ({ file: row.file, id: row.id })),
    ];
    for (const { file, id, site } of answers) {
      const text = code(source(site ?? file));
      const call = new RegExp(`registerContextRestore(?:Reset|Rebake)\\(\\s*'${id}'`);
      if (!call.test(text)) missing.push(`${site ?? file} does not register '${id}'`);
    }
    expect(missing).toEqual([]);
  });

  it('every id is registered somewhere, and nowhere under a name outside the lists', () => {
    const ids = new Set<string>([...CONTEXT_RESTORE_RESET_IDS, ...CONTEXT_RESTORE_REBAKE_IDS]);
    const registered = new Set<string>();
    for (const path of renderFiles(RENDER)) {
      for (const match of code(readFileSync(path, 'utf8')).matchAll(
        /registerContextRestore(?:Reset|Rebake)\(\s*'([^']+)'/g,
      )) {
        registered.add(match[1]);
      }
    }
    expect([...registered].filter((id) => !ids.has(id))).toEqual([]);
    expect([...ids].filter((id) => !registered.has(id))).toEqual([]);
  });

  it('the renderer hands the restore host the zone program sets a teleport reads', () => {
    const renderer = source('src/render/renderer.ts');
    const surface = renderer.slice(
      renderer.indexOf('zoneProgramRecords: () => ['),
      renderer.indexOf('],', renderer.indexOf('zoneProgramRecords: () => [')),
    );
    for (const record of ['prewarmedZonePrograms', 'prewarmedMobTemplates', 'prewarmedNpcModels']) {
      expect(surface).toContain(`this.${record}`);
    }
    // ...and isZoneReadyAt reads the very set it clears, so a teleport into a
    // zone prepared before the loss takes its blocking arrival again.
    expect(renderer).toContain('programsPrewarmed: this.prewarmedZonePrograms.has(id),');
  });
});

describe('the restore is wired where the game runs it', () => {
  it('the renderer builds its restore host right after the context exists, and disposes it at shutdown', () => {
    const renderer = source('src/render/renderer.ts');
    const ctor = renderer.slice(
      renderer.indexOf('  constructor('),
      renderer.indexOf('initGfxTier(this.webgl)'),
    );
    expect(ctor).toContain('this.captureGlIdentity();');
    expect(ctor).toContain(
      'this.contextRestore = new ContextRestoreHost(this.contextRestoreSurface());',
    );
    const shutdown = renderer.slice(renderer.indexOf('  private beginRendererShutdown(): void'));
    expect(shutdown.slice(0, 1200)).toContain('this.contextRestore?.dispose();');
    // The beacon's loss and restore counters read the host.
    expect(renderer).toContain('contextLost: this.contextRestore?.snapshot().losses ?? 0,');
    expect(renderer).toContain('contextRestored: this.contextRestore?.snapshot().restores ?? 0,');
  });

  it('main.ts feeds the restore hold into worldDrawHeld and mounts the note', () => {
    const main = source('src/main.ts');
    expect(main).toContain('newPresentationGateInput(DESKTOP_APP, contextRestoreDrawHeld)');
    expect(main).toContain(
      "installGraphicsRestoreNote(document.getElementById('ui') ?? document.body);",
    );
  });

  it('the admission paces the cover while the restore hold stands', () => {
    const admission = source('src/render/gpu_prep_admission.ts');
    expect(admission).toContain('coverPaced: contextRestorePacingActive(),');
  });

  it('records outside src/render that answer to a restore', () => {
    // The ferry destination warm in main.ts dedupes on its own set; after a
    // restore the arrival itself re-checks isZoneReadyAt, which the restore
    // cleared, so the destination is prewarmed on arrival and this set only
    // loses the early warm. Pinned so a change to that set revisits the answer.
    const main = source('src/main.ts');
    expect(main).toContain('const ferryPrewarmed = new Set<string>();');
    expect(main).toContain(
      'if (!riftExit && !ferryRide && renderer.isZoneReadyAt(player.pos.x, player.pos.z)) return;',
    );
  });
});
