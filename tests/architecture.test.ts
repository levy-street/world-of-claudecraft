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
// It then CLASSIFIES the rest of src/ui (the last section of this file). A module
// that is neither a *_view/*_core pure core nor a *_painter used to be swept by
// nothing at all; now it is either a registered host-agnostic painter helper
// (UI_PAINTER_HELPERS, a hard contract), a registered DOM-owning module
// (UI_DOM_MODULES, exempt), or unregistered and therefore required to reach for
// no browser global at all. See the banner above that section.
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
  'src/ui/proc_overlay_view.ts',
  'src/ui/camera_prompt_core.ts',
  'src/ui/chat_ignore_core.ts',
  'src/ui/daily_rewards_launcher_core.ts',
  'src/ui/char_bags_pairing_core.ts',
  'src/ui/equip_drop_core.ts',
  'src/ui/log_event_route.ts',
  'src/ui/mob_idle_sfx.ts',
  'src/ui/unit_portrait.ts',
  'src/ui/xp_bar.ts',
  'src/ui/absorb_bar.ts',
  'src/ui/party_frames.ts',
  'src/ui/party_below_target_core.ts',
  'src/ui/party_collapse.ts',
  'src/ui/guild_hide_offline.ts',
  'src/ui/rest_indicator.ts',
  'src/ui/low_health.ts',
  'src/ui/low_resource.ts',
  'src/ui/clock.ts',
  'src/ui/compass.ts',
  'src/ui/coords.ts',
  'src/ui/hud/quest/quest_tracker.ts',
  'src/ui/hud/quest/prof_intro_hint_core.ts',
  'src/ui/hud/delve/delve_map.ts',
  'src/ui/raid_lockout_view.ts',
  'src/ui/stat_tooltip_view.ts',
  'src/ui/target_portrait_view.ts',
  'src/ui/target_rank_view.ts',
  'src/ui/meters_breakdown_view.ts',
  'src/ui/mob_tooltip_view.ts',
  'src/ui/player_tooltip_view.ts',
  'src/ui/talents_view.ts',
  'src/ui/social_view.ts',
  'src/ui/tab_strip_view.ts',
  'src/ui/bags_view.ts',
  'src/ui/bag_item_context_menu.ts',
  'src/ui/enchant_apply_view.ts',
  'src/ui/enchanting_view.ts',
  'src/ui/disenchant_yield_view.ts',
  'src/ui/material_hint_view.ts',
  'src/ui/bag_instance_glyph_view.ts',
  'src/ui/item_slot_labels.ts',
  'src/ui/bank_view.ts',
  'src/ui/item_set_tooltip_view.ts',
  'src/ui/weapon_proc_view.ts',
  'src/ui/options_view.ts',
  'src/ui/hud/vendor/vendor_view.ts',
  'src/ui/hud/vendor/heroic_vendor_view.ts',
  'src/ui/hud/vendor/train_view.ts',
  'src/ui/hud/vendor/train_learn_core.ts',
  'src/ui/hud/vendor/unbind_view.ts',
  'src/ui/card_duel_view.ts',
  'src/ui/claudium_launcher_balance_core.ts',
  'src/ui/claudium_view.ts',
  'src/ui/woc_store_view.ts',
  'src/ui/wallet_connection_view.ts',
  'src/ui/hud/loot/loot_roll_status_view.ts',
  'src/ui/hud/loot/loot_settings_view.ts',
  'src/ui/craft_celebration_view.ts',
  'src/ui/grant_line_view.ts',
  'src/ui/crafting_view.ts',
  'src/ui/profession_event_lines_core.ts',
  'src/ui/profession_identity_view.ts',
  'src/ui/profession_tutorial_view.ts',
  'src/ui/professions_view.ts',
  'src/ui/market_view.ts',
  'src/ui/mailbox_view.ts',
  'src/ui/calendar_view.ts',
  'src/ui/char_view.ts',
  'src/ui/char_stats_view.ts',
  'src/ui/inspect_view.ts',
  'src/ui/quality_glow.ts',
  'src/ui/map_pinch_zoom_core.ts',
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
  'src/ui/dev_item_picker_view.ts',
  'src/ui/deeds_leaderboard_view.ts',
  'src/ui/daily_rewards_view.ts',
  'src/ui/deeds_view.ts',
  'src/ui/spellbook_view.ts',
  'src/ui/hud/quest/questlog_view.ts',
  'src/ui/swing_timer.ts',
  'src/ui/unit_frame.ts',
  'src/ui/stance_bar_view.ts',
  'src/ui/hud/action_bar/action_bar_view.ts',
  'src/ui/hud/action_bar/action_bar_layout_core.ts',
  'src/ui/hud/action_bar/action_bar_visibility_core.ts',
  'src/ui/hud/action_bar/mobile_action_page_view.ts',
  'src/ui/hud/action_bar/consumable_bar_view.ts',
  'src/ui/mobile_hud_layout.ts',
  'src/ui/mobile_fullscreen_window_core.ts',
  'src/ui/auras_view.ts',
  'src/ui/minimap_markers.ts',
  'src/ui/gathering_view.ts',
  'src/ui/gather_tool_tooltip.ts',
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
  'src/ui/gpu_notice_view.ts',
  'src/ui/perf_nudge_view.ts',
  'src/ui/hud/loot/corpse_harvest_view.ts',
  'src/ui/town_focus_view.ts',
  'src/ui/pet_action_icons.ts',
  'src/ui/loading_slow_hint_core.ts',
  'src/ui/reconnect_status_core.ts',
  'src/ui/chat_bubble_style.ts',
  'src/game/ui_effects_profile.ts',
  'src/game/ui_tier_knobs.ts',
  'src/ui/trade_view.ts',
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
  'src/render/arena_water_band_core.ts',
  'src/render/camera_boom_core.ts',
  'src/render/camera_director_core.ts',
  'src/render/camera_feel_core.ts',
  'src/render/cast_bar.ts',
  'src/render/draw_stats_core.ts',
  'src/render/fishing_bobber_core.ts',
  'src/render/foliage_core.ts',
  'src/render/stations_core.ts',
  'src/render/delve_interactable_visibility_core.ts',
  'src/render/env_prefilter_core.ts',
  'src/render/ground_tilt_core.ts',
  'src/render/step_smooth_core.ts',
  'src/render/eastbrook_town_visibility_core.ts',
  'src/render/nameplate_view.ts',
  'src/render/net_interp_core.ts',
  'src/render/prewarm_policy.ts',
  'src/render/terrain_region_core.ts',
  'src/render/water_core.ts',
  'src/render/warrior_cast_fx_core.ts',
  'src/render/characters/weapon_attack_style_core.ts',
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
  'src/render/prewarm_policy.ts',
  'src/ui/mob_idle_sfx.ts',
  'src/ui/gather_tool_tooltip.ts',
  'src/ui/unit_portrait.ts',
  'src/ui/xp_bar.ts',
  'src/ui/absorb_bar.ts',
  'src/ui/party_frames.ts',
  'src/ui/party_collapse.ts',
  'src/ui/guild_hide_offline.ts',
  'src/ui/rest_indicator.ts',
  'src/ui/low_health.ts',
  'src/ui/low_resource.ts',
  'src/ui/clock.ts',
  'src/ui/compass.ts',
  'src/ui/coords.ts',
  'src/ui/bag_item_context_menu.ts',
  'src/ui/item_slot_labels.ts',
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
  'src/ui/quality_glow.ts',
  'src/ui/chat_bubble_style.ts',
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
// aggregate interface + shared wire constants) plus every facet interface
// under src/world_api/. W1 split IWorld into those files as a string-free,
// TYPE-ONLY boundary: every host (render/ui/game/net) and the server talk to the
// world ONLY through it, so it sits ABOVE them and must import nothing from
// render/ui/game/net/server (or DOM/Three), pull only TYPES from src/sim (a value
// sim import would drag the deterministic engine into the seam), and run no
// i18n/UI logic (no t()/tSim()/tServer()). Without this scan the facet files'
// purity is convention-only; a later W6-W10 re-home could add a net/ui import or a
// t() call to a facet and no gate would redden. This closes that gap. The one
// blessed value sites are local protocol constants such as COMMAND_NAMES and
// STABLE_TIMER_WIRE_VERSION (world_api.ts); string literals are NOT banned (only
// imports + DOM + i18n calls are). chat.ts's OVERHEAD_EMOTES +
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

describe('server host-layer import invariants', () => {
  it('does not import browser host layers from the authoritative server', () => {
    const serverRoot = join(repoRoot, 'server');
    const violations: string[] = [];
    for (const file of walk(serverRoot)) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const specs: string[] = [];
      for (const match of src.matchAll(IMPORT_RE)) specs.push(match[1]);
      for (const match of src.matchAll(DYN_IMPORT_RE)) specs.push(match[1]);
      for (const spec of specs) {
        if (/(?:^|\/)(?:render|ui|game|net)\//.test(spec)) {
          violations.push(`${relative(repoRoot, file)} imports '${spec}'`);
        }
      }
    }
    expect(
      violations,
      `the authoritative server must not import browser host layers:\n${violations.join('\n')}`,
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

// ---------------------------------------------------------------------------
// src/ui module classification: the THIRD completeness sweep.
//
// The pure-core sweeps above classify BY FILENAME (*_view / *_core), and so does
// the painter sweep in tests/hud_perf_budget.test.ts (*_painter, split into
// HOT_PAINTERS / CANVAS_PAINTERS). A module named neither way used to fall
// between the two and carry no contract at all. text_sprite_cache.ts, the label
// rasterizer map_window_painter blits, is the first of that shape: it CANNOT be a
// pure core (it has to call document.createElement('canvas')) and it is not a
// painter, so its own suite carried a hand-written host-agnosticism scan that the
// next module of the same shape would have had to remember to copy.
//
// This sweep makes the classification total. Every src/ui/**/*.ts lands in
// exactly one of THIS sweep's buckets. That is a statement about which gate
// owns a module here, not a claim that no other gate also covers it: a
// *_window.ts is deliberately covered twice, by this sweep as a module and by
// the painter gate as a painter, and the two answer different questions.
// The buckets:
//
//   pure core       *_view / *_core, or a bare name registered in UI_PURE_CORES
//                   -> the pure-core sweeps above
//   painter         *_painter (and *_window / *_controller, which this sweep ALSO
//                   keeps; see SWEPT_BY_NAME_RE below for why the coverage is
//                   deliberately double rather than exclusive)
//                   -> tests/hud_perf_budget.test.ts
//   painter helper  registered in UI_PAINTER_HELPERS
//                   -> the hard contract below: host-agnostic, deterministic,
//                      colorless, and `document` ONLY to mint its own canvas
//   DOM module      registered in UI_DOM_MODULES
//                   -> exempt, because reaching the host IS the job
//   everything else the default bucket, which needs no list
//                   -> must reach no host at all
//
// That default bucket is what makes the gate non-voluntary. It costs no
// registration, so a NEW module that reads window / localStorage / Date.now /
// getComputedStyle fails HERE until someone classifies it on purpose, whatever it
// is named. Both curated lists are then pinned in both directions: an entry must
// exist on disk and be inside the tree this sweep walks, and an entry that reaches
// no host at all is a stale exemption and fails, so neither list can accrete a
// blanket opt-out.
//
// Said plainly, because the two directions together have a consequence worth
// stating: the union of the two lists equals exactly the set of src/ui modules
// that MATCH THE PATTERNS BELOW, which is the sweep's definition of reaching a
// host, not every conceivable one (the patterns name what they cover and what they
// deliberately do not). They are a reviewed snapshot of that set, and the judgment
// they record is WHICH bucket a module belongs in, not whether it is listed. The
// classified entry is deliberately per FILE rather than per token: a window that
// already owns `document` gains nothing from re-registering the day it also calls
// `addEventListener`, and the hazard here is the UNCLASSIFIED module.
//
// A module named *_painter.ts leaves this sweep for the painter gate, so that gate
// is load-bearing for this one. It used to be the cheapest way out, because
// CANVAS_PAINTERS there was a plain exemption list with no scan behind it. It is now
// a scanned bucket: a parked DOM module has to pass the same exact-count raw-write
// and forced-reflow scans every other painter passes, and additionally an identity
// proof (name a 2D context type AND draw on one) that a real DOM module fails. The
// scans are the durable half; the identity proof is a source-text check and two
// lines of dead canvas code would satisfy it.

const uiRoot = join(repoRoot, 'src', 'ui');

// The filename families the other two sweeps already own. *_view / *_core is
// onDiskCores() above; *_painter is findUiPainters() in hud_perf_budget.test.ts.
//
// That gate also sweeps the OTHER two DOM-adapter names, *_window.ts (the second
// painter name src/ui/CLAUDE.md sanctions) and *_controller.ts (the HUD-domain
// adapter name in src/ui/hud/CLAUDE.md), and this regex deliberately does NOT:
// both are DOUBLE-COVERED, and the two gates cover different things. There they
// hold the painter contract that survives a cold cadence (no forced-reflow layout
// read, no repeating driver of their own); here they are classified as modules,
// which is what pins that a window or controller owning browser state is
// registered rather than assumed. Adding either name here would drop those modules
// out of THIS sweep to buy nothing.
const SWEPT_BY_NAME_RE = /_(?:view|core|painter)\.ts$/;

// The host surface this sweep looks for. It takes several patterns rather than
// one, for two reasons that pull in opposite directions.
//
// TIGHTER than DOM_GLOBAL_RE above on the member form, because src/ui carries
// PLAYER PROSE: an English catalog line ending "...close the map window." matches
// that scan's looser `\s*[.[]` form. Requiring an identifier IMMEDIATELY after the
// dot is what lets this sweep cover the i18n catalogs, the locale overlays and the
// generated bundles rather than exempting whole directories, which would be
// exactly the hole this gate exists to close. Whitespace BEFORE the dot is allowed
// on purpose and is not the same relaxation: biome at lineWidth 100 breaks a long
// member chain onto its own line (`document\n  .querySelectorAll(...)`), so
// refusing it would let the formatter mint an escape with nobody deciding
// anything.
//
// BROADER than DOM_GLOBAL_RE everywhere else, because a member access is not how
// this tree usually reaches a host. Every one of these is a live idiom here and
// every one slips a member-only scan: a `= document` default parameter (ui_icons,
// portrait_chip, proc_overlay_dom), a `typeof window !== 'undefined'` probe, a
// `(globalThis as {...}).ResizeObserver` cast, `instanceof HTMLElement`
// (dialog_key_activation), and a bare `new Date()`.
// (DOM_GLOBAL_RE itself is deliberately left alone: widening it would redden the
// two registered pure cores that probe `typeof localStorage`, which is a separate
// change with a separate blast radius.)
//
// Deliberately OUT of scope, so the absence is a decision rather than an
// oversight: `setTimeout` / `setInterval` / `queueMicrotask` / `fetch` /
// `URLSearchParams` / `structuredClone` all exist in Node, so they break neither
// host-agnosticism nor same-input-same-output; `history` and `self` are excluded
// because this tree has a chat `history` and a leaderboard `self` field; and a
// global handed over as a NAMED object property (`{ doc: document }`) is out of
// reach because the colon form collides with player prose ("Layout: window, ...").
const UI_HOST_GLOBALS = 'document|window|navigator|localStorage|sessionStorage|globalThis';
// Dereferenced: `window.innerWidth`, `globalThis?.localStorage`, `document['x']`,
// and the formatter's broken member chain.
const UI_HOST_MEMBER_RE = new RegExp(`\\b(?:${UI_HOST_GLOBALS})\\??\\s*(?:\\.[A-Za-z_$]|\\[)`);
// Assigned, passed, returned, spread, shorthanded, probed or cast rather than
// dereferenced: `= document)`, `(document)`, `return document;`, `() => window`,
// `{ document }`, `[document, window]`, `{ ...globalThis }`,
// `typeof window !== 'undefined'`, `(window as X).y`. Anchored on a code delimiter
// at BOTH ends so prose ("close the window, then click") cannot match, and the
// open brace refuses a `${...}` interpolation so a template variable named
// `window` (talent_i18n has one) is not mistaken for the global.
const UI_HOST_VALUE_RE = new RegExp(
  `typeof\\s+(?:${UI_HOST_GLOBALS})\\b|(?:[=(,?!\\[]|(?<!\\$)\\{|=>|\\.\\.\\.|\\breturn)\\s*(?:${UI_HOST_GLOBALS})\\s*(?:[),;:!=}\\]]|\\s+as\\b|$)`,
  'm',
);
// window.location reached bare. Pinned to the real Location members so a game
// object named `location` cannot false-positive.
const UI_LOCATION_RE =
  /(?<![.\w$])location\.(?:origin|href|host|hostname|pathname|protocol|search|hash|reload|replace|assign)\b/;
// Browser-only entry points called bare off globalThis, which no member scan sees.
const UI_BROWSER_API_RE =
  /\b(?:getComputedStyle|requestAnimationFrame|requestIdleCallback|matchMedia|ResizeObserver|IntersectionObserver|MutationObserver)\b/;
// Browser-only CONSTRUCTORS and DOM classes, which are reached in value position
// and so are invisible to both scans above. A type annotation (`el: HTMLElement`)
// is erased at build and is NOT a host reach, so only the runtime forms count:
// `instanceof`, `new`, and the bare browser-only singletons.
const UI_DOM_CONSTRUCTOR_RE =
  /\binstanceof\s+(?:HTML[A-Za-z]*Element|SVG[A-Za-z]*Element|Element|Node|Document|DocumentFragment|ShadowRoot|Window)\b|\bnew\s+(?:Image|Audio|DOMParser|FileReader|XMLHttpRequest)\s*\(|(?<![.\w$])(?:customElements|indexedDB|visualViewport|devicePixelRatio)(?![\w$])|(?<![.\w$])screen\.[A-Za-z_$]/;
// The nondeterminism NONDETERMINISM_RE does not name: an argument-less
// `new Date()` reads the host clock exactly like Date.now() (while `new Date(iso)`
// is a deterministic parse and stays allowed), and the crypto RNG is as
// nondeterministic as Math.random.
const UI_WALL_CLOCK_RE = /\bnew\s+Date\s*\(\s*\)|\bcrypto\.(?:randomUUID|getRandomValues)\b/;

// One entry per idiom, so a failure can name WHICH one it tripped. The teeth test
// pins this array to these exact regexes BY IDENTITY: five of the six arms are
// backstopped by the honesty pin below (some registered module depends on each),
// but the browser-only-API arm has no sole dependent, so without the identity pin
// it could be swapped for a dead regex with the whole suite green.
const UI_HOST_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['a browser global, dereferenced', UI_HOST_MEMBER_RE],
  ['a browser global, passed or probed', UI_HOST_VALUE_RE],
  ['window.location', UI_LOCATION_RE],
  ['a browser-only API', UI_BROWSER_API_RE],
  ['a browser-only constructor', UI_DOM_CONSTRUCTOR_RE],
  ['randomness or wall-clock time', NONDETERMINISM_RE],
  ['a wall-clock Date or crypto RNG', UI_WALL_CLOCK_RE],
];

// A registered painter helper's ONE sanctioned DOM call: minting its own detached
// node. Everything else on `document` (querySelector, body, getElementById,
// addEventListener) reaches the LIVE tree, which is what makes a module a DOM
// module rather than a helper. Counted over every bare `document` occurrence, not
// just member accesses, so the `= document` default-parameter form (the shape this
// module would take if someone made it injectable for tests) cannot slip through.
// TWO limits worth naming rather than hiding: the count allows N createElement
// calls where the scan it replaced allowed exactly one (the module's own suite
// keeps that tighter pin), and a Document the CALLER injects is out of reach of
// any source scan, so "detached" is the helper's own test contract while the
// `document` half is what is enforced here.
const HELPER_DOC_ACCESS_RE = /\bdocument\b/g;
const HELPER_DOC_ALLOWED_RE = /\bdocument\.createElement\(/g;
// The rest of the host surface, forbidden to a helper outright: the same idioms as
// above with `document` removed, since the count above owns that one.
const HELPER_HOST_GLOBALS = 'window|navigator|localStorage|sessionStorage|globalThis';
const HELPER_HOST_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    'a browser global, dereferenced',
    new RegExp(`\\b(?:${HELPER_HOST_GLOBALS})\\??\\s*(?:\\.[A-Za-z_$]|\\[)`),
  ],
  [
    'a browser global, passed or probed',
    new RegExp(
      `typeof\\s+(?:${HELPER_HOST_GLOBALS})\\b|(?:[=(,?!\\[]|(?<!\\$)\\{|=>|\\.\\.\\.|\\breturn)\\s*(?:${HELPER_HOST_GLOBALS})\\s*(?:[),;:!=}\\]]|\\s+as\\b|$)`,
      'm',
    ),
  ],
  ['window.location', UI_LOCATION_RE],
  ['a browser-only API', UI_BROWSER_API_RE],
  // Barred from a helper too: `instanceof HTMLElement` is a real browser global,
  // and it throws under the fake document a helper's tests drive it with.
  ['a browser-only constructor', UI_DOM_CONSTRUCTOR_RE],
  ['randomness or wall-clock time', NONDETERMINISM_RE],
  ['a wall-clock Date or crypto RNG', UI_WALL_CLOCK_RE],
];

// Literal colors. A painter helper takes RESOLVED color tokens from its caller
// (the painter reads the --color-* CSS vars once per redraw), so a baked color in
// the helper is a token-discipline break. Deliberately NOT applied to the default
// bucket, where a tier or art palette IS the module (holder_tier, dev_tier,
// percentile_tier, discord_tier, perf_overlay_model all bake theirs on purpose).
const COLOR_HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const COLOR_FUNC_RE = /\brgba?\s*\(/g;

// Host-agnostic painter-side helpers: DOM-touching enough that a pure core cannot
// hold them, host-agnostic enough that a Vitest drives them through a fake
// document. Registering one buys the hard contract below, not an exemption.
//
// WHICH LIST a host-reaching module belongs in is a judgment the gate does not
// make for you, and cannot: several registered DOM modules would pass the helper
// contract today, because the discriminator is the ROLE, not the surface. A helper
// is imported BY a painter and paints nothing itself; a window painter owns and
// updates the nodes of its own window. What the gate enforces is that one of them
// is chosen on purpose.
const UI_PAINTER_HELPERS = ['src/ui/text_sprite_cache.ts'].map((rel) => join(repoRoot, rel));

// Modules that REACH A HOST: they own browser state (the windows, the HUD
// controllers, the drag / resize / focus plumbing, the storage-backed settings) or
// they read the wall clock or draw randomness (loading_tips is nothing but a tip
// rotation and a Math.random). Not a family and not a judgment: this is exactly
// the set that trips the patterns above, so a window that only ever touches
// elements handed to it is correctly absent, and several are. Exempt from the scan
// by conscious registration. Adding a line here is the deliberate act; the honesty
// pin below deletes the option of adding one pre-emptively, since an entry that
// reaches no host at all fails.
//
// A third option this list does NOT cover, and the failure message says so: if the
// reach is a clock or an RNG in a module that is otherwise pure, inject it instead
// and stay out of both lists.
//
// The rot mode to know: a future catalog value carrying a string like
// 'window.open' would trip the member matcher inside a data file. Most of the
// residual modules are i18n catalogs, overlays and generated bundles (the
// anti-vacuity pin below keeps them in scope) and NONE trips it today; they stay
// in the sweep on purpose, since a directory exclusion is a hole of exactly the
// shape this gate exists to close. The remedy is to reword the string, never to
// register a generated bundle here. If the trip is in a LOCALE OVERLAY rather than
// the English catalog, it is a maintainer fix during the release locale fill:
// contributors do not edit those files.
const UI_DOM_MODULES = [
  'src/ui/arena_window.ts',
  'src/ui/armory_inspect.ts',
  'src/ui/bag_item_action_menu.ts',
  'src/ui/bags_window.ts',
  'src/ui/bank_window.ts',
  'src/ui/calendar_window.ts',
  'src/ui/camera_prompt.ts',
  'src/ui/char_skin_window.ts',
  'src/ui/char_window.ts',
  'src/ui/charselect_news.ts',
  'src/ui/chat_command_menu.ts',
  'src/ui/claudium_window.ts',
  'src/ui/crafting_window.ts',
  'src/ui/daily_rewards_window.ts',
  'src/ui/deeds_window.ts',
  'src/ui/desktop_update_toast.ts',
  'src/ui/dev_command_window.ts',
  'src/ui/dialog_key_activation.ts',
  'src/ui/discord_widget.ts',
  'src/ui/entry_guard_banner.ts',
  'src/ui/focus_manager.ts',
  'src/ui/focus_restore.ts',
  'src/ui/form_draft.ts',
  'src/ui/gather_node_tooltip.ts',
  'src/ui/gpu_notice_toast.ts',
  'src/ui/hud.ts',
  'src/ui/hud/chat/chat_geometry_controller.ts',
  'src/ui/hud/chat/chat_window_controller.ts',
  'src/ui/hud/cosmetics/skin_event_controller.ts',
  'src/ui/hud/delve/lockpick_controller.ts',
  'src/ui/hud/delve/lockpick_window.ts',
  'src/ui/hud/delve/rite_controller.ts',
  'src/ui/hud/delve/rite_window.ts',
  'src/ui/hud/fiesta/fiesta_controller.ts',
  'src/ui/hud/loot/corpse_harvest_window.ts',
  'src/ui/hud/loot/loot_roll_controller.ts',
  'src/ui/hud/loot/loot_window_controller.ts',
  'src/ui/hud/player_card/player_card.ts',
  'src/ui/hud/player_card/player_card_controller.ts',
  'src/ui/hud/quest/quest_dialog_controller.ts',
  'src/ui/hud/quest/quest_tracker_controller.ts',
  'src/ui/hud/quest/questlog_window.ts',
  'src/ui/hud/vendor/heroic_vendor_window.ts',
  'src/ui/hud/vendor/train_window.ts',
  'src/ui/hud/vendor/unbind_window.ts',
  'src/ui/hud/vendor/vendor_window.ts',
  'src/ui/i18n.ts',
  'src/ui/icon_prewarm.ts',
  'src/ui/icons.ts',
  'src/ui/inspect_window.ts',
  'src/ui/item_drop_hit_test.ts',
  'src/ui/loading_slow_hint.ts',
  'src/ui/loading_tips.ts',
  'src/ui/mailbox_window.ts',
  'src/ui/market_window.ts',
  'src/ui/meters.ts',
  'src/ui/minimap_gilded_ornament.ts',
  'src/ui/mobile_wallet_launcher.ts',
  'src/ui/movable_frame.ts',
  'src/ui/native_update_prompt.ts',
  'src/ui/options_window.ts',
  'src/ui/perf_metrics_sampler.ts',
  'src/ui/perf_nudge_toast.ts',
  'src/ui/perf_ornament_svg.ts',
  'src/ui/perf_overlay.ts',
  'src/ui/perf_overlay_config.ts',
  'src/ui/perf_overlay_settings.ts',
  'src/ui/portrait_chip.ts',
  'src/ui/proc_overlay_dom.ts',
  'src/ui/proc_overlay_drag.ts',
  'src/ui/profession_identity_card.ts',
  'src/ui/profession_tutorial_window.ts',
  'src/ui/professions_window.ts',
  'src/ui/reconnect_overlay.ts',
  'src/ui/settings_controls.ts',
  'src/ui/social_window.ts',
  'src/ui/spectate_badge.ts',
  'src/ui/spellbook_window.ts',
  'src/ui/steam_link.ts',
  'src/ui/store_stack_diag.ts',
  'src/ui/talents_window.ts',
  'src/ui/theme.ts',
  'src/ui/touch_item_drag.ts',
  'src/ui/touch_tap.ts',
  'src/ui/town_focus_window.ts',
  'src/ui/tutorial.ts',
  'src/ui/ui_effects_applier.ts',
  'src/ui/ui_icons.ts',
  'src/ui/ui_scale.ts',
  'src/ui/vale_cup_betting.ts',
  'src/ui/vale_cup_briefing.ts',
  'src/ui/vale_cup_charge.ts',
  'src/ui/vale_cup_hud.ts',
  'src/ui/window_drag.ts',
  'src/ui/window_resize.ts',
].map((rel) => join(repoRoot, rel));

// The sweep's domain: every src/ui module the other two sweeps do NOT already
// own, which is the gap the classification has to fill.
function uiResidualModules(): string[] {
  const cores = new Set(UI_PURE_CORES);
  return walk(uiRoot).filter((f) => !SWEPT_BY_NAME_RE.test(f) && !cores.has(f));
}

// True when the file reaches for the browser at all: a DOM global in any of its
// live forms, a browser-only API, or wall-clock/random nondeterminism.
function touchesBrowser(file: string): boolean {
  const code = stripComments(readFileSync(file, 'utf8'));
  return UI_HOST_PATTERNS.some(([, re]) => re.test(code));
}

describe('src/ui module classification (every module is swept by exactly one gate)', () => {
  const residual = uiResidualModules();
  const helpers = new Set(UI_PAINTER_HELPERS);
  const domModules = new Set(UI_DOM_MODULES);

  // Anti-vacuity: a walk() over the wrong root, or a residual filter that
  // accidentally matched everything, would make every scan below pass over an
  // empty set. Pin that the sweep really reaches the tree AND the one module this
  // gate was written for.
  it('sweeps a real, non-empty slice of src/ui (anti-vacuity)', () => {
    expect(walk(uiRoot).length).toBeGreaterThan(200);
    expect(residual.length).toBeGreaterThan(100);
    expect(residual).toContain(join(repoRoot, 'src/ui/text_sprite_cache.ts'));
    // The i18n data trees are IN the sweep, not exempted by directory. Without
    // this the documented remedy for a future catalog false positive ("reword the
    // string, never exempt the tree") could be quietly reversed and every other
    // pin here would stay green.
    expect(residual).toContain(join(repoRoot, 'src/ui/i18n.resolved.generated/en.ts'));
    expect(residual.filter((f) => f.includes('i18n')).length).toBeGreaterThan(50);
    // A *_window.ts painter stays in THIS sweep's domain on purpose, and is swept by
    // the painter gate as well (PAINTER_FILE_RE in hud_perf_budget.test.ts matches
    // all three DOM-adapter names). The double coverage is the design: that gate owns
    // the layout-read and repeating-driver contract, this one owns the DOM-module
    // classification. Adding _window or _controller to SWEPT_BY_NAME_RE would drop
    // those modules out of this sweep and buy nothing, since the other gate has them.
    expect(SWEPT_BY_NAME_RE.test('src/ui/hud/vendor/vendor_window.ts')).toBe(false);
    expect(residual).toContain(join(repoRoot, 'src/ui/hud/vendor/vendor_window.ts'));
  });

  it('registers each classified module once, on disk, outside the core and painter families', () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    const swept = new Set(residual);
    const registeredCores = new Set(UI_PURE_CORES);
    for (const [name, files] of [
      ['UI_PAINTER_HELPERS', UI_PAINTER_HELPERS],
      ['UI_DOM_MODULES', UI_DOM_MODULES],
    ] as const) {
      for (const f of files) {
        const shown = relative(repoRoot, f);
        if (!existsSync(f)) problems.push(`${shown} (${name}: missing on disk)`);
        if (seen.has(f)) problems.push(`${shown} (${name}: listed twice)`);
        seen.add(f);
        if (SWEPT_BY_NAME_RE.test(f)) {
          problems.push(`${shown} (${name}: a *_view/*_core/*_painter is swept by its own gate)`);
        }
        if (registeredCores.has(f)) {
          problems.push(`${shown} (${name}: already registered in UI_PURE_CORES)`);
        }
        // A classified entry that this sweep never actually reaches would be a
        // classification of nothing: the file must be IN the residual set, not
        // merely named in the list.
        if (
          existsSync(f) &&
          !SWEPT_BY_NAME_RE.test(f) &&
          !registeredCores.has(f) &&
          !swept.has(f)
        ) {
          problems.push(`${shown} (${name}: outside the src/ui tree this sweep walks)`);
        }
      }
    }
    expect(
      problems,
      `each classified src/ui module must exist and belong to exactly one bucket:\n${problems.join('\n')}`,
    ).toEqual([]);
  });

  // COMPLETENESS, the point of the gate: a module that reaches for the browser and
  // is in NEITHER list fails, so a new DOM-touching helper cannot land unclassified
  // the way text_sprite_cache.ts could before this.
  it('classifies every browser-touching src/ui module (completeness)', () => {
    const unclassified = residual
      .filter((f) => !helpers.has(f) && !domModules.has(f))
      .filter(touchesBrowser)
      .map((f) => relative(repoRoot, f));
    expect(
      unclassified,
      `unclassified src/ui module(s) reaching a host. Pick one on purpose: register a host-agnostic painter-side helper in UI_PAINTER_HELPERS (it may then only mint its own canvas, and must stay deterministic and colorless), register a module that owns browser state in UI_DOM_MODULES, or, if the only reach is a clock or an RNG in an otherwise pure module, inject it from the caller and stay out of both lists:\n${unclassified.join('\n')}`,
    ).toEqual([]);
  });

  // The other direction: an exemption nobody needs. Without this, the cheapest way
  // past the gate would be to add your new module to UI_DOM_MODULES and never touch
  // a global at all, and the list would rot into a blanket opt-out. Scoped to
  // UI_DOM_MODULES ALONE, because only that list is an exemption: a
  // UI_PAINTER_HELPERS entry is a CLAIM of the hard contract, and a helper that
  // reaches for nothing at all (one that mints an OffscreenCanvas, say) should stay
  // registrable rather than be pushed back out of the contract it satisfies.
  it('keeps the exemption list honest: no entry for a module that touches no browser global', () => {
    const stale = UI_DOM_MODULES.filter((f) => existsSync(f) && !touchesBrowser(f)).map((f) =>
      relative(repoRoot, f),
    );
    expect(
      stale,
      `stale classification: these modules reach for no browser global, so they need no entry (drop them; the default bucket already scans them):\n${stale.join('\n')}`,
    ).toEqual([]);
  });

  it('painter helpers reach for no browser host beyond the canvas they rasterize into', () => {
    const violations: string[] = [];
    for (const file of UI_PAINTER_HELPERS) {
      const shown = relative(repoRoot, file);
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const [what, re] of HELPER_HOST_PATTERNS) {
        // Verdict on the WHOLE file, the same way the default bucket is judged, so
        // a form split across two lines cannot pass here while failing there. The
        // per-line pass only picks the line to name in the message.
        if (!re.test(code)) continue;
        const where = code.split('\n').find((line) => re.test(line)) ?? '';
        violations.push(`${shown}: ${what}: ${where.trim()}`);
      }
      const docAccess = code.match(HELPER_DOC_ACCESS_RE) ?? [];
      const minted = code.match(HELPER_DOC_ALLOWED_RE) ?? [];
      if (docAccess.length !== minted.length) {
        violations.push(
          `${shown}: ${docAccess.length} document reference(s) but only ${minted.length} document.createElement( call(s): a helper mints its own detached node and never reaches the live tree`,
        );
      }
    }
    expect(
      violations,
      `src/ui painter helpers must stay host-agnostic and deterministic:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('painter helpers import nothing from render/game/net, three, or a DOM-owning painter', () => {
    const violations = scanImports(UI_PAINTER_HELPERS, forbiddenUiCoreImport);
    expect(
      violations,
      `src/ui painter helpers follow the pure-core import rule:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('painter helpers carry no literal color (the caller passes resolved tokens)', () => {
    const violations: string[] = [];
    for (const file of UI_PAINTER_HELPERS) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const shown = relative(repoRoot, file);
      for (const hit of code.match(COLOR_HEX_RE) ?? []) violations.push(`${shown}: ${hit}`);
      for (const hit of code.match(COLOR_FUNC_RE) ?? []) violations.push(`${shown}: ${hit}`);
    }
    expect(
      violations,
      `a painter helper takes RESOLVED color tokens from its painter, never a baked literal:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  // Teeth for the matchers this sweep adds (the standing self-test pattern the
  // shared DOM/determinism regexes already follow above): a weakened regex would
  // pass every scan vacuously, and the prose negative is the specific reason this
  // sweep does not reuse DOM_GLOBAL_RE.
  it('the src/ui host-global matchers keep their teeth', () => {
    // Dereferenced, including optional chaining and index access.
    for (const positive of [
      'document.createElement(x)',
      'window.innerWidth',
      'navigator.userAgent',
      "localStorage['k']",
      'sessionStorage.setItem(a, b)',
      'globalThis.setTimeout(fn, 0)',
      'window?.location.href',
      // The formatter's own member-chain break, which biome emits at lineWidth
      // 100 and which a dot-must-follow-immediately matcher lets straight past.
      'const nodes = document\n  .querySelectorAll(sel);',
    ]) {
      expect(UI_HOST_MEMBER_RE.test(positive), positive).toBe(true);
    }
    for (const negative of [
      // Player prose, the reason this matcher is tighter than DOM_GLOBAL_RE.
      "'Press M to close the map window. Then click the marker.',",
      "'This document. Signed.',",
      'const windowless = computeViewport();',
      'this.documentTitle = t;',
    ]) {
      expect(UI_HOST_MEMBER_RE.test(negative), negative).toBe(false);
    }
    // Passed, probed or cast: the live idioms a member-only scan misses.
    for (const positive of [
      'export function hydrateIcons(root: ParentNode = document): void {',
      'onPortraitsReady(() => hydratePortraits(document));',
      "typeof localStorage !== 'undefined' ? localStorage : null",
      '(window as unknown as { fbq?: () => void }).fbq;',
      'const Observer = (globalThis as { ResizeObserver?: X }).ResizeObserver;',
      // Handing the host to a caller: the natural next shape after the default
      // parameter, and none of it is a member access.
      'return document;',
      'const host = () => window',
      'const deps = { document };',
      'const hosts = [document, window];',
      'const merged = { ...globalThis };',
    ]) {
      expect(UI_HOST_VALUE_RE.test(positive), positive).toBe(true);
    }
    for (const negative of [
      "'Close the window, then click the marker.',",
      "'Open the document; read it.',",
      'const shadowWindow = 1;',
      // A template variable named window (talent_i18n has one) is not the global,
      // which is why the open-brace arm refuses a ${...} interpolation.
      `const label = \`(\${window})\`;`,
    ]) {
      expect(UI_HOST_VALUE_RE.test(negative), negative).toBe(false);
    }
    // window.location reached bare, but never a game object called location.
    expect(UI_LOCATION_RE.test('origin: location.origin')).toBe(true);
    expect(UI_LOCATION_RE.test('location.reload();')).toBe(true);
    expect(UI_LOCATION_RE.test('const p = node.location.origin;')).toBe(false);
    expect(UI_LOCATION_RE.test('marker.location.x = 3;')).toBe(false);
    for (const positive of [
      'getComputedStyle(el)',
      'requestAnimationFrame(step)',
      'requestIdleCallback(slice)',
      'matchMedia in window',
      'new ResizeObserver(cb)',
      'new IntersectionObserver(cb)',
      'new MutationObserver(cb)',
    ]) {
      expect(UI_BROWSER_API_RE.test(positive), positive).toBe(true);
    }
    for (const negative of ['getComputedLayout(el)', 'requestAnimation(step)', 'idleCallback()']) {
      expect(UI_BROWSER_API_RE.test(negative), negative).toBe(false);
    }
    // Browser-only constructors, reached in value position. A TYPE annotation is
    // erased at build and is deliberately not a host reach.
    expect(UI_DOM_CONSTRUCTOR_RE.test('if (!(active instanceof HTMLElement)) return;')).toBe(true);
    expect(UI_DOM_CONSTRUCTOR_RE.test('node instanceof SVGPathElement')).toBe(true);
    expect(UI_DOM_CONSTRUCTOR_RE.test('const img = new Image();')).toBe(true);
    expect(UI_DOM_CONSTRUCTOR_RE.test('customElements.define(a, b)')).toBe(true);
    expect(UI_DOM_CONSTRUCTOR_RE.test('const w = screen.width;')).toBe(true);
    expect(UI_DOM_CONSTRUCTOR_RE.test('function f(el: HTMLElement): void {}')).toBe(false);
    expect(UI_DOM_CONSTRUCTOR_RE.test('const el: SVGElement | null = null;')).toBe(false);
    expect(UI_DOM_CONSTRUCTOR_RE.test('this.screen.width = 3;')).toBe(false);
    // An argument-less new Date() is the wall clock; a parse is not.
    expect(UI_WALL_CLOCK_RE.test('const now = new Date();')).toBe(true);
    expect(UI_WALL_CLOCK_RE.test('new Date().toISOString()')).toBe(true);
    expect(UI_WALL_CLOCK_RE.test('crypto.randomUUID()')).toBe(true);
    expect(UI_WALL_CLOCK_RE.test('new Date(row.createdAt)')).toBe(false);
    // Every idiom above is wired into the sweep BY IDENTITY, not by label. A label
    // pin alone would let an arm be swapped for a dead regex: five arms are
    // backstopped by the honesty pin (some registered module depends on each), but
    // the browser-only-API arm has no sole dependent and this is its only guard.
    expect(UI_HOST_PATTERNS).toEqual([
      ['a browser global, dereferenced', UI_HOST_MEMBER_RE],
      ['a browser global, passed or probed', UI_HOST_VALUE_RE],
      ['window.location', UI_LOCATION_RE],
      ['a browser-only API', UI_BROWSER_API_RE],
      ['a browser-only constructor', UI_DOM_CONSTRUCTOR_RE],
      ['randomness or wall-clock time', NONDETERMINISM_RE],
      ['a wall-clock Date or crypto RNG', UI_WALL_CLOCK_RE],
    ]);
    // The helper arms are the same list with `document` dropped from the two
    // global arms (the count below owns that one), pinned to literals rather than
    // to UI_HOST_PATTERNS.length, which would move with it and prove nothing.
    expect(HELPER_HOST_PATTERNS.map(([what]) => what)).toEqual([
      'a browser global, dereferenced',
      'a browser global, passed or probed',
      'window.location',
      'a browser-only API',
      'a browser-only constructor',
      'randomness or wall-clock time',
      'a wall-clock Date or crypto RNG',
    ]);
    expect(HELPER_HOST_PATTERNS[0][1].test('document.createElement(x)')).toBe(false);
    expect(HELPER_HOST_PATTERNS[0][1].test('window.innerWidth')).toBe(true);
    expect(HELPER_HOST_PATTERNS[1][1].test("typeof localStorage !== 'undefined'")).toBe(true);
    expect(HELPER_HOST_PATTERNS[1][1].test('return document;')).toBe(false);
    // The helper document rule counts every access, so a second, live-tree call
    // cannot hide behind the sanctioned one.
    const both = "document.createElement('canvas'); document.body.append(c);";
    expect((both.match(HELPER_DOC_ACCESS_RE) ?? []).length).toBe(2);
    expect((both.match(HELPER_DOC_ALLOWED_RE) ?? []).length).toBe(1);
    // And the color matchers see both literal forms.
    expect('#ff0'.match(COLOR_HEX_RE)).toEqual(['#ff0']);
    expect('#ffcc00aa'.match(COLOR_HEX_RE)).toEqual(['#ffcc00aa']);
    expect('rgba(0, 0, 0, .5)'.match(COLOR_FUNC_RE)).toEqual(['rgba(']);
    expect('rgb(1 2 3)'.match(COLOR_FUNC_RE)).toEqual(['rgb(']);
    expect('const hex = colorToken;'.match(COLOR_HEX_RE)).toBeNull();
  });
});
