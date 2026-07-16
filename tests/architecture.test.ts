import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Enforces the two load-bearing src/sim invariants from the root CLAUDE.md as a
// real, always-on check instead of convention-only prose: the sim is the
// host-agnostic deterministic core, so it imports nothing from render/ui/game/net
// or Three.js, touches no DOM/browser globals, and draws no randomness or time
// from outside its seeded Rng + sim clock. A violation here means the same
// src/sim code can no longer run unchanged in Node, the browser, and the RL env,
// or that same-seed-same-world determinism is broken. Keep this green.
//
// It also guards the curated PURE CORES the HUD leans
// on: host-agnostic, DOM/Three-free, deterministic modules a Vitest imports
// directly (the unit_portrait.ts template and the per-element view cores hud.ts
// already imports). A registered pure core must not import three, a host layer it
// has no business in, or a DOM-owning *_painter / *_window / painter_host sibling: the
// core/painter split is the whole point, so a core reaching for a painter is the
// same hazard one import hop removed. The painters / DOM consumers themselves are
// deliberately NOT registered. Two allowlists, because the cores live in two
// layers: UI_PURE_CORES under src/ui, and RENDER_PURE_CORES for the one
// render-resident logic core (cast_bar, which the painter draws, while the core
// stays Three- and i18n-free).
//
// SCOPE OF THE SCAN: it is PER FILE, not transitive. A registered core's own
// import specifiers are checked, so "pure core" means this file's own surface is
// host-agnostic and unit-testable, not that its whole dependency closure is
// DOM-free (a core may import a sibling ui module like ./i18n that itself touches
// the DOM). That is fine: the load-bearing hazard this gate targets is a core
// reaching directly for three / a *_painter / painter_host, which IS caught.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const simRoot = join(repoRoot, 'src', 'sim');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

// On-disk pure-core candidates in the full UI tree: the modules
// named with the pure-core convention <thing>_view.ts / <thing>_core.ts. The
// COMPLETENESS sweep below asserts every one of these IS registered, so a new
// extraction that forgets to add its core to the allowlist fails the guard instead
// of silently escaping it. Bare-named cores (xp_bar.ts, swing_timer.ts, ...) are
// not caught by this convention; new extractions follow the *_view/*_core naming.
function onDiskCores(dir: string): string[] {
  return walk(dir).filter((file) => /_(?:view|core)\.ts$/.test(file) && !file.endsWith('.d.ts'));
}

// Blank out comments while preserving line count and column positions, so prose
// (a code comment that names Math.random, or "the search window") cannot create a
// false positive. String literals are left intact: the dotted patterns matched
// below (Math.random, window., ...) do not appear inside the sim's player text.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// A specifier a host-agnostic sim file must never import. Returns the offending
// layer/package, or null when the import is allowed.
function forbiddenImport(spec: string): string | null {
  if (spec === 'three' || spec.startsWith('three/')) return 'three';
  const layer = spec.match(/(?:^|\/)(render|ui|game|net)\//);
  return layer ? layer[1] : null;
}

// Same idea for a src/ui pure core: it lives in ui and may lean on sibling pure
// ui modules + host-agnostic sim types, so only three + render/game/net are
// forbidden layers. It also must not import a DOM-owning painter or the painter
// host: a core reaching for a *_painter, a *_window painter, or painter_host couples
// to the DOM one hop removed, defeating the split. (The *_window arm closes the
// gap where the char_window/market_window painters slipped the *_painter-only regex.)
function forbiddenUiCoreImport(spec: string): string | null {
  if (spec === 'three' || spec.startsWith('three/')) return 'three';
  const layer = spec.match(/(?:^|\/)(render|game|net)\//);
  if (layer) return layer[1];
  if (/(?:^|\/)(?:[a-z0-9_]+_(?:painter|window)|painter_host)$/.test(spec)) return 'painter';
  return null;
}

// Same idea for a render-resident pure logic core (cast_bar): it lives in render,
// so a render sibling import is allowed, but it must stay Three-free (the painter
// owns the Three drawing) and must not import game/net or a DOM-owning *_painter /
// *_window painter. It must ALSO stay i18n-free (the file header): the core emits stable
// discriminators (the raw cast id, the eat/drink mode) that the painter localizes,
// so importing the i18n runtime (t/tEntity/formatNumber from any *i18n module) is
// forbidden. That makes a t() call in the core fail this guard, not just the header.
function forbiddenRenderCoreImport(spec: string): string | null {
  if (spec === 'three' || spec.startsWith('three/')) return 'three';
  const layer = spec.match(/(?:^|\/)(game|net)\//);
  if (layer) return layer[1];
  if (/(?:^|\/)(?:[a-z0-9_]+_(?:painter|window)|painter_host)$/.test(spec)) return 'painter';
  if (/(?:^|\/)[a-z_]*i18n$/.test(spec)) return 'i18n';
  return null;
}

const IMPORT_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const DYN_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DOM_GLOBAL_RE = /\b(document|window|navigator|localStorage|sessionStorage)\s*[.[]/;
const NONDETERMINISM_RE = /\b(Math\.random|Date\.now|performance\.now)\b/;

const simFiles = walk(simRoot);

// Curated src/ui pure cores: host-agnostic view models hud.ts imports, each
// paired with a DOM painter that is deliberately NOT registered here. Seeded with
// the cores that already exist on v0.16.0; extend as new pure cores land (later
// HUD extractions). The forbiddenUiCoreImport guard forbids three +
// render/game/net + a DOM-owning painter, so it also fits a render-importable
// game LEAF: src/game/ui_effects_profile.ts is a pure resolver that imports
// nothing (gfx.ts imports its EFFECTS_QUALITY_LOW_CUTOFF, a render->game leaf
// import), so it is registered here even though it lives in src/game. Paths are
// repo-relative for the failure messages.
const UI_PURE_CORES = [
  'src/ui/camera_prompt_core.ts',
  'src/ui/chat_ignore_core.ts',
  'src/ui/char_bags_pairing_core.ts',
  'src/ui/equip_drop_core.ts',
  'src/ui/log_event_route.ts',
  'src/ui/unit_portrait.ts',
  'src/ui/xp_bar.ts',
  'src/ui/absorb_bar.ts',
  'src/ui/party_frames.ts',
  'src/ui/party_collapse.ts',
  'src/ui/rest_indicator.ts',
  'src/ui/low_health.ts',
  'src/ui/low_resource.ts',
  'src/ui/clock.ts',
  'src/ui/compass.ts',
  'src/ui/coords.ts',
  'src/ui/hud/quest/quest_tracker.ts',
  'src/ui/hud/delve/delve_map.ts',
  'src/ui/raid_lockout_view.ts',
  'src/ui/stat_tooltip_view.ts',
  'src/ui/target_portrait_view.ts',
  'src/ui/target_rank_view.ts',
  'src/ui/mob_tooltip_view.ts',
  'src/ui/talents_view.ts',
  'src/ui/social_view.ts',
  'src/ui/bags_view.ts',
  'src/ui/bank_view.ts',
  'src/ui/item_set_tooltip_view.ts',
  'src/ui/weapon_proc_view.ts',
  'src/ui/options_view.ts',
  'src/ui/hud/vendor/vendor_view.ts',
  'src/ui/hud/vendor/heroic_vendor_view.ts',
  'src/ui/claudium_view.ts',
  'src/ui/woc_store_view.ts',
  'src/ui/hud/loot/loot_roll_status_view.ts',
  'src/ui/hud/loot/loot_settings_view.ts',
  'src/ui/crafting_view.ts',
  'src/ui/market_view.ts',
  'src/ui/mailbox_view.ts',
  'src/ui/calendar_view.ts',
  'src/ui/char_view.ts',
  'src/ui/map_window_view.ts',
  'src/ui/map_quest_list_view.ts',
  'src/ui/arena_window_view.ts',
  'src/ui/dungeon_finder_view.ts',
  'src/ui/yumi_match_view.ts',
  'src/ui/vale_cup_window_view.ts',
  'src/ui/vale_cup_indicator_view.ts',
  'src/ui/vale_cup_hud_view.ts',
  'src/ui/vale_cup_briefing_view.ts',
  'src/ui/vale_cup_betting_view.ts',
  'src/ui/vale_cup_charge_view.ts',
  'src/ui/leaderboard_view.ts',
  'src/ui/guild_leaderboard_view.ts',
  'src/ui/dev_leaderboard_view.ts',
  'src/ui/dev_command_view.ts',
  'src/ui/deeds_leaderboard_view.ts',
  'src/ui/daily_rewards_view.ts',
  'src/ui/deeds_view.ts',
  'src/ui/spellbook_view.ts',
  'src/ui/hud/quest/questlog_view.ts',
  'src/ui/swing_timer.ts',
  'src/ui/unit_frame.ts',
  'src/ui/hud/action_bar/action_bar_view.ts',
  'src/ui/hud/action_bar/mobile_action_page_view.ts',
  'src/ui/hud/action_bar/consumable_bar_view.ts',
  'src/ui/mobile_hud_layout.ts',
  'src/ui/auras_view.ts',
  'src/ui/minimap_markers.ts',
  'src/ui/gathering_view.ts',
  'src/ui/fct_core.ts',
  'src/ui/fct_event.ts',
  'src/ui/window_drag_core.ts',
  'src/ui/window_resize_core.ts',
  'src/ui/window_stack_state_core.ts',
  'src/ui/focus_order.ts',
  'src/ui/roving_index.ts',
  'src/ui/live_region_politeness.ts',
  'src/ui/discord_widget_view.ts',
  'src/ui/desktop_update_view.ts',
  'src/ui/hud/loot/corpse_harvest_view.ts',
  'src/ui/town_focus_view.ts',
  'src/ui/pet_action_icons.ts',
  'src/game/ui_effects_profile.ts',
  'src/game/ui_tier_knobs.ts',
].map((rel) => join(repoRoot, rel));

// Pure logic cores that live in src/render (the painter half is Three-side):
// cast_bar (the overhead cast/channel state) and nameplate_view (the per-entity
// nameplate visibility / anchor / threat / combo model). Each emits state
// from sim types with no Three import and no i18n, so a NameplatePainter /
// cast_bar painter draws it and a Vitest drives it directly.
// terrain_region_core (editor partial-rebuild chunk/texel selection math) and
// water_core (the shore-depth sample shared by build + editor setLevel) follow
// the same contract for the map editor's realtime terrain/water edits.
const RENDER_PURE_CORES = [
  'src/render/cast_bar.ts',
  'src/render/delve_interactable_visibility_core.ts',
  'src/render/nameplate_view.ts',
  'src/render/net_interp_core.ts',
  'src/render/terrain_region_core.ts',
  'src/render/water_core.ts',
].map((rel) => join(repoRoot, rel));

// Bare-named pure cores: registered cores (from UI_PURE_CORES + RENDER_PURE_CORES)
// whose basename does NOT end in _view / _core, so the onDiskCores() sweep's
// /_(?:view|core)\.ts$/ regex cannot reach them. Bare names are enforced by this
// curated cross-check while *_view / *_core are auto-swept by onDiskCores(): each
// entry below must still exist on disk AND stay registered in its allowlist, so
// deleting or renaming a bare core (e.g. xp_bar.ts -> xp_bar_view.ts without
// updating this list) fails the cross-check instead of silently escaping the
// reverse-completeness guard.
const BARE_NAMED = [
  'src/ui/unit_portrait.ts',
  'src/ui/xp_bar.ts',
  'src/ui/absorb_bar.ts',
  'src/ui/party_frames.ts',
  'src/ui/party_collapse.ts',
  'src/ui/rest_indicator.ts',
  'src/ui/low_health.ts',
  'src/ui/low_resource.ts',
  'src/ui/clock.ts',
  'src/ui/compass.ts',
  'src/ui/coords.ts',
  'src/ui/hud/quest/quest_tracker.ts',
  'src/ui/hud/delve/delve_map.ts',
  'src/ui/swing_timer.ts',
  'src/ui/unit_frame.ts',
  'src/ui/minimap_markers.ts',
  'src/ui/fct_event.ts',
  'src/ui/focus_order.ts',
  'src/ui/roving_index.ts',
  'src/ui/live_region_politeness.ts',
  'src/ui/log_event_route.ts',
  'src/ui/mobile_hud_layout.ts',
  'src/ui/pet_action_icons.ts',
  'src/game/ui_effects_profile.ts',
  'src/game/ui_tier_knobs.ts',
  'src/render/cast_bar.ts',
].map((rel) => join(repoRoot, rel));

function importSpecs(src: string): string[] {
  const specs: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) specs.push(m[1]);
  for (const m of src.matchAll(DYN_IMPORT_RE)) specs.push(m[1]);
  return specs;
}

function scanImports(files: string[], forbid: (spec: string) => string | null): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const spec of importSpecs(src)) {
      const bad = forbid(spec);
      if (bad) violations.push(`${relative(repoRoot, file)} imports '${spec}' (${bad})`);
    }
  }
  return violations;
}

function scanLines(files: string[], re: RegExp): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (re.test(line)) violations.push(`${relative(repoRoot, file)}:${i + 1}  ${line.trim()}`);
    });
  }
  return violations;
}

describe('src/sim architecture invariants', () => {
  it('finds the sim source tree', () => {
    expect(simFiles.length).toBeGreaterThan(10);
  });

  it('imports nothing from render/ui/game/net or three (host-agnostic core)', () => {
    const violations = scanImports(simFiles, forbiddenImport);
    expect(violations, `src/sim must stay host-agnostic:\n${violations.join('\n')}`).toEqual([]);
  });

  it('touches no DOM/browser globals', () => {
    const violations = scanLines(simFiles, DOM_GLOBAL_RE);
    expect(
      violations,
      `src/sim must run headless (no DOM globals):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('draws no randomness or wall-clock time outside Rng + the sim clock', () => {
    const violations = scanLines(simFiles, NONDETERMINISM_RE);
    expect(
      violations,
      `all sim randomness/time goes through Rng (src/sim/rng.ts) and the sim clock:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// IWorld seam purity (W1b). The seam render/ui depend on is src/world_api.ts (the
// aggregate interface + the COMMAND_NAMES wire table) plus every facet interface
// under src/world_api/. W1 split IWorld into those files as a string-free,
// TYPE-ONLY boundary: every host (render/ui/game/net) and the server talk to the
// world ONLY through it, so it sits ABOVE them and must import nothing from
// render/ui/game/net/server (or DOM/Three), pull only TYPES from src/sim (a value
// sim import would drag the deterministic engine into the seam), and run no
// i18n/UI logic (no t()/tSim()/tServer()). Without this scan the facet files'
// purity is convention-only; a later W6-W10 re-home could add a net/ui import or a
// t() call to a facet and no gate would redden. This closes that gap. The one
// blessed value site is COMMAND_NAMES (world_api.ts); string literals are NOT
// banned (only imports + DOM + i18n calls are). chat.ts's OVERHEAD_EMOTES +
// isOverheadEmoteId derive their runtime id set from OVERHEAD_EMOTES itself
// (not sim/types' OVERHEAD_EMOTE_IDS), so there is currently no sanctioned
// runtime sim import; SANCTIONED_VALUE_SIM_IMPORTS below stays as the escape
// valve for a future one.

const worldApiEntry = join(repoRoot, 'src', 'world_api.ts');
const worldApiRoot = join(repoRoot, 'src', 'world_api');
const worldApiFiles = [worldApiEntry, ...walk(worldApiRoot)];

// IMPORT_RE, widened with a leading binding-clause capture (group 1) so the seam
// pass can tell a type-only sim import (`import type {T}` or every specifier
// inline `type`-prefixed) from a value one. Group 2 is the module specifier.
const SEAM_IMPORT_RE = /\b(?:import|export)\b([^;'"]*?)\bfrom\s*['"]([^'"]+)['"]/g;

// i18n / runtime-UI calls the type-only seam must never make.
const I18N_CALL_RE = /\b(?:tSim|tServer|t)\s*\(/;

// A specifier the IWorld seam must never import: the host layers, the server, and
// Three. The seam sits above all of them (they depend on it, never the reverse).
// Returns the offending layer/package, or null when the import is allowed.
function forbiddenSeamImport(spec: string): string | null {
  if (spec === 'three' || spec.startsWith('three/')) return 'three';
  const layer = spec.match(/(?:^|\/)(render|ui|game|net|server)\//);
  return layer ? layer[1] : null;
}

// True when the specifier resolves into src/sim (`../sim/...`, `./sim/...`).
function isSimSpecifier(spec: string): boolean {
  return /(?:^|\/)sim\//.test(spec);
}

// The runtime (value) bindings an import clause brings in. Empty for a type-only
// import: a statement-level `import type {...}`, or a named import whose every
// specifier is inline `type`-prefixed. Returns SOURCE names (the part before
// `as`), for allowlist matching and reporting.
function runtimeBindings(clause: string): string[] {
  const trimmed = clause.trim();
  if (trimmed === 'type' || trimmed.startsWith('type ')) return [];
  const brace = trimmed.match(/\{([^}]*)\}/);
  const names = brace
    ? brace[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : trimmed
      ? [trimmed]
      : [];
  return names
    .filter((n) => n !== 'type' && !n.startsWith('type '))
    .map((n) => n.split(/\s+as\s+/)[0].trim());
}

// Any sanctioned runtime sim import on the seam, keyed by repo-relative file
// (forward-slash form: see posixRel below, since `relative()` yields backslashes
// on Windows). Currently empty (chat.ts derives its runtime id set from its own
// OVERHEAD_EMOTES instead of value-importing sim/types' OVERHEAD_EMOTE_IDS); kept
// as the escape valve for a future legitimate case. Any value sim import not
// listed here, in any facet, reddens the gate: this is a per-site allowlist, not
// a blanket file-level exemption. (The flip side, that chat.ts's local
// OVERHEAD_EMOTES stays complete against sim/types' OVERHEAD_EMOTE_IDS so the
// decoupled id set cannot silently drift, is guarded in overhead_emote_parity.test.ts.)
const SANCTIONED_VALUE_SIM_IMPORTS: Record<string, ReadonlySet<string>> = {};

// Normalizes a relative() path to forward slashes so the allowlist above (and
// its keys, always written posix-style) matches on Windows too.
function posixRel(rel: string): string {
  return rel.split('\\').join('/');
}

describe('src/world_api IWorld seam purity invariants', () => {
  it('finds the IWorld seam (world_api.ts + every facet file)', () => {
    expect(worldApiFiles).toContain(worldApiEntry);
    // world_api.ts + the 20 facet files; tolerant of the seam growing.
    expect(worldApiFiles.length).toBeGreaterThanOrEqual(20);
  });

  it('imports nothing from render/ui/game/net/server or three (the seam sits above them)', () => {
    const violations: string[] = [];
    for (const file of worldApiFiles) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const specs: string[] = [];
      for (const m of src.matchAll(SEAM_IMPORT_RE)) specs.push(m[2]);
      for (const m of src.matchAll(DYN_IMPORT_RE)) specs.push(m[1]);
      for (const spec of specs) {
        const bad = forbiddenSeamImport(spec);
        if (bad) violations.push(`${relative(repoRoot, file)} imports '${spec}' (${bad})`);
      }
    }
    expect(
      violations,
      `the IWorld seam must stay layer-agnostic:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('pulls only TYPES from src/sim (a value sim import would drag the engine into the seam)', () => {
    const violations: string[] = [];
    for (const file of worldApiFiles) {
      const rel = relative(repoRoot, file);
      const allowed = SANCTIONED_VALUE_SIM_IMPORTS[posixRel(rel)] ?? new Set<string>();
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(SEAM_IMPORT_RE)) {
        const [, clause, spec] = m;
        if (!isSimSpecifier(spec)) continue;
        for (const name of runtimeBindings(clause)) {
          if (!allowed.has(name)) {
            violations.push(
              `${rel} value-imports '${name}' from '${spec}' (sim imports must be type-only)`,
            );
          }
        }
      }
    }
    expect(
      violations,
      `the IWorld seam imports src/sim for TYPES only (use \`import type\`):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('makes no t()/tSim()/tServer() i18n call (no runtime UI logic on the type-only seam)', () => {
    const violations = scanLines(worldApiFiles, I18N_CALL_RE);
    expect(
      violations,
      `the IWorld seam is i18n-free (render/ui localize on their side):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('touches no DOM/browser globals', () => {
    const violations = scanLines(worldApiFiles, DOM_GLOBAL_RE);
    expect(
      violations,
      `the IWorld seam must run headless (no DOM globals):\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});

describe('src/ui pure-core invariants', () => {
  it('lists only files that exist (the curated pure cores)', () => {
    const missing = UI_PURE_CORES.filter((f) => !statSync(f).isFile());
    expect(missing, `curated src/ui pure core missing:\n${missing.join('\n')}`).toEqual([]);
  });

  // COMPLETENESS: the reverse of the existence check above. The other scans
  // only prove the LISTED cores are clean; this proves the converse - every on-disk
  // src/ui *_view / *_core IS registered - so a future extraction that names a pure
  // core <thing>_view.ts but forgets to add it to UI_PURE_CORES fails here instead
  // of silently escaping the purity / determinism scans. src/guide is a separate SPA
  // layer (src/guide/CLAUDE.md), not a hud.ts-consumed core, so it is out of scope.
  it('registers every on-disk src/ui *_view / *_core pure core (completeness)', () => {
    const registered = new Set(UI_PURE_CORES);
    const unregistered = onDiskCores(join(repoRoot, 'src', 'ui')).filter((f) => !registered.has(f));
    expect(
      unregistered.map((f) => relative(repoRoot, f)),
      `every src/ui *_view/*_core must be in UI_PURE_CORES (register it if pure, or rename it if it is not a pure core):\n${unregistered.join('\n')}`,
    ).toEqual([]);
  });

  it('imports nothing from render/game/net, three, or a DOM-owning painter (host-agnostic, unit-testable)', () => {
    const violations = scanImports(UI_PURE_CORES, forbiddenUiCoreImport);
    expect(
      violations,
      `src/ui pure cores must stay host-agnostic:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('touches no DOM/browser globals', () => {
    const violations = scanLines(UI_PURE_CORES, DOM_GLOBAL_RE);
    expect(
      violations,
      `src/ui pure cores must run headless (no DOM globals):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('draws no randomness or wall-clock time (deterministic: same input -> same output)', () => {
    const violations = scanLines(UI_PURE_CORES, NONDETERMINISM_RE);
    expect(
      violations,
      `src/ui pure cores must be deterministic (no Math.random/Date.now/performance.now):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  // Teeth check: the scans above only prove the registered cores are CLEAN today.
  // This pins the matcher itself so a future weakening (a regex typo, a dropped
  // branch) cannot silently let a core import a forbidden layer and stay green.
  // It makes the "the guard must still FAIL on an injected forbidden
  // import" acceptance step a durable regression test instead of a manual ritual.
  it('forbiddenUiCoreImport flags every forbidden layer and allows the permitted ones', () => {
    // three (the renderer dependency), in both the bare and submodule forms.
    expect(forbiddenUiCoreImport('three')).toBe('three');
    expect(forbiddenUiCoreImport('three/examples/jsm/controls/OrbitControls')).toBe('three');
    // render / game / net layers, however the relative path reaches them.
    expect(forbiddenUiCoreImport('../render/characters/assets')).toBe('render');
    expect(forbiddenUiCoreImport('../../render/renderer')).toBe('render');
    expect(forbiddenUiCoreImport('../game/audio')).toBe('game');
    expect(forbiddenUiCoreImport('../net/client_world')).toBe('net');
    // A DOM-owning *_painter, a *_window painter, or the painter host (DOM coupling one hop
    // removed; the *_window arm closes the gap where char_window/market_window slipped).
    expect(forbiddenUiCoreImport('./delve_map_painter')).toBe('painter');
    expect(forbiddenUiCoreImport('./painter_host')).toBe('painter');
    expect(forbiddenUiCoreImport('./char_window')).toBe('painter');
    expect(forbiddenUiCoreImport('./market_window')).toBe('painter');
    // Permitted: host-agnostic sim types/data and sibling pure ui cores.
    expect(forbiddenUiCoreImport('../sim/types')).toBeNull();
    expect(forbiddenUiCoreImport('../sim/data')).toBeNull();
    expect(forbiddenUiCoreImport('./market_filters')).toBeNull();
    expect(forbiddenUiCoreImport('./entity_i18n')).toBeNull();
  });
});

describe('purity scan matchers keep their teeth (the shared DOM / determinism regexes)', () => {
  // The DOM-global + nondeterminism scans gate sim purity AND the pure-core sweeps; a regex
  // that silently stopped matching would pass every scan vacuously. The commit that added the
  // completeness sweep proved these by a ONE-TIME manual injection (then reverted); these
  // STANDING self-tests keep that proof durable, so a future weakening of the regex fails here.
  it('DOM_GLOBAL_RE matches real DOM-global access and rejects benign lookalikes', () => {
    for (const positive of [
      'document.body.append(x)',
      'window.location.href',
      'navigator.userAgent',
      "localStorage['k']",
      'sessionStorage.setItem(a, b)',
    ]) {
      expect(DOM_GLOBAL_RE.test(positive), positive).toBe(true);
    }
    for (const negative of [
      'const windowless = computeViewport();',
      'shadowDocument(node)',
      'this.documentTitle = t;',
      'const navigatorState = 1;',
    ]) {
      expect(DOM_GLOBAL_RE.test(negative), negative).toBe(false);
    }
  });

  it('NONDETERMINISM_RE matches forbidden sources and rejects deterministic lookalikes', () => {
    for (const positive of ['Math.random()', 'Date.now()', 'performance.now()']) {
      expect(NONDETERMINISM_RE.test(positive), positive).toBe(true);
    }
    for (const negative of [
      'Math.round(x)',
      'Date.parse(s)',
      'performance.measure(a)',
      'rng.next()',
    ]) {
      expect(NONDETERMINISM_RE.test(negative), negative).toBe(false);
    }
  });
});

describe('src/render pure-core invariants', () => {
  it('lists only files that exist (the curated pure cores)', () => {
    const missing = RENDER_PURE_CORES.filter((f) => !statSync(f).isFile());
    expect(missing, `curated src/render pure core missing:\n${missing.join('\n')}`).toEqual([]);
  });

  // COMPLETENESS: every on-disk src/render *_view / *_core must be registered
  // in RENDER_PURE_CORES (the render-resident logic cores: cast_bar is bare-named, so
  // nameplate_view.ts is the one the convention catches). A new render core that is
  // not registered fails here instead of escaping the Three-free / determinism scans.
  it('registers every on-disk src/render *_view / *_core pure core (completeness)', () => {
    const registered = new Set(RENDER_PURE_CORES);
    const unregistered = onDiskCores(join(repoRoot, 'src', 'render')).filter(
      (f) => !registered.has(f),
    );
    expect(
      unregistered.map((f) => relative(repoRoot, f)),
      `every src/render *_view/*_core must be in RENDER_PURE_CORES (register it if pure, or rename it if it is not a pure core):\n${unregistered.join('\n')}`,
    ).toEqual([]);
  });

  it('imports nothing from game/net, three, or a DOM-owning painter (Three-free, unit-testable)', () => {
    const violations = scanImports(RENDER_PURE_CORES, forbiddenRenderCoreImport);
    expect(
      violations,
      `src/render pure cores must stay Three-free:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('touches no DOM/browser globals', () => {
    const violations = scanLines(RENDER_PURE_CORES, DOM_GLOBAL_RE);
    expect(
      violations,
      `src/render pure cores must run headless (no DOM globals):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('draws no randomness or wall-clock time (deterministic: same input -> same output)', () => {
    const violations = scanLines(RENDER_PURE_CORES, NONDETERMINISM_RE);
    expect(
      violations,
      `src/render pure cores must be deterministic (no Math.random/Date.now/performance.now):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  // Teeth check for the render-core matcher (mirrors the ui-core one above): pins
  // every forbidden layer AND the i18n ban so a future regex weakening cannot let a
  // render core import three / game / net / a DOM painter / the i18n runtime and stay
  // green. The i18n ban is what makes a t()/tEntity call in the i18n-free core fail
  // the guard, not just the file header.
  it('forbiddenRenderCoreImport flags every forbidden layer (incl i18n) and allows the permitted ones', () => {
    expect(forbiddenRenderCoreImport('three')).toBe('three');
    expect(forbiddenRenderCoreImport('three/examples/jsm/controls/OrbitControls')).toBe('three');
    expect(forbiddenRenderCoreImport('../game/audio')).toBe('game');
    expect(forbiddenRenderCoreImport('../net/client_world')).toBe('net');
    expect(forbiddenRenderCoreImport('./delve_map_painter')).toBe('painter');
    expect(forbiddenRenderCoreImport('./painter_host')).toBe('painter');
    expect(forbiddenRenderCoreImport('./nameplate_window')).toBe('painter');
    // The i18n-free contract: the i18n runtime (t/formatNumber) AND the tEntity /
    // sim-i18n helpers are off-limits to a render core (unlike a ui core, where
    // entity_i18n is permitted) - the core emits discriminators the painter localizes.
    expect(forbiddenRenderCoreImport('../ui/i18n')).toBe('i18n');
    expect(forbiddenRenderCoreImport('./entity_i18n')).toBe('i18n');
    expect(forbiddenRenderCoreImport('../ui/sim_i18n')).toBe('i18n');
    // Permitted: host-agnostic sim types/data and a non-painter render sibling.
    expect(forbiddenRenderCoreImport('../sim/types')).toBeNull();
    expect(forbiddenRenderCoreImport('../sim/data')).toBeNull();
    expect(forbiddenRenderCoreImport('./delve_map')).toBeNull();
  });
});

describe('curated bare-named pure cores (cross-check)', () => {
  // Bare names are enforced by this curated cross-check while *_view / *_core are
  // auto-swept by onDiskCores(): the sweep's /_(?:view|core)\.ts$/ regex cannot see a
  // bare-named core (xp_bar, swing_timer, cast_bar, ...), so a delete or rename of one
  // would slip the reverse-completeness check. This pins each registered bare core to
  // disk AND to its allowlist, so dropping it from UI_PURE_CORES / RENDER_PURE_CORES,
  // or renaming the file out from under the entry, fails here.
  it('every bare-named core exists on disk and is registered in its allowlist', () => {
    const registered = new Set([...UI_PURE_CORES, ...RENDER_PURE_CORES]);
    const problems: string[] = [];
    for (const f of BARE_NAMED) {
      if (!existsSync(f)) problems.push(`${relative(repoRoot, f)} (missing on disk)`);
      else if (!registered.has(f)) {
        problems.push(
          `${relative(repoRoot, f)} (not registered in UI_PURE_CORES / RENDER_PURE_CORES)`,
        );
      }
    }
    expect(
      problems,
      `every bare-named pure core must exist on disk and stay registered:\n${problems.join('\n')}`,
    ).toEqual([]);

    // Forward-completeness: BARE_NAMED must list EXACTLY the registered cores whose
    // basename is bare (not _view / _core). A new bare-named core added to an allowlist
    // but forgotten here would escape both onDiskCores() (bare name) and the loop above
    // (not listed), reopening the gap; this equality makes that omission fail.
    const viewOrCoreRe = /_(?:view|core)\.ts$/;
    const derivedBare = [...UI_PURE_CORES, ...RENDER_PURE_CORES]
      .filter((f) => !viewOrCoreRe.test(f))
      .map((f) => relative(repoRoot, f))
      .sort();
    expect(
      [...new Set(derivedBare)],
      'BARE_NAMED must equal the registered cores whose name is bare (not _view/_core)',
    ).toEqual([...new Set(BARE_NAMED.map((f) => relative(repoRoot, f)))].sort());
  });
});
