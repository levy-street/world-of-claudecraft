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
// false positive. A shared twin lives at tests/helpers/strip_comments.ts; this
// copy stays local ON PURPOSE (a load-bearing guard stays self-contained) and
// the two may drift independently. String literals are left intact: the dotted patterns matched
// below (Math.random, window., ...) do not appear inside the sim's player text, and neither does
// the $WOC firewall's vocabulary, whose two words the game DOES use of its own accord (treasury,
// signature) are matched only in their money-affixed compound forms for exactly that reason.
// One alternation, so leftmost-first matching decides precedence: a line comment
// whose text contains /* is consumed AS a line comment instead of opening a
// bogus block that swallows everything to the next */ elsewhere in the file
// (that ordering bug exempted most of data.ts, its 53 imports included, from
// every scan below). The (^|[^:]) guard keeps protocol strings (http://) intact.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/gm, (m, pre) =>
    m.startsWith('/*') ? m.replace(/[^\n]/g, ' ') : (pre ?? ''),
  );
}

// A specifier a host-agnostic sim file must never import. Returns the offending
// layer/package, or null when the import is allowed. `server/` is banned like the
// browser host layers (even type-only): server modules drag Node-only deps (pg,
// node:*) that would break the sim in the browser, and shared server contracts are
// REDECLARED in the sim with a test-side lockstep pin instead (the GuildRank
// precedent: src/sim/guild_bank.ts GUILD_RANKS pinned by tests/guild_bank.test.ts).
function forbiddenImport(spec: string): string | null {
  if (spec === 'three' || spec.startsWith('three/')) return 'three';
  // The trailing slash is not required: `../server` and `../../server.js` are
  // the same ban, and the slash-only form let both through. A layer name must
  // therefore END the specifier, take a `/` (a file inside it), or take a `.js`
  // extension. The leading `(?:^|\/)` still anchors the name to a path segment,
  // so `my_server_helper` and `src/uiverse/x` are not matches.
  const layer = spec.match(
    /(?:^|\/)(render|ui|game|net|server)(?:\/|\.js)?$|(?:^|\/)(render|ui|game|net|server)\//,
  );
  return layer ? (layer[1] ?? layer[2]) : null;
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

// Value-position sibling of DOM_GLOBAL_RE above. The member-access form requires an
// identifier immediately after a `.`/`[`, so it cannot see a browser global reached
// any other way: a feature-detect (`typeof localStorage !== 'undefined' ?
// localStorage : null`, the shape guild_hide_offline.ts and party_collapse.ts each
// used to duplicate before being unified into src/ui/safe_local_storage.ts), a type
// check against the same global (`instanceof Document` / `instanceof Window` /
// `instanceof Storage`), or the global handed over bare in assignment/return/argument
// position. Scoped narrower than the src/ui module-classification sweep's
// UI_HOST_VALUE_RE below (no prose-safety burden here: a pure core carries no
// player-facing English the way an i18n catalog does).
const DOM_GLOBAL_VALUE_RE =
  /\btypeof\s+(?:document|window|navigator|localStorage|sessionStorage)\b|\binstanceof\s+(?:Document|Window|Navigator|Storage)\b|(?:[=(]|\breturn\b)\s*(?:document|window|navigator|localStorage|sessionStorage)\s*[),;]/;
const NONDETERMINISM_RE = /\b(Math\.random|Date\.now|performance\.now)\b/;

const simFiles = walk(simRoot);

describe('live graphics profile architecture', () => {
  it('resolves renderer-bound layout and deferred preload choices from live GFX', () => {
    const renderSource = (relativePath: string): string =>
      readFileSync(join(repoRoot, 'src', 'render', relativePath), 'utf8');
    const props = renderSource('props.ts');
    const foliage = renderSource('foliage.ts');

    expect(props).not.toMatch(/\bconst\s+MERGE_BAND_DEPTH\s*=\s*GFX\b/);
    expect(props).toContain('const mergeBandDepth = ():');
    expect(props).toContain('deferredPropKeys ??= preloadPropKeys(GFX.standardMaterials)');
    expect(foliage).not.toMatch(/\bconst\s+MODEL_URLS\s*=\s*GFX\b/);
    expect(foliage).toContain('const foliageModelUrls = ():');
    expect(foliage).toContain('foliageModelUrlsFor(GFX)');

    const directDeferredProfiles = [
      ['terrain.ts', 'prepareTerrainProfileAssets'],
      ['water.ts', 'prepareWaterProfileAssets'],
      ['detail_normals.ts', 'prepareStoneDetailProfileAssets'],
      ['worn_stone.ts', 'prepareSurfaceDetailProfileAssets'],
      ['canopy_detail.ts', 'prepareCanopyDetailProfileAssets'],
      ['great_tree_prewarm.ts', 'prepareGreatTreeProfileAssets'],
    ] as const;
    for (const [relativePath, prepare] of directDeferredProfiles) {
      expect(renderSource(relativePath)).toContain(
        `registerDeferredPreload(() => ${prepare}(GFX))`,
      );
    }
  });

  it('registers every exported profile cache reset in the central invalidator', () => {
    const renderFiles = walk(join(repoRoot, 'src', 'render'));
    const resetNames = new Set<string>();
    for (const file of renderFiles) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(/\bexport function (reset\w+ProfileCaches?)\s*\(/g)) {
        resetNames.add(match[1]);
      }
    }

    const coordinator = stripComments(
      readFileSync(join(repoRoot, 'src', 'render', 'assets', 'graphics_profile.ts'), 'utf8'),
    );
    const resetTable = coordinator.slice(coordinator.indexOf('const RESETTERS'));
    expect(resetNames.size).toBeGreaterThan(20);
    for (const resetName of resetNames) expect(resetTable).toContain(resetName);
  });
});

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
  'src/ui/map_entity_disclosure_core.ts',
  'src/ui/map_navigation_landmarks_core.ts',
  'src/ui/map_marker_profile_core.ts',
  'src/ui/map_marker_semantics_core.ts',
  'src/ui/map_semantic_accessibility_core.ts',
  'src/ui/paladin_devotion_view.ts',
  'src/ui/aura_icon_view.ts',
  'src/ui/aura_overlay_view.ts',
  'src/ui/banner_queue.ts',
  'src/ui/item_kind_label.ts',
  'src/ui/proc_overlay_view.ts',
  'src/ui/chat_ignore_core.ts',
  'src/ui/daily_rewards_chrome_view.ts',
  'src/ui/daily_rewards_launcher_core.ts',
  'src/ui/char_bags_pairing_core.ts',
  'src/ui/empower_hold_core.ts',
  'src/ui/equip_drop_core.ts',
  'src/ui/error_text_i18n_core.ts',
  'src/ui/general_chat_quota_view.ts',
  'src/ui/known_item.ts',
  'src/ui/log_event_route.ts',
  'src/ui/mob_idle_sfx.ts',
  'src/ui/unit_portrait.ts',
  'src/ui/xp_bar.ts',
  'src/ui/absorb_bar.ts',
  'src/ui/party_frames.ts',
  'src/ui/party_below_target_core.ts',
  'src/ui/party_collapse.ts',
  'src/ui/guild_hide_offline.ts',
  'src/ui/guild_motd_login.ts',
  'src/ui/rest_indicator.ts',
  'src/ui/low_health.ts',
  'src/ui/low_resource.ts',
  'src/ui/clock.ts',
  'src/ui/compass.ts',
  'src/ui/coords.ts',
  'src/ui/hud/quest/quest_tracker.ts',
  'src/ui/hud/quest/quest_strip_core.ts',
  'src/ui/hud/action_bar/item_bags_line_core.ts',
  'src/ui/hud/quest/prof_intro_hint_core.ts',
  'src/ui/hud/pet_bar_core.ts',
  'src/ui/hud/warlock/doom_meter_view.ts',
  'src/ui/hud/quest/master_craft_core.ts',
  'src/ui/quest_marker_tags.ts',
  'src/ui/hud/delve/delve_map.ts',
  'src/ui/hud/rift/rift_map_core.ts',
  'src/ui/hud/battleground/battleground_map_view.ts',
  'src/ui/hud/battleground/battleground_kill_feed_view.ts',
  'src/ui/hud/battleground/battleground_proposal_view.ts',
  'src/ui/raid_boss_guide_view.ts',
  'src/ui/raid_lockout_view.ts',
  'src/ui/playtime_view.ts',
  'src/ui/stat_tooltip_view.ts',
  'src/ui/target_portrait_view.ts',
  'src/ui/target_rank_view.ts',
  'src/ui/meters_breakdown_view.ts',
  'src/ui/interface_unlock_core.ts',
  'src/ui/interface_unlock_menu_core.ts',
  'src/ui/settings_transfer_core.ts',
  'src/ui/meters_frame_core.ts',
  'src/ui/meters_menu_view.ts',
  'src/ui/meters_rows_view.ts',
  'src/ui/threat_subject_core.ts',
  'src/ui/mob_tooltip_view.ts',
  'src/ui/player_tooltip_view.ts',
  'src/ui/preview_prewarm_core.ts',
  'src/ui/talents_view.ts',
  'src/ui/social_view.ts',
  'src/ui/tab_strip_view.ts',
  'src/ui/bag_filter.ts',
  'src/ui/bank_filter.ts',
  'src/ui/bags_view.ts',
  'src/ui/bag_item_context_menu.ts',
  'src/ui/enchant_apply_view.ts',
  'src/ui/enchanting_view.ts',
  'src/ui/disenchant_yield_view.ts',
  'src/ui/material_hint_view.ts',
  'src/ui/material_profession_hint_view.ts',
  'src/ui/elixir_tooltip_view.ts',
  'src/ui/stack_size_tooltip_view.ts',
  'src/ui/craft_name_view.ts',
  'src/ui/cooking_catch_hint_view.ts',
  'src/ui/bag_instance_glyph_view.ts',
  'src/ui/item_instance_glyph_mark.ts',
  'src/ui/bag_corner_mark_view.ts',
  'src/ui/bag_fine_mark_view.ts',
  'src/ui/bag_quest_mark_view.ts',
  'src/ui/bag_quest_tracker_highlight_view.ts',
  'src/ui/quest_item_tooltip_view.ts',
  'src/ui/item_name_color.ts',
  'src/ui/item_slot_labels.ts',
  'src/ui/bank_view.ts',
  // The bank's bonus-slot breakdown footer: the KNOWN account-source table and the
  // markup it projects a BankBonusModel into (Bank Storage phase 17, the extraction
  // this window's ratchet row named).
  'src/ui/bank_bonus_view.ts',
  'src/ui/bank_socket_purchase_core.ts',
  'src/ui/storage_rung_echo_core.ts',
  'src/ui/vault_view.ts',
  'src/ui/guild_bank_log_view.ts',
  'src/ui/guild_bank_view.ts',
  'src/ui/item_set_tooltip_view.ts',
  'src/ui/weapon_proc_view.ts',
  'src/ui/options_view.ts',
  'src/ui/hud/vendor/vendor_view.ts',
  'src/ui/hud/vendor/heroic_vendor_view.ts',
  'src/ui/hud/vendor/crucible_vendor_view.ts',
  'src/ui/hud/vendor/warfare_vendor_view.ts',
  'src/ui/hud/vendor/train_view.ts',
  'src/ui/hud/vendor/train_learn_core.ts',
  'src/ui/hud/vendor/unbind_view.ts',
  'src/ui/card_duel_view.ts',
  'src/ui/claudium_launcher_balance_core.ts',
  'src/ui/claudium_view.ts',
  'src/ui/charter_card_view.ts',
  // The Season 1 Armory's section / card / class-chip markup, the charter_card_view
  // twin on the other half of the same store body (Bank Storage phase 15).
  'src/ui/armory_card_view.ts',
  // The daily-rewards spin wheel's markup and its landing geometry (Bank Storage
  // phase 17). The overlay ELEMENT lives in the thin painter beside it.
  'src/ui/daily_rewards_spin_view.ts',
  // The rewards tab's leaderboard and payout-history panels, pure functions of the
  // wire records (Bank Storage phase 17's review round, which spent the room the
  // spin extraction bought and paid for it here rather than raising a ceiling).
  'src/ui/daily_rewards_ranks_view.ts',
  // The rewards tab's wallet LOCK card, a pure three-way branch on the lock reason
  // (Bank Storage phase 17's review round, paying for a comment correction the way
  // the phase paid for everything else).
  'src/ui/daily_rewards_wallet_card_view.ts',
  'src/ui/woc_store_view.ts',
  // The banker rung purchase's copy mappers and its second price tag's markup
  // (Bank Storage phase 13), the charter_card_view twin one surface over.
  'src/ui/bank_rung_view.ts',
  // The capacity meter's copy: its accessible name and its tooltip body
  // (Bank Storage phase 18, the same extraction shape one surface over).
  'src/ui/bank_meter_view.ts',
  // The banker rung purchase's money STATE MACHINE (Bank Storage phase 17,
  // ruling 30): the sent latch, the in-flight SKU, the result band, the confirm
  // latch and the re-prompt cap, plus the spend and its refusal handling. Every
  // host effect is an injected closure, so it is DOM-free by construction. It is
  // registered by name here rather than only swept: the determinism scan is what
  // this file is for on this path, because a clock or an rng draw inside a
  // purchase state machine is what mints a second key.
  'src/ui/bank_rung_purchase_core.ts',
  // The bank pane's short-phone chrome contract (Bank Storage phase 18): which
  // bands must never scroll out of view, the compact-regime breakpoint the
  // stylesheet also states, and where the pane's scroll offset lives. Pure
  // numbers and selector strings; the sheet is held to it by
  // tests/bank_chrome_layout.test.ts.
  'src/ui/bank_chrome_layout_core.ts',
  // The Claudium spend seam both spending windows consume. Not a *_view/*_core
  // name, so registered by hand: it holds no state of its own and reads its
  // host lazily, and a clock or an rng draw in here would reach the money path.
  'src/ui/claudium_purchase_bridge.ts',
  // The store's purchase-intent ledger. Not a *_view/*_core name, so the
  // completeness scan below would never adopt it: registered by hand so the
  // purity and determinism scans cover it. It holds one idempotency key per
  // open purchase intent, and a clock or an rng draw in here would make a
  // retry mint a new key, which is a second real charge.
  'src/ui/store_purchase_intent.ts',
  // The DURABLE half of that ledger: the row codec plus every guard that decides
  // whether a stored intent may be handed back (scope, charset, cost, age, cap).
  // Registered by hand for the same reason and with more force: it is the module
  // a staleness rule would tempt someone to give a clock, and a clock in here
  // would make the age check untestable and the ledger's own purity pointless.
  // The clock and the browser storage live one door over, in the deliberately
  // impure src/ui/purchase_intent_durability.ts.
  'src/ui/purchase_intent_record.ts',
  // What the open store remembers about charter FIT between paints: the server's
  // refusals plus the ladder count last painted against, and the rule by which a
  // count that moves DOWN invalidates the refusals (Bank Storage phase 15 QA).
  // Not a *_view/*_core name, so registered by hand like the intent ledger above.
  // It is deliberately DOM-free and clock-free: a wall-clock expiry in here would
  // make a refusal lapse mid-visit and repaint a guaranteed-to-fail card enabled.
  'src/ui/charter_fit_memory.ts',
  'src/ui/wallet_connection_view.ts',
  'src/ui/hud/loot/loot_roll_status_view.ts',
  'src/ui/hud/loot/loot_settings_view.ts',
  'src/ui/craft_celebration_view.ts',
  'src/ui/skill_level_toast_view.ts',
  'src/ui/grant_line_view.ts',
  'src/ui/crafting_view.ts',
  'src/ui/crafting_deny_core.ts',
  'src/ui/commission_order_view.ts',
  'src/ui/craft_cast_view.ts',
  'src/ui/profession_event_lines_core.ts',
  'src/ui/profession_identity_view.ts',
  'src/ui/profession_tutorial_view.ts',
  'src/ui/professions_view.ts',
  'src/ui/tutorial_greeting_view.ts',
  'src/ui/bootcamp_view.ts',
  'src/ui/coach_prompt_view.ts',
  'src/ui/objective_glow_view.ts',
  'src/ui/vendor_stock_gate_core.ts',
  'src/ui/market_view.ts',
  'src/ui/market_price_view.ts',
  'src/ui/market_name_color.ts',
  'src/ui/market_armor_badge.ts',
  'src/ui/market_buy_confirm_core.ts',
  'src/ui/usd_text.ts',
  'src/ui/woc_tokens_text.ts',
  'src/ui/woc_log_tones.ts',
  'src/ui/woc_balance_chip.ts',
  'src/ui/woc_market_chrome.ts',
  'src/ui/woc_market_activity_html.ts',
  'src/ui/guild_tag.ts',
  'src/ui/wallet_bridge_reason_text.ts',
  'src/ui/terms_link.ts',
  'src/ui/duration_text.ts',
  'src/ui/woc_affordable_core.ts',
  'src/ui/woc_market_poll_core.ts',
  'src/ui/woc_market_reason_text.ts',
  'src/ui/woc_market_view.ts',
  'src/ui/mailbox_view.ts',
  'src/ui/calendar_view.ts',
  'src/ui/char_view.ts',
  'src/ui/char_stats_view.ts',
  'src/ui/char_sheet_sig_core.ts',
  'src/ui/inspect_view.ts',
  'src/ui/quality_glow.ts',
  'src/ui/dungeon_map_view.ts',
  'src/ui/lastkeep_map_view.ts',
  'src/ui/map_pinch_zoom_core.ts',
  'src/ui/bg_field_relief_core.ts',
  'src/ui/castle_plan_core.ts',
  'src/ui/map_gather_tip_memo.ts',
  'src/ui/map_window_view.ts',
  'src/ui/continent_land_mask_core.ts',
  'src/ui/map_show_on_map_core.ts',
  'src/ui/continent_map_view.ts',
  'src/ui/map_open_sea_edge_core.ts',
  'src/ui/map_quest_list_view.ts',
  'src/ui/arena_window_view.ts',
  'src/ui/pvp_record_core.ts',
  'src/ui/pvp_tabs_view.ts',
  'src/ui/dungeon_finder_view.ts',
  'src/ui/yumi_match_view.ts',
  'src/ui/hud/battleground/battleground_atlas_view.ts',
  'src/ui/hud/battleground/battleground_window_view.ts',
  'src/ui/hud/battleground/bg_end_banner_view.ts',
  'src/ui/hud/battleground/battleground_scoreboard_view.ts',
  'src/ui/leaderboard_view.ts',
  'src/ui/guild_leaderboard_view.ts',
  // The signpost guild board's roster drill-in core (the board itself reuses
  // guild_leaderboard_view above).
  'src/ui/hud/guild_board/guild_roster_view.ts',
  'src/ui/dev_leaderboard_view.ts',
  'src/ui/dev_command_view.ts',
  'src/ui/dev_item_picker_view.ts',
  'src/ui/deeds_leaderboard_view.ts',
  'src/ui/daily_rewards_view.ts',
  'src/ui/deed_border_view.ts',
  'src/ui/deed_heraldry_plaque_core.ts',
  'src/ui/deeds_view.ts',
  'src/ui/reliquary_cell_art.ts',
  'src/ui/reliquary_view.ts',
  'src/ui/reliquary_sheet_view.ts',
  'src/ui/character_progression_view.ts',
  'src/ui/reliquary_tracker_view.ts',
  'src/ui/tracker_stack_anchor_core.ts',
  'src/ui/spellbook_view.ts',
  'src/ui/hud/quest/questlog_view.ts',
  'src/ui/swing_timer.ts',
  'src/ui/unit_frame.ts',
  'src/ui/hud_frames.ts',
  'src/ui/stance_bar_view.ts',
  'src/ui/hud/stance/stance_radial_core.ts',
  'src/ui/hud/action_bar/action_bar_view.ts',
  'src/ui/hud/action_bar/action_bar_layout_core.ts',
  'src/ui/hud/action_bar/action_bar_visibility_core.ts',
  'src/ui/hud/action_bar/action_bar_toggle_core.ts',
  'src/ui/hud/action_bar/action_bar_bind_core.ts',
  'src/ui/hud/action_bar/mobile_action_page_view.ts',
  'src/ui/hud/action_bar/consumable_bar_view.ts',
  'src/ui/hud/action_bar/consumable_strip_core.ts',
  'src/ui/hud/action_bar/radial_action_core.ts',
  'src/ui/hud/action_bar/bar_editor/bar_editor_core.ts',
  'src/ui/hud/menu/menu_strip_core.ts',
  'src/ui/hud/action_bar/radial_gesture_core.ts',
  'src/ui/hud/tap_menu_core.ts',
  'src/ui/hud/warlock/destruction_resource_view.ts',
  'src/ui/mobile_hud_layout.ts',
  'src/ui/mobile_fullscreen_window_core.ts',
  'src/ui/auras_view.ts',
  'src/ui/target_auras_view.ts',
  'src/ui/minimap_markers.ts',
  'src/ui/gathering_view.ts',
  'src/ui/gather_tool_tooltip.ts',
  'src/ui/tool_effect_tooltip.ts',
  'src/ui/fct_core.ts',
  'src/ui/fct_event.ts',
  'src/ui/honor_float_view.ts',
  'src/ui/heal_landing_feedback_core.ts',
  'src/ui/block_landing_feedback_core.ts',
  'src/ui/window_drag_core.ts',
  'src/ui/window_position_core.ts',
  'src/ui/window_resize_core.ts',
  'src/ui/window_stack_state_core.ts',
  'src/ui/target_frame_pos.ts',
  'src/ui/focus_order.ts',
  'src/ui/roving_index.ts',
  'src/ui/live_region_politeness.ts',
  'src/ui/discord_widget_view.ts',
  'src/ui/desktop_update_view.ts',
  'src/ui/gpu_notice_view.ts',
  'src/ui/perf_nudge_view.ts',
  'src/ui/hud/loot/corpse_harvest_view.ts',
  'src/ui/town_focus_view.ts',
  'src/ui/mount_race_view.ts',
  'src/ui/pet_action_icons.ts',
  'src/ui/pet_frame_view.ts',
  'src/ui/loading_backdrop_core.ts',
  'src/ui/loading_slow_hint_core.ts',
  'src/ui/reconnect_status_core.ts',
  'src/ui/chat_bubble_style.ts',
  'src/ui/hud/cross_hotbar/cross_hotbar_view.ts',
  'src/ui/dpad_nav_core.ts',
  'src/game/graphics_rebuild_core.ts',
  'src/game/presentation_gate.ts',
  'src/game/stale_chrome_focus.ts',
  'src/game/perf_diagnosis_core.ts',
  'src/game/post_entry_warmups_core.ts',
  'src/game/ui_effects_profile.ts',
  'src/game/ui_tier_knobs.ts',
  'src/ui/trade_view.ts',
  'src/ui/trade_woc_view.ts',
  'src/ui/hud/rift/rift_floor_tracker_view.ts',
  'src/ui/hud/woc_trade/woc_trade_offer_view.ts',
  'src/ui/safe_local_storage.ts',
].map((rel) => join(repoRoot, rel));

// The one pure core allowed to trip DOM_GLOBAL_VALUE_RE: the shared safeLocalStorage()
// feature-detect every persisted-toggle pure core now imports instead of duplicating.
// Every OTHER registered pure core must stay clear of it; the honesty check below
// keeps this from becoming a blanket exemption nobody needs.
const DOM_GLOBAL_VALUE_ALLOWLIST = new Set([join(repoRoot, 'src/ui/safe_local_storage.ts')]);

// Pure logic cores that live in src/render (the painter half is Three-side):
// cast_bar (the overhead cast/channel state) and nameplate_view (the per-entity
// nameplate visibility / anchor / threat / combo model). Each emits state
// from sim types with no Three import and no i18n, so a NameplatePainter /
// cast_bar painter draws it and a Vitest drives it directly.
// terrain_region_core (editor partial-rebuild chunk/texel selection math) and
// water_core (the shore-depth sample shared by build + editor setLevel) follow
// the same contract for the map editor's realtime terrain/water edits.
// day_night_core is the clock-to-grade math of the world day/night cycle
// (Date.now stays in the renderer that calls it), so a Vitest can drive any
// moment of the cycle. night_lighting_core is the pair of ramps every
// after-dark readability layer fades on, so it stays drivable without a
// renderer. (The streetlamp layout and style cores used to sit here too; they
// are `src/sim/streetlamp_layout.ts` and `src/sim/streetlamp_style.ts` now,
// because the sim collides with the posts it lays out.)
// post_bloom_shader_core is the host-agnostic GLSL source patch for the
// identity tint terms in UnrealBloom's composite shader.
const RENDER_PURE_CORES = [
  'src/render/arena_wall_occlusion_core.ts',
  'src/render/wall_backface_cull_core.ts',
  'src/render/dungeon_banner_core.ts',
  'src/render/dungeon_tile_kind_core.ts',
  'src/render/ignivar_dressing_plan_core.ts',
  'src/render/roof_darkness_core.ts',
  'src/render/varkhul_assembly_focus_core.ts',
  'src/render/delve_interior_cache_core.ts',
  'src/render/entity_gate_stand_in_core.ts',
  'src/render/entity_view_policy_core.ts',
  'src/render/quest_object_gate_core.ts',
  'src/render/adaptive_link_budget_core.ts',
  'src/render/affliction_familiar_core.ts',
  'src/render/arrival_event_core.ts',
  'src/render/build_lane_core.ts',
  'src/render/build_ledger_core.ts',
  'src/render/hitch_frame_align_core.ts',
  'src/render/initial_frame_core.ts',
  'src/render/characters/anim_state_entity_core.ts',
  'src/render/characters/death_grounding_core.ts',
  'src/render/entry_detail_horizon_core.ts',
  'src/render/characters/portrait_bitmap_transfer_core.ts',
  'src/render/characters/portrait_capture_lane_core.ts',
  'src/render/quest_beacon_core.ts',
  'src/render/coach_trail_core.ts',
  'src/render/island_isolation_core.ts',
  'src/render/characters/portrait_prewarm_core.ts',
  'src/render/characters/portrait_readback_core.ts',
  'src/render/characters/preview_open_gate_core.ts',
  'src/render/characters/soul_rend_prewarm_core.ts',
  'src/render/characters/design_code_core.ts',
  'src/render/live_program_watch_core.ts',
  'src/render/reveal_gate_core.ts',
  'src/render/town_reveal_core.ts',
  'src/render/foliage_bucket_reveal_core.ts',
  'src/render/foliage_prewarm_twins_core.ts',
  'src/render/character_effect_prewarm_core.ts',
  'src/render/frame_ms_stats_core.ts',
  'src/render/ability_vfx_core.ts',
  'src/render/characters/player_look_core.ts',
  'src/render/characters/far_lod_reveal_core.ts',
  'src/render/ability_vfx_longbuff_core.ts',
  'src/render/arena_water_band_core.ts',
  'src/render/biome_haze_field_core.ts',
  'src/render/battleground_core.ts',
  'src/render/battleground_fx_core.ts',
  'src/render/battleground_lantern_fx_core.ts',
  'src/render/battleground_rune_vfx_core.ts',
  'src/render/blade_grass_dense_core.ts',
  'src/render/blob_shadow_core.ts',
  'src/render/camera_boom_core.ts',
  'src/render/compile_gate.ts',
  'src/render/link_piece_core.ts',
  'src/render/program_variant_settle_core.ts',
  'src/render/camera_director_core.ts',
  'src/render/camera_feel_core.ts',
  'src/render/cast_bar.ts',
  'src/render/character_effects_core.ts',
  'src/render/character_presentation_core.ts',
  'src/render/character_view_core.ts',
  'src/render/chunk_residency_core.ts',
  'src/render/cliff_scree_core.ts',
  'src/render/dashed_ring_core.ts',
  'src/render/detail_horizon_core.ts',
  'src/render/drape_lod_core.ts',
  'src/render/weapon_vfx_emissive_cache_core.ts',
  'src/render/weapon_vfx_shed_core.ts',
  'src/render/draw_stats_core.ts',
  'src/render/fishing_bobber_core.ts',
  'src/render/flower_meadows_core.ts',
  'src/render/foliage_core.ts',
  'src/render/foliage_decimation_core.ts',
  'src/render/foliage_shore_gate_core.ts',
  'src/render/gpu_queue_window_core.ts',
  'src/render/compile_priority_core.ts',
  'src/render/view_create_budget_core.ts',
  'src/render/gpu_prep_budget_core.ts',
  'src/render/evil_eye_marker_core.ts',
  'src/render/kit_uv_surface_core.ts',
  'src/render/kit_window_panes_core.ts',
  'src/render/lich_audio_state_core.ts',
  'src/render/needle_of_fate_vfx_core.ts',
  'src/render/prewarm_resume_ledger_core.ts',
  'src/render/prewarm_resume_start_gate_core.ts',
  'src/render/preview_prewarm_lane.ts',
  'src/render/sentence_vfx_core.ts',
  'src/render/umbral_anchor_vfx_core.ts',
  'src/render/foliage_shader_core.ts',
  'src/render/foliage_shadow_core.ts',
  'src/render/frame_present.ts',
  'src/render/self_motion_rift_lift.ts',
  'src/render/shadow_cadence_core.ts',
  'src/render/shadow_texel_snap_core.ts',
  'src/render/frost_ice_fields_core.ts',
  'src/render/frost_sky_fade_core.ts',
  'src/render/gfx_aa_policy_core.ts',
  'src/render/gfx_override_core.ts',
  'src/render/ground_aim_reticle_core.ts',
  'src/render/ignivar_encounter_core.ts',
  'src/render/varkhul_encounter_core.ts',
  'src/render/ignivar_judgment_fire_core.ts',
  'src/render/stations_core.ts',
  'src/render/delve_interactable_visibility_core.ts',
  'src/render/drain_channel_visual_core.ts',
  'src/render/env_prefilter_core.ts',
  'src/render/environment_transition_core.ts',
  'src/render/ground_tilt_core.ts',
  'src/render/grass_build_slicer_core.ts',
  'src/render/grass_cap_collapse_core.ts',
  'src/render/step_smooth_core.ts',
  'src/render/eastbrook_town_visibility_core.ts',
  'src/render/fenbridge_town_visibility_core.ts',
  'src/render/occluder_fade_core.ts',
  'src/render/point_light_shader_core.ts',
  'src/render/final_color_nan_guard_core.ts',
  'src/render/post_bloom_shader_core.ts',
  'src/render/dynamic_resolution_core.ts',
  'src/render/post_plan_core.ts',
  'src/render/nameplate_view.ts',
  'src/render/nameplate_pick_core.ts',
  'src/render/nameplate_heraldry_core.ts',
  'src/render/net_interp_core.ts',
  'src/render/paladin_ascension_core.ts',
  'src/render/paladin_sun_verdict_core.ts',
  'src/render/prewarm_compile_submission_core.ts',
  'src/render/prewarm_submit_stop_core.ts',
  // Bare-named, so the on-disk *_core sweep cannot find them: registered
  // voluntarily (the prewarm_policy.ts precedent). Both are injected-clock pure
  // logic with no three and no DOM, and the pacing pair is exactly the kind of
  // module that grows a `performance.now()` the first time someone is in a hurry.
  'src/render/link_rate_budget.ts',
  'src/render/prewarm_compile_lifecycle.ts',
  'src/render/prewarm_policy.ts',
  // Same reason, one seam over: the per-interior encounter prewarm's decision
  // layer (which interior warms what, the kill switch, the live-queue verdict).
  'src/render/interior_encounter_prewarm.ts',
  'src/render/camp_brazier_placement_core.ts',
  'src/render/night_accents_core.ts',
  'src/render/night_light_field_core.ts',
  'src/render/night_lighting_core.ts',
  'src/render/opaque_draw_order_core.ts',
  'src/render/perceptual_lod_core.ts',
  'src/render/prop_cell_core.ts',
  'src/render/prop_cull_core.ts',
  'src/render/race_line_core.ts',
  'src/render/renderer_frame_telemetry_core.ts',
  'src/render/rift_death_zone_core.ts',
  'src/render/scene_census_core.ts',
  'src/render/sea_mist_core.ts',
  'src/render/self_prediction_core.ts',
  'src/render/self_render_position_core.ts',
  'src/render/shadow_pass_gate_core.ts',
  'src/render/shore_water_gate_core.ts',
  'src/render/terrain_region_core.ts',
  'src/render/texture_prep_core.ts',
  'src/render/terrain_splat_presence_core.ts',
  'src/render/vfx_pool_core.ts',
  'src/render/view_candidate_pool_core.ts',
  'src/render/water_core.ts',
  'src/render/water_coverage_core.ts',
  'src/render/water_wave_core.ts',
  'src/render/weather_field_core.ts',
  'src/render/water_flora_core.ts',
  'src/render/water_flora_shader_core.ts',
  'src/render/day_night_core.ts',
  'src/render/authored_walls_core.ts',
  'src/render/garden_maze_core.ts',
  'src/render/garden_parterre_core.ts',
  'src/render/far_surface_core.ts',
  'src/render/far_terrain_core.ts',
  'src/render/foliage_impostor_core.ts',
  'src/render/lava_chain_core.ts',
  'src/render/foliage_lod.ts',
  'src/render/prewarm_pass.ts',
  'src/render/prewarm_policy.ts',
  'src/render/prewarm_resume.ts',
  'src/render/resident_scenery_core.ts',
  'src/render/sky_residency_core.ts',
  'src/render/player_aura_rings_core.ts',
  'src/render/warrior_cast_fx_core.ts',
  'src/render/characters/form_visual_selection_core.ts',
  'src/render/characters/metamorph_wing_motion_core.ts',
  'src/render/warlock_meteor_fx_core.ts',
  'src/render/weapon_vfx_apply_queue_core.ts',
  'src/render/weapon_vfx_emissive_core.ts',
  'src/render/zone_feature_visibility_core.ts',
  'src/render/zone_eviction_core.ts',
  'src/render/zone_prewarm_templates_core.ts',
  'src/render/characters/skeleton_update_core.ts',
  'src/render/characters/material_program_shape_core.ts',
  'src/render/characters/tinted_material_cache_core.ts',
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
  'src/ui/banner_queue.ts',
  'src/ui/item_instance_glyph_mark.ts',
  'src/ui/item_kind_label.ts',
  'src/ui/item_name_color.ts',
  'src/ui/market_name_color.ts',
  'src/ui/market_armor_badge.ts',
  'src/ui/usd_text.ts',
  'src/ui/woc_tokens_text.ts',
  'src/ui/woc_log_tones.ts',
  'src/ui/woc_balance_chip.ts',
  'src/ui/woc_market_chrome.ts',
  'src/ui/woc_market_activity_html.ts',
  'src/ui/guild_tag.ts',
  'src/ui/wallet_bridge_reason_text.ts',
  'src/ui/terms_link.ts',
  'src/ui/duration_text.ts',
  'src/ui/woc_market_reason_text.ts',
  'src/render/foliage_lod.ts',
  'src/render/frame_present.ts',
  'src/render/self_motion_rift_lift.ts',
  'src/game/presentation_gate.ts',
  'src/game/stale_chrome_focus.ts',
  'src/render/compile_gate.ts',
  'src/render/link_rate_budget.ts',
  'src/render/prewarm_compile_lifecycle.ts',
  'src/render/prewarm_pass.ts',
  'src/render/interior_encounter_prewarm.ts',
  'src/render/prewarm_policy.ts',
  'src/render/prewarm_resume.ts',
  'src/render/preview_prewarm_lane.ts',
  'src/ui/mob_idle_sfx.ts',
  'src/ui/gather_tool_tooltip.ts',
  'src/ui/tool_effect_tooltip.ts',
  'src/ui/known_item.ts',
  'src/ui/unit_portrait.ts',
  'src/ui/xp_bar.ts',
  'src/ui/absorb_bar.ts',
  'src/ui/party_frames.ts',
  'src/ui/party_collapse.ts',
  'src/ui/guild_hide_offline.ts',
  'src/ui/guild_motd_login.ts',
  'src/ui/rest_indicator.ts',
  'src/ui/low_health.ts',
  'src/ui/low_resource.ts',
  'src/ui/map_gather_tip_memo.ts',
  'src/ui/clock.ts',
  'src/ui/compass.ts',
  'src/ui/coords.ts',
  'src/ui/bag_filter.ts',
  'src/ui/bag_item_context_menu.ts',
  'src/ui/bank_filter.ts',
  'src/ui/item_slot_labels.ts',
  'src/ui/hud/quest/quest_tracker.ts',
  'src/ui/quest_marker_tags.ts',
  'src/ui/hud/delve/delve_map.ts',
  'src/ui/swing_timer.ts',
  'src/ui/target_frame_pos.ts',
  'src/ui/unit_frame.ts',
  'src/ui/hud_frames.ts',
  'src/ui/minimap_markers.ts',
  'src/ui/fct_event.ts',
  'src/ui/focus_order.ts',
  'src/ui/roving_index.ts',
  'src/ui/live_region_politeness.ts',
  'src/ui/log_event_route.ts',
  'src/ui/mobile_hud_layout.ts',
  'src/ui/pet_action_icons.ts',
  'src/ui/quality_glow.ts',
  'src/ui/reliquary_cell_art.ts',
  'src/ui/chat_bubble_style.ts',
  'src/game/ui_effects_profile.ts',
  'src/game/ui_tier_knobs.ts',
  'src/render/cast_bar.ts',
  'src/ui/safe_local_storage.ts',
  'src/ui/claudium_purchase_bridge.ts',
  'src/ui/store_purchase_intent.ts',
  'src/ui/purchase_intent_record.ts',
  'src/ui/charter_fit_memory.ts',
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

  it('imports nothing from render/ui/game/net/server or three (host-agnostic core)', () => {
    const violations = scanImports(simFiles, forbiddenImport);
    expect(violations, `src/sim must stay host-agnostic:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the ban actually FIRES on every spelling a sim file could reach a host by', () => {
    // A guard with no self-test is a guard nobody has seen fail. The
    // directory-with-trailing-slash spellings were caught; the BARE ones
    // (`../server`, `../../server.js`) were not, and a type-only
    // `import type { X } from '../server'` is exactly the shape a sim file
    // drifts into first.
    for (const spec of [
      '../server',
      '../../server.js',
      '../../server/game',
      './server/db',
      '../net',
      '../net/online',
      '../ui/hud',
      '../render/renderer',
      '../game/input',
      'three',
      'three/examples/jsm/x',
    ]) {
      expect(forbiddenImport(spec), spec).not.toBeNull();
    }
    // ...and does NOT fire on the legitimate neighbours, so it can never be
    // satisfied by a rule that simply bans everything.
    for (const spec of [
      './types',
      '../world_api',
      '../world_api/guild_bank',
      './professions/training',
      'node:assert',
      './my_server_helper',
      './renderer_notes',
    ]) {
      expect(forbiddenImport(spec), spec).toBeNull();
    }
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

// ---------------------------------------------------------------------------
// Reliquary state mutation scope: every write to the sparse blob's surfaces
// lives in ONE module, because the wire memo depends on it.
// ---------------------------------------------------------------------------
//
// src/sim/reliquary.ts memoizes the serialized `reliq` self blob per state
// revision, and every writer inside it bumps that revision. A write from
// anywhere else would not bump, and the failure mode is SILENT: the server
// compares the memo's string against session.lastSent, so a stale build ships
// NOTHING and the client keeps the old blob forever with no error on any
// surface. Nothing reds, nothing logs, the player just stops seeing finds.
//
// So the invariant is scope, not spelling: the five mutable surfaces
// (firstFind, marks, recent, counts, illuminatedPages) are written only by
// the module that owns the revision counter. REPLACING the whole
// `meta.reliquary` object is deliberately allowed (sim.ts does it on
// character load) and is safe for the opposite reason: a fresh object has a
// fresh identity, so the identity-keyed cache simply has no entry for it.
const RELIQUARY_STATE_OWNER = join(simRoot, 'reliquary.ts');
const RELIQUARY_SURFACES = 'firstFind|marks|recent|counts|illuminatedPages';
// Every assignment operator spelling: plain `=`, the compound forms
// (`+=`, `??=`, `||=`, `&&=`, `**=`, shifts, bitwise), guarded so `==`,
// `===`, `>=`, `<=`, and `!=` comparisons never fire (the operator class
// excludes `<`, `>`, and `!`, and the trailing `[^=]` excludes `==`).
const ASSIGN_OP = `(?:\\*\\*|<<|>>>|>>|\\?\\?|\\|\\||&&|[+\\-*/%&|^])?=[^=]`;
/** Assignment or in-place mutation of a Reliquary state surface. */
const RELIQUARY_WRITE_RE = new RegExp(
  `\\.reliquary\\.(?:${RELIQUARY_SURFACES})\\s*` +
    `(?:(?:\\.length\\s*)?${ASSIGN_OP}` +
    `|\\[[^\\]]*\\]\\s*${ASSIGN_OP}` +
    `|(?:\\[[^\\]]*\\]|\\.length)?\\s*(?:\\+\\+|--)` +
    `|\\.(?:add|delete|clear|set|push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\\s*\\()`,
);
/** `delete x.reliquary.firstFind[id]`, which the shape above cannot see. */
const RELIQUARY_DELETE_RE = new RegExp(
  `\\bdelete\\s+[^;]*\\.reliquary\\.(?:${RELIQUARY_SURFACES})\\b`,
);
/** Prefix increment and Object.assign, which put the surface AFTER the verb. */
const RELIQUARY_PREFIX_RE = new RegExp(
  `(?:\\+\\+|--)\\s*[\\w.$]*\\.reliquary\\.(?:${RELIQUARY_SURFACES})\\b`,
);
const RELIQUARY_OBJASSIGN_RE = new RegExp(
  `Object\\.assign\\(\\s*[^,)]*\\.reliquary\\.(?:${RELIQUARY_SURFACES})\\b`,
);
// ACCEPTED LIMITATION: a line regex cannot see identity-level aliasing, so a
// write through a stored alias (`const st = meta.reliquary; st.counts[id] = 1`)
// or through a held surface reference (`ownership.marks.add(id)`) escapes this
// scan. The owning module itself uses exactly those shapes internally, which is
// legal (its writers bump the wire revision); outside it, none exist today
// (verified by hand at Phase 17). This guard is a tripwire for the common
// spellings, not a proof: treat a new alias-shaped write as a review item.
function reliquaryStateWrite(line: string): boolean {
  return (
    RELIQUARY_WRITE_RE.test(line) ||
    RELIQUARY_DELETE_RE.test(line) ||
    RELIQUARY_PREFIX_RE.test(line) ||
    RELIQUARY_OBJASSIGN_RE.test(line)
  );
}

describe('Reliquary sparse-state writes stay inside their owning module', () => {
  // headless/ joins the walk: the RL env server holds a live Sim and could
  // grow a surface write as easily as server/ (it has none today).
  const scanned = [
    ...walk(simRoot),
    ...walk(join(repoRoot, 'server')),
    ...walk(join(repoRoot, 'headless')),
  ].filter((f) => f !== RELIQUARY_STATE_OWNER);

  it('finds all three trees to scan', () => {
    // Floor ABOVE the flat top-level file count of either large root ALONE
    // (about 139 for src/sim and 167 for server at authoring, recursive total
    // about 650), so a walk that silently stopped recursing, or lost one of
    // the two LARGE roots, cannot pass (headless is two files; only its
    // membership arm below catches losing it). The .some() arms pin the
    // recursion reaching a nested directory in each large root and the
    // headless root being present at all.
    expect(scanned.length).toBeGreaterThan(500);
    expect(scanned.some((f) => f.includes(join('src', 'sim', 'professions')))).toBe(true);
    expect(scanned.some((f) => f.includes(join('server', 'http')))).toBe(true);
    // Anchored on a real file, not a bare path fragment: a checkout whose own
    // absolute path contains a `headless` component must not satisfy this.
    expect(scanned.some((f) => f.endsWith(join('headless', 'env_server.ts')))).toBe(true);
    // The owner itself is excluded, and it really exists (an excluded path that
    // is simply a typo would make this whole guard vacuous).
    expect(existsSync(RELIQUARY_STATE_OWNER)).toBe(true);
    expect(scanned).not.toContain(RELIQUARY_STATE_OWNER);
  });

  it('no module outside src/sim/reliquary.ts writes firstFind / marks / recent / counts / illuminatedPages', () => {
    const violations = scanLines(scanned, RELIQUARY_WRITE_RE)
      .concat(scanLines(scanned, RELIQUARY_DELETE_RE))
      .concat(scanLines(scanned, RELIQUARY_PREFIX_RE))
      .concat(scanLines(scanned, RELIQUARY_OBJASSIGN_RE));
    expect(
      violations,
      'a Reliquary state write outside its owning module skips the wire-memo revision bump,\n' +
        'which ships a STALE blob silently (see src/sim/reliquary.ts reliquaryWireJson):\n' +
        `${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('noteRelicObtain is called from exactly the two grant hubs (caller-set pin)', () => {
    // The tally writer takes `meta` directly (no SimContext hop), so a NEW
    // caller adopts whatever movement policy it likes with no seam forcing
    // the question, and the line-regex ban above cannot see it (the write
    // happens inside the owning module on the caller's behalf). Pin the
    // caller set AND the call text: both call sites must be the hub line
    // with its movement gate intact, so a dropped `!opts?.movement` prefix,
    // a changed copies argument, or a replacement arm elsewhere in sim.ts
    // all red here, not just a third file. A new caller is not banned, it is
    // a REVIEW ITEM: extend this pin only after classifying the new site
    // against the movement rule. Scope: all of src/ (ClientWorld and the UI
    // import from the owning module already, so a caller there is one import
    // away) plus server/ and headless/; the owner file is excluded, which is
    // also what keeps its own `export function noteRelicObtain(` definition
    // line from matching. Accepted limitation: an aliased import
    // (`import { noteRelicObtain as x }`) escapes the regex; treat one as a
    // review item, the same standing as the write-ban's alias blind spot.
    const callerScanned = [
      ...walk(join(repoRoot, 'src')),
      ...walk(join(repoRoot, 'server')),
      ...walk(join(repoRoot, 'headless')),
    ].filter((f) => f !== RELIQUARY_STATE_OWNER);
    const callers = scanLines(callerScanned, /\bnoteRelicObtain\s*\(/);
    const files = [...new Set(callers.map((v) => v.split(':')[0]))].sort();
    expect(files, `unexpected noteRelicObtain callers:\n${callers.join('\n')}`).toEqual([
      relative(repoRoot, join(simRoot, 'sim.ts')),
    ]);
    const texts = callers.map((v) => v.slice(v.indexOf('  ') + 2));
    expect(texts, 'both hub arms carry the movement gate and per-copy count').toEqual([
      'if (!opts?.movement) noteRelicObtain(meta, itemId, count);',
      'if (!opts?.movement) noteRelicObtain(meta, itemId, count);',
    ]);
  });

  it('the ban FIRES on every write spelling, and spares reads and whole-object replacement', () => {
    // A guard with no self-test is a guard nobody has seen fail.
    for (const line of [
      'meta.reliquary.marks.add(markId);',
      'meta.reliquary.marks.delete(markId);',
      'meta.reliquary.marks.clear();',
      'meta.reliquary.recent.push(id);',
      'meta.reliquary.recent.shift();',
      'meta.reliquary.recent.splice(i, 1);',
      'meta.reliquary.recent.sort();',
      'state.reliquary.firstFind[itemId] = {};',
      'r.meta.reliquary.counts[id] = 3;',
      'meta.reliquary.counts = {};',
      'this.primary.reliquary.recent = [];',
      'delete meta.reliquary.firstFind[itemId];',
      // Compound assignment, increment, and after-the-verb spellings: the
      // shapes a tally write from another module would most plausibly use.
      'meta.reliquary.counts[id] += 1;',
      'meta.reliquary.counts[itemId]++;',
      '++meta.reliquary.counts[id];',
      'meta.reliquary.firstFind[id] ??= {};',
      'meta.reliquary.recent.length = 0;',
      'Object.assign(meta.reliquary.counts, saved);',
      // The Phase 18 sticky illumination record: every write spelling an
      // outside module would plausibly use against the Set surface.
      'meta.reliquary.illuminatedPages.add(pageId);',
      'meta.reliquary.illuminatedPages.delete(pageId);',
      'meta.reliquary.illuminatedPages.clear();',
      'meta.reliquary.illuminatedPages = new Set();',
    ]) {
      expect(reliquaryStateWrite(line), line).toBe(true);
    }
    // ...and does NOT fire on reads, which are everywhere and legitimate, nor
    // on replacing the whole state object (safe: fresh identity, fresh cache).
    for (const line of [
      'return this.primary.reliquary.firstFind;',
      'return this.primary.reliquary.counts;',
      'if (meta.reliquary.marks.has(markId)) return false;',
      'const n = meta.reliquary.counts[id] ?? 0;',
      'expect(meta.reliquary.recent).toEqual([]);',
      'meta.reliquary = restoreReliquaryState(s.reliquary);',
      'marks: this.primary.reliquary.marks,',
      'if (meta.reliquary.firstFind[itemId] === undefined) return;',
      // Comparison and arithmetic READS that the widened operator arm must
      // keep sparing: >= and <= and != end in the same '=' a lazy regex trips on.
      'if (meta.reliquary.counts[id] >= 1) return;',
      'while (meta.reliquary.recent.length > cap) {',
      'const more = meta.reliquary.counts[id] + 1;',
      'if (meta.reliquary.counts[id] != null) draw();',
      // Reads of the illumination record are everywhere-legal like the rest.
      'if (meta.reliquary.illuminatedPages.has(pageId)) continue;',
      // The NEAR-MISS identifier: `illuminatedPageId` is the reliquaryUnlock
      // EVENT field, not a state surface, and the surface name was chosen so
      // neither is a prefix of the other. Even a write spelled through it
      // must not match (tsc rejects the field anyway); a sloppy prefix-style
      // alternation would false-positive on exactly these lines.
      'meta.reliquary.illuminatedPageId = pageId;',
      'const bannerPage = ev.illuminatedPageId;',
    ]) {
      expect(reliquaryStateWrite(line), line).toBe(false);
    }
  });
});

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

// The $WOC token firewall (docs/prd/woc/marketplace.md "Constraints"): no
// wallet, token, or settlement code may live in src/sim. The PRD names this
// scan as the mechanical enforcement, so it exists here rather than as prose.
// The allowlist is read-only projections of chain state, never money logic.
describe('the $WOC token firewall over src/sim', () => {
  // The ONE tenant: daily_rewards_stub.ts, the offline daily-rewards readout
  // (#1307), which is a constant literal with no logic behind it. It was carved
  // out of sim.ts precisely so the coordinator is scanned like every other
  // file. holder_tier.ts and types.ts came OFF this list when they were
  // measured against the pattern: the cosmetic holder ladder and the holder
  // field declarations name none of this vocabulary outside comments, and an
  // allowlist entry that is not covering a real hit only hides the next one.
  // A NEW file wanting on this list is the signal the firewall is being
  // breached, not extended.
  const FIREWALL_ALLOWED = new Set(['src/sim/daily_rewards_stub.ts']);
  // The shape every allowlisted file must keep to stay exempt: a read-only
  // projection. Exactly ONE `export function`, and the only other statements
  // allowed are type-only lines (`export type`, `import type`). Everything
  // that could grow money LOGIC behind the exemption is refused by name:
  // any other export form (const/let/var/class/default/interface/enum), a
  // re-export (`export {}` / `export *`, which would let the file front a
  // module nothing scans), a generator, control flow, try/catch, the logical
  // operators, a ternary or optional, a value import, and a dynamic
  // `import(...)`. Each rule is proven to bite against a synthetic offender
  // below, so none of them is passing merely because the file never had the
  // construct; the non-vacuity check additionally requires each entry to
  // still carry a real pattern hit, so a stale entry cannot linger as a
  // whole-file blind spot.
  const PROJECTION_RULES: [string, RegExp][] = [
    ['a non-function export', /\bexport\s+(?!(?:async\s+)?function\b|type\b)/],
    ['a re-export', /\bexport\s*[{*]/],
    ['a generator', /\bfunction\s*\*/],
    ['control flow', /\b(?:if|for|while|switch)\s*\(/],
    ['a try or catch', /\b(?:try|catch)\b/],
    ['a logical operator', /&&|\|\||\?\?/],
    ['a ternary or optional', /\?/],
    ['a value import', /^import\b(?!\s+type\s)/m],
    ['a dynamic import', /\bimport\s*\(/],
  ];
  const projectionViolations = (src: string): string[] =>
    PROJECTION_RULES.filter(([, re]) => re.test(src)).map(([rule]) => rule);
  // Identifier-shaped money/chain vocabulary. Deliberately NOT matched inside
  // comments (the escrow prose in market.ts and inventory_extract.ts is fine):
  // the scan strips comments first, exactly like the sibling purity scans.
  // No trailing \b on purpose: the leak shapes are COMPOUND identifiers
  // (sellerWallet, walletForAccount, quoteUsdCents), which a closed word
  // boundary would miss entirely.
  // The compound arms carry NO LEFT boundary either, and that asymmetry is
  // deliberate: a sim file named orderSignature or blockHash over-matches and
  // reds at PR time, which costs one reviewer glance, while a missed leak
  // costs the firewall. Failing toward MORE scanning is the direction this
  // guard prefers.
  // `treasury` carries a REQUIRED money suffix, unlike the rest. A bare match was
  // too broad to survive contact with the game's own vocabulary: v0.34.0 added a
  // keep room whose id is literally 'treasury' (src/sim/dungeon_layout.ts), which
  // is a place on a map, not a fee destination. Every shape this firewall exists
  // to catch is compound anyway (treasuryWallet, treasuryBps), and the bare word
  // was the one token here that could flag ordinary content.
  // `signature` is narrowed the same way and for the same reason: the bare word
  // is the game's own vocabulary (the talent-spec `signature` field, ability and
  // reliquary descriptions calling something a signature move), while every leak
  // shape is a money-affixed compound (txSignature, signature_reused,
  // signatureRequired). Bare `token` is left out entirely on the same grounds
  // (riftToken, chatTokens).
  // The affix sets are calibrated against the REAL identifier corpus of the
  // excluded modules (server/woc_market_*, claudium_proxy, native_attestation,
  // woc_balance), not invented examples: treasuryBase, signatureAtMs,
  // derSignature, signatureHeader, bs58 (the npm package name, which the
  // literal 'base58' misses), keypair, the secret- and private-key shapes,
  // blockhash, and the transaction verbs all exist server-side today. (The
  // key shapes are spelled with their optional separator in the pattern
  // below and hyphenated here so the malware scanner's own key-exfil
  // signature, which hunts the contiguous identifiers, does not flag the
  // very guard that forbids them in the sim.)
  const FIREWALL_RE =
    /(?:wallet|pubkey|solana|usdcents|pricecents|amountbase|settlementquote|bondcents|treasury[_-]?(?:wallet|pubkey|address|bps|cents|leg|share|base|cut|fee|account)|custodyclaim|lamports|base58|bs58|keypair|secret[_-]?key|private[_-]?key|blockhash|spl[_-]?token|(?:send|sign)[_-]?transaction|woc[_-]?(?:balance|price|amount|payout|transfer)|(?:tx|txn|bond|settlement|burn|transfer|der|escrow|payer|seller|mint)[_-]?signature|signature[_-]?(?:reused|required|field|header|verified|at[_-]?ms|bytes))/i;

  it('exempts exactly one file, by exact membership', () => {
    // Set EQUALITY, not a lower bound: widening the exemption has to be a
    // deliberate visible edit to this line, never a quiet extra entry that
    // takes a whole sim file out of the scan.
    expect([...FIREWALL_ALLOWED]).toEqual(['src/sim/daily_rewards_stub.ts']);
    expect(FIREWALL_ALLOWED.size).toBe(1);
  });

  it('keeps wallet, token, and settlement identifiers out of every sim file', () => {
    const offenders: string[] = [];
    for (const file of simFiles) {
      const rel = relative(repoRoot, file).replace(/\\/g, '/');
      if (FIREWALL_ALLOWED.has(rel)) continue;
      const stripped = stripComments(readFileSync(file, 'utf8'));
      const hit = FIREWALL_RE.exec(stripped);
      if (hit) offenders.push(`${rel}: ${hit[0]}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('is non-vacuous: the scan sees the sim tree and its own pattern bites', () => {
    // Near the real count (492 today) per the tests/CLAUDE.md floor rule: a
    // walk that quietly lost most of the tree must fail here, because with
    // sim.ts off the allowlist the corpus IS the firewall.
    expect(simFiles.length).toBeGreaterThan(480);
    // Every allowlisted file still exists, still trips the pattern (a stale
    // entry is a whole-file blind spot), and still has the read-only
    // projection shape spelled out at PROJECTION_RULES above.
    for (const rel of FIREWALL_ALLOWED) {
      const src = readFileSync(join(repoRoot, rel), 'utf8');
      const stripped = stripComments(src);
      expect(FIREWALL_RE.test(stripped), `${rel} no longer trips the pattern`).toBe(true);
      // \b, not a trailing space: `export function* rows()` is a generator
      // whose exported name a space-anchored count never sees.
      expect(
        stripped.match(/\bexport\s+(?:async\s+)?function\b/g),
        `${rel} export count`,
      ).toHaveLength(1);
      expect(projectionViolations(stripped), `${rel} left the read-only projection shape`).toEqual(
        [],
      );
      // Inline type imports (import { type X }) are deliberately refused by
      // the value-import rule too: write them as import type instead.
    }
    // Both compound shapes must bite, and ordinary custody vocabulary must not.
    expect(FIREWALL_RE.test('const w = walletForAccount(id);')).toBe(true);
    expect(FIREWALL_RE.test('const k = row.sellerWallet;')).toBe(true);
    expect(FIREWALL_RE.test('const escrowed = extractTradableCopy(inv, ref, def);')).toBe(false);
    // The narrowed treasury arm, both directions: a fee destination or a split
    // still bites, a room on a dungeon map does not.
    expect(FIREWALL_RE.test('const dest = cfg.treasuryWallet;')).toBe(true);
    expect(FIREWALL_RE.test('const bps = TREASURY_BPS;')).toBe(true);
    expect(FIREWALL_RE.test("{ id: 'treasury', x0: 32, x1: 42 }")).toBe(false);
    // The chain-settlement arms: an on-chain amount, an address encoding, and
    // both compound signature shapes.
    expect(FIREWALL_RE.test('const sig = row.txSignature;')).toBe(true);
    expect(FIREWALL_RE.test('const b = toBase58(pk);')).toBe(true);
    expect(FIREWALL_RE.test('const fee = LAMPORTS_PER_SOL / 2;')).toBe(true);
    expect(FIREWALL_RE.test("if (reason === 'signature_reused') {")).toBe(true);
    // ...and the game's own `signature`, which the narrowing must leave alone:
    // player copy, the talent-spec field, and an ordinary derived-key helper.
    expect(
      FIREWALL_RE.test("description: 'Blasts nearby enemies with frost. (Frost signature)'"),
    ).toBe(false);
    expect(FIREWALL_RE.test("signature: 'mortal_strike',")).toBe(false);
    expect(FIREWALL_RE.test('stationTypesSignature(types)')).toBe(false);
  });

  // One realistic usage per pattern arm the checks above do not already reach.
  // An arm nobody probes is an arm a careless narrowing can delete for free,
  // which is how a firewall loses a lane while staying green.
  //
  // The key shapes and the two transaction verbs are ASSEMBLED from fragments
  // rather than spelled contiguously: the repo's malware scanner hunts exactly
  // those source shapes (its key-exfil and web3-drain signatures), and the
  // guard that forbids them in the sim must not read as one itself (the same
  // hyphenation workaround the pattern comment describes). Each probe still
  // carries the whole identifier at RUNTIME, which is what the pattern sees.
  const CAMEL_KEY = 'Key';
  const SNAKE_KEY = '_key';
  const TX = 'Transaction';
  const FIREWALL_ARM_PROBES: [string, string][] = [
    ['bs58', 'const enc = bs58.encode(bytes);'],
    ['keypair', 'const kp = keypairFromSeed(seed);'],
    ['a camel-cased secret key', `const k = cfg.secret${CAMEL_KEY};`],
    ['a snake-cased secret key', `const k = row.secret${SNAKE_KEY};`],
    ['a private key', `const k = cfg.private${CAMEL_KEY};`],
    ['blockhash', 'const { blockhash } = await conn.getLatest();'],
    ['splToken', 'const mint = splToken.createMint(conn, payer);'],
    ['sendTransaction', `await conn.send${TX}(tx);`],
    ['signTransaction', `const signed = await provider.sign${TX}(tx);`],
    ['wocBalance', 'const bal = row.wocBalance;'],
    ['wocPrice', 'const price = quote.wocPrice;'],
    ['wocAmount', 'const amount = order.wocAmount;'],
    ['wocPayout', 'const payout = leg.wocPayout;'],
    ['wocTransfer', 'await wocTransfer(from, to, amount);'],
    ['treasuryPubkey', 'const dest = cfg.treasuryPubkey;'],
    ['treasuryAddress', 'const dest = cfg.treasuryAddress;'],
    ['treasuryBase', 'const base = split.treasuryBase;'],
    ['treasuryCents', 'const cents = split.treasuryCents;'],
    ['treasuryLeg', 'const leg = split.treasuryLeg;'],
    ['treasuryShare', 'const share = split.treasuryShare;'],
    ['treasuryCut', 'const cut = split.treasuryCut;'],
    ['treasuryFee', 'const fee = split.treasuryFee;'],
    ['treasuryAccount', 'const acct = cfg.treasuryAccount;'],
    ['txnSignature', 'const sig = row.txnSignature;'],
    ['derSignature', 'const sig = row.derSignature;'],
    ['bondSignature', 'const sig = row.bondSignature;'],
    ['settlementSignature', 'const sig = row.settlementSignature;'],
    ['burnSignature', 'const sig = row.burnSignature;'],
    ['transferSignature', 'const sig = row.transferSignature;'],
    ['escrowSignature', 'const sig = row.escrowSignature;'],
    ['payerSignature', 'const sig = row.payerSignature;'],
    ['sellerSignature', 'const sig = row.sellerSignature;'],
    ['mintSignature', 'const sig = row.mintSignature;'],
    ['signatureRequired', 'const need = rules.signatureRequired;'],
    ['signatureField', 'const field = body.signatureField;'],
    ['signatureHeader', 'const header = req.signatureHeader;'],
    ['signatureVerified', 'const ok = row.signatureVerified;'],
    ['signatureAtMs', 'const at = row.signatureAtMs;'],
    ['signatureBytes', 'const raw = row.signatureBytes;'],
    ['custodyClaim', 'const claim = row.custodyClaim;'],
    ['usdCents', 'const usd = quote.usdCents;'],
    ['priceCents', 'const price = row.priceCents;'],
    ['bondCents', 'const bond = order.bondCents;'],
    ['amountBase', 'const amount = order.amountBase;'],
    ['settlementQuote', 'const quote = order.settlementQuote;'],
    ['pubkey', 'const pk = session.pubkey;'],
    ['solana', 'const rpc = cfg.solanaRpcUrl;'],
  ];

  it.each(FIREWALL_ARM_PROBES)('bites on %s', (_arm, probe) => {
    expect(FIREWALL_RE.test(probe)).toBe(true);
  });

  // The read-only-projection shape, proven rule by rule. Each offender names
  // the rule it must trip, so deleting or loosening one rule reds here even
  // though the one allowlisted file never carried the construct.
  const PROJECTION_OFFENDERS: [string, string, string][] = [
    ['a generator export', 'export function* rows() { yield 1; }', 'a generator'],
    ['a named re-export', "export { dailyRewardsStub } from './other';", 'a re-export'],
    ['a star re-export', "export * from './other';", 'a re-export'],
    ['an exported interface', 'export interface Shape { a: number }', 'a non-function export'],
    ['an exported enum', 'export enum Tier { One }', 'a non-function export'],
    ['an exported const', 'export const rate = 1;', 'a non-function export'],
    ['a loop', 'for (const row of rows) sum += row.a;', 'control flow'],
    ['a try block', 'try { run(); } catch { }', 'a try or catch'],
    ['a logical and', 'const v = a && b;', 'a logical operator'],
    ['a logical or', 'const v = a || b;', 'a logical operator'],
    ['a nullish fallback', 'const v = a ?? b;', 'a logical operator'],
    ['a ternary', 'const v = a > 1 ? a : b;', 'a ternary or optional'],
    ['a value import', "import { ITEMS } from './data';", 'a value import'],
    ['a dynamic import', "const m = await import('./other');", 'a dynamic import'],
  ];

  it.each(PROJECTION_OFFENDERS)('refuses %s in an allowlisted file', (_label, src, rule) => {
    expect(projectionViolations(src)).toContain(rule);
  });

  it('probes every projection rule, and still allows the one sanctioned shape', () => {
    // Completeness both ways: a new rule with no offender above is unproven
    // (the distinct rule names the offenders trip must cover the whole list),
    // and the shape the exemption exists for must keep passing.
    const probed = new Set(PROJECTION_OFFENDERS.map(([, , rule]) => rule));
    expect(probed.size).toBe(PROJECTION_RULES.length);
    const sanctioned = [
      "import type { DailyRewardStatus } from '../world_api';",
      'export type Readout = DailyRewardStatus;',
      'export function readout(): Promise<Readout> {',
      "  return Promise.resolve({ day: '1970-01-01' } as Readout);",
      '}',
    ].join('\n');
    expect(projectionViolations(sanctioned)).toEqual([]);
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

  it('touches no DOM/browser globals (member access AND value-position typeof/instanceof/direct-assign)', () => {
    const memberViolations = scanLines(UI_PURE_CORES, DOM_GLOBAL_RE);
    const valueScanFiles = UI_PURE_CORES.filter((f) => !DOM_GLOBAL_VALUE_ALLOWLIST.has(f));
    const valueViolations = scanLines(valueScanFiles, DOM_GLOBAL_VALUE_RE);
    const violations = [...memberViolations, ...valueViolations];
    expect(
      violations,
      `src/ui pure cores must run headless (no DOM globals):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  // Honesty check for DOM_GLOBAL_VALUE_ALLOWLIST (mirrors the UI_DOM_MODULES honesty
  // check below): the exemption must name an actually-registered pure core that
  // actually needs it, so it cannot rot into a blanket opt-out nobody uses.
  it('keeps the value-position DOM exemption honest (registered, and still needs it)', () => {
    for (const f of DOM_GLOBAL_VALUE_ALLOWLIST) {
      const shown = relative(repoRoot, f);
      expect(
        UI_PURE_CORES,
        `${shown} must be a registered pure core to need this exemption`,
      ).toContain(f);
      const code = stripComments(readFileSync(f, 'utf8'));
      expect(
        DOM_GLOBAL_VALUE_RE.test(code),
        `${shown} no longer trips DOM_GLOBAL_VALUE_RE; drop the stale exemption`,
      ).toBe(true);
    }
  });

  // Regression for the purity-guard gap: DOM_GLOBAL_RE above only matches member
  // access (window.x), so a pure core probing localStorage in VALUE position
  // (`typeof localStorage !== 'undefined' ? localStorage : null`) was entirely
  // invisible to it. party_collapse.ts and guild_hide_offline.ts each used to
  // duplicate exactly that idiom; the fix moves it into the one shared module
  // allowed to use it (src/ui/safe_local_storage.ts) and adds DOM_GLOBAL_VALUE_RE
  // to catch a future regression of the same shape. This pins the two ORIGINAL
  // files clean of the raw idiom using the real production regex, not a copy.
  it('party_collapse.ts / guild_hide_offline.ts no longer carry the raw value-position localStorage probe', () => {
    const files = [
      join(repoRoot, 'src/ui/party_collapse.ts'),
      join(repoRoot, 'src/ui/guild_hide_offline.ts'),
    ];
    const violations = scanLines(files, DOM_GLOBAL_VALUE_RE);
    expect(
      violations,
      `these pure cores must import safeLocalStorage from src/ui/safe_local_storage.ts rather than duplicating the value-position probe:\n${violations.join('\n')}`,
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

  it('DOM_GLOBAL_VALUE_RE matches the value-position idiom (typeof/instanceof/direct-assign) and rejects benign lookalikes', () => {
    for (const positive of [
      "typeof localStorage !== 'undefined' ? localStorage : null",
      "typeof window === 'undefined'",
      'const s = localStorage;',
      'return sessionStorage;',
      'callback(document)',
      'x instanceof Storage',
      'y instanceof Window',
    ]) {
      expect(DOM_GLOBAL_VALUE_RE.test(positive), positive).toBe(true);
    }
    for (const negative of [
      'const windowless = computeViewport();',
      "'Press M to close the map window. Then click the marker.',",
      'const typeofWindow = probe();',
      'this.documentTitle = t;',
      'const storageQuota = 5;',
    ]) {
      expect(DOM_GLOBAL_VALUE_RE.test(negative), negative).toBe(false);
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

// Pure re-derivation of "the registered cores whose name is bare (not _view/_core)"
// from a pair of pure-core arrays. Factored into a function (rather than inlined in
// the `it()` below) so the regression test further down can run the EXACT same
// derivation against a mutated copy of the real arrays instead of hand-duplicating
// the logic, which would risk the two silently drifting apart.
function deriveBareNamedCores(uiCores: string[], renderCores: string[]): string[] {
  const viewOrCoreRe = /_(?:view|core)\.ts$/;
  return [
    ...new Set(
      [...uiCores, ...renderCores]
        .filter((f) => !viewOrCoreRe.test(f))
        .map((f) => posixRel(relative(repoRoot, f))),
    ),
  ].sort();
}

// Independent, hand-maintained pin for the BARE_NAMED forward-completeness check
// below. Deliberately NOT derived from UI_PURE_CORES / RENDER_PURE_CORES (the arrays
// deriveBareNamedCores() above already cross-references): a synchronized two-list
// delete (the same bare-named path removed from BOTH its purity allowlist AND
// BARE_NAMED in the same edit) keeps the derived check green, because derivedBare is
// computed FROM the very arrays the delete just shrank, so both sides lose the same
// entry and the equality holds despite the module silently dropping out of every
// purity scan. This literal array is the third, independent pin: extend it BY HAND
// in the same change that adds, renames, or removes a bare-named core from either
// allowlist, so a synchronized delete leaves BARE_NAMED disagreeing with THIS list
// instead of only agreeing with itself.
const EXPECTED_BARE_NAMED = [
  'src/game/presentation_gate.ts',
  'src/game/stale_chrome_focus.ts',
  'src/game/ui_effects_profile.ts',
  'src/game/ui_tier_knobs.ts',
  'src/render/cast_bar.ts',
  'src/render/compile_gate.ts',
  'src/render/foliage_lod.ts',
  'src/render/frame_present.ts',
  'src/render/interior_encounter_prewarm.ts',
  'src/render/link_rate_budget.ts',
  'src/render/preview_prewarm_lane.ts',
  'src/render/prewarm_compile_lifecycle.ts',
  'src/render/prewarm_pass.ts',
  'src/render/prewarm_policy.ts',
  'src/render/prewarm_resume.ts',
  'src/render/self_motion_rift_lift.ts',
  'src/ui/absorb_bar.ts',
  'src/ui/bag_filter.ts',
  'src/ui/bag_item_context_menu.ts',
  'src/ui/bank_filter.ts',
  'src/ui/banner_queue.ts',
  'src/ui/charter_fit_memory.ts',
  'src/ui/chat_bubble_style.ts',
  'src/ui/claudium_purchase_bridge.ts',
  'src/ui/clock.ts',
  'src/ui/compass.ts',
  'src/ui/coords.ts',
  'src/ui/duration_text.ts',
  'src/ui/fct_event.ts',
  'src/ui/focus_order.ts',
  'src/ui/gather_tool_tooltip.ts',
  'src/ui/guild_hide_offline.ts',
  'src/ui/guild_motd_login.ts',
  'src/ui/guild_tag.ts',
  'src/ui/hud/delve/delve_map.ts',
  'src/ui/hud/quest/quest_tracker.ts',
  'src/ui/hud_frames.ts',
  'src/ui/item_instance_glyph_mark.ts',
  'src/ui/item_kind_label.ts',
  'src/ui/item_name_color.ts',
  'src/ui/item_slot_labels.ts',
  'src/ui/known_item.ts',
  'src/ui/live_region_politeness.ts',
  'src/ui/log_event_route.ts',
  'src/ui/low_health.ts',
  'src/ui/low_resource.ts',
  'src/ui/map_gather_tip_memo.ts',
  'src/ui/market_armor_badge.ts',
  'src/ui/market_name_color.ts',
  'src/ui/minimap_markers.ts',
  'src/ui/mob_idle_sfx.ts',
  'src/ui/mobile_hud_layout.ts',
  'src/ui/party_collapse.ts',
  'src/ui/party_frames.ts',
  'src/ui/pet_action_icons.ts',
  'src/ui/purchase_intent_record.ts',
  'src/ui/quality_glow.ts',
  'src/ui/quest_marker_tags.ts',
  'src/ui/reliquary_cell_art.ts',
  'src/ui/rest_indicator.ts',
  'src/ui/roving_index.ts',
  'src/ui/safe_local_storage.ts',
  'src/ui/store_purchase_intent.ts',
  'src/ui/swing_timer.ts',
  'src/ui/target_frame_pos.ts',
  'src/ui/terms_link.ts',
  'src/ui/tool_effect_tooltip.ts',
  'src/ui/unit_frame.ts',
  'src/ui/unit_portrait.ts',
  'src/ui/usd_text.ts',
  'src/ui/wallet_bridge_reason_text.ts',
  'src/ui/woc_balance_chip.ts',
  'src/ui/woc_log_tones.ts',
  'src/ui/woc_market_activity_html.ts',
  'src/ui/woc_market_chrome.ts',
  'src/ui/woc_market_reason_text.ts',
  'src/ui/woc_tokens_text.ts',
  'src/ui/xp_bar.ts',
];

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
    const derivedBare = deriveBareNamedCores(UI_PURE_CORES, RENDER_PURE_CORES);
    const bareNamedRel = [
      ...new Set(BARE_NAMED.map((f) => posixRel(relative(repoRoot, f)))),
    ].sort();
    expect(
      derivedBare,
      'BARE_NAMED must equal the registered cores whose name is bare (not _view/_core)',
    ).toEqual(bareNamedRel);

    // Independent third pin (not derived from the arrays above): catches a
    // synchronized delete that the derived check just above cannot (see
    // EXPECTED_BARE_NAMED's own comment). Extend EXPECTED_BARE_NAMED by hand
    // whenever a bare-named core is added, renamed, or removed.
    expect(
      bareNamedRel,
      `BARE_NAMED must equal the hand-maintained EXPECTED_BARE_NAMED pin (update BOTH together):\n${bareNamedRel.join('\n')}`,
    ).toEqual(EXPECTED_BARE_NAMED);
  });

  // Regression: the derived-completeness check above re-derives its expected list
  // FROM UI_PURE_CORES / RENDER_PURE_CORES, the very arrays a delete would shrink.
  // A synchronized two-list delete (the same bare-named path removed from BOTH its
  // purity allowlist AND BARE_NAMED in one edit) keeps that check green, because
  // both sides lose the same entry together, while the module silently drops out of
  // every purity scan (it is bare-named, so onDiskCores()'s *_view/*_core sweep
  // cannot see it either). EXPECTED_BARE_NAMED is hand-maintained and independent of
  // the arrays under test, so it disagrees with BARE_NAMED after the same mutation.
  it('the independent EXPECTED_BARE_NAMED pin catches a synchronized delete the derived check misses', () => {
    const target = join(repoRoot, 'src/ui/party_collapse.ts');
    const mutatedUiCores = UI_PURE_CORES.filter((f) => f !== target);
    const mutatedBareNamed = BARE_NAMED.filter((f) => f !== target);

    const derivedBare = deriveBareNamedCores(mutatedUiCores, RENDER_PURE_CORES);
    const mutatedBareNamedRel = [
      ...new Set(mutatedBareNamed.map((f) => posixRel(relative(repoRoot, f)))),
    ].sort();
    // The OLD derived check: still green after the synchronized delete (the gap).
    expect(derivedBare).toEqual(mutatedBareNamedRel);
    // The NEW independent pin: red, because EXPECTED_BARE_NAMED still lists
    // party_collapse.ts and the mutated BARE_NAMED no longer does.
    expect(mutatedBareNamedRel).not.toEqual(EXPECTED_BARE_NAMED);
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
// (DOM_GLOBAL_RE itself is deliberately left alone here too: the src/ui pure-core
// scan above layers its own narrower value-position sibling, DOM_GLOBAL_VALUE_RE,
// on top of it instead, scoped to that one file family and allowlisting only
// src/ui/safe_local_storage.ts, the shared `typeof localStorage` feature-detect
// guild_hide_offline.ts and party_collapse.ts both used to duplicate. Widening
// DOM_GLOBAL_RE itself would still touch sim/world_api/render, which have no
// instance of this idiom today and stay out of scope for this fix.)
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
// `typeof window !== 'undefined'`, `(window as X).y`, and ternary value arms such
// as `enabled ? window : fallback`. Anchored on a code delimiter at BOTH ends so
// prose ("close the window, then click") cannot match, and the open brace refuses
// a `${...}` interpolation so a template variable named `window` (talent_i18n has
// one) is not mistaken for the global.
const UI_HOST_VALUE_RE = new RegExp(
  `typeof\\s+(?:${UI_HOST_GLOBALS})\\b|\\?\\s*(?:${UI_HOST_GLOBALS})\\s*:|(?:[=(,?!\\[]|(?<!\\$)\\{|=>|\\.\\.\\.|\\breturn)\\s*(?:${UI_HOST_GLOBALS})\\s*(?:[),;!=}\\]]|\\s+as\\b|$)`,
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
      `typeof\\s+(?:${HELPER_HOST_GLOBALS})\\b|\\?\\s*(?:${HELPER_HOST_GLOBALS})\\s*:|(?:[=(,?!\\[]|(?<!\\$)\\{|=>|\\.\\.\\.|\\breturn)\\s*(?:${HELPER_HOST_GLOBALS})\\s*(?:[),;!=}\\]]|\\s+as\\b|$)`,
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
// percentile_tier, discord_tier, curator_sigil, perf_overlay_model all bake
// theirs on purpose).
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
const UI_PAINTER_HELPERS = [
  'src/ui/continent_land_mask.ts',
  'src/ui/text_sprite_cache.ts',
  // Detached tt-desc / tt-sub line mint (createElement + textContent only).
  'src/ui/tooltip_line.ts',
].map((rel) => join(repoRoot, rel));

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
  'src/ui/account_portal_dom.ts',
  'src/ui/appearance_customizer.ts',
  'src/ui/arena_window.ts',
  'src/ui/armory_inspect.ts',
  'src/ui/bag_item_action_menu.ts',
  'src/ui/bags_window.ts',
  'src/ui/bank_buy_prompt.ts',
  'src/ui/bank_quantity_prompt.ts',
  'src/ui/bank_status_line.ts',
  'src/ui/bank_window.ts',
  'src/ui/breath_bar.ts',
  'src/ui/calendar_window.ts',
  'src/ui/hud/action_bar/bar_editor/bar_editor_window.ts',
  'src/ui/hud/action_bar/consumable_seat_controller.ts',
  'src/ui/hud/action_bar/mobile_action_ring_controller.ts',
  'src/ui/hud/action_bar/radial_gesture_controller.ts',
  'src/ui/hud/menu/menu_control_controller.ts',
  'src/ui/hud/stance/stance_bar_controller.ts',
  'src/ui/hud/stance/stance_control_controller.ts',
  'src/ui/hud/tap_menu.ts',
  'src/ui/hud/strip_gesture_controller.ts',
  'src/ui/hud/quest/quest_strip_controller.ts',
  'src/ui/hud/quest/quest_strip_gesture_controller.ts',
  'src/ui/hud/cross_hotbar/cross_hotbar_controller.ts',
  'src/ui/char_skin_window.ts',
  'src/ui/char_window.ts',
  'src/ui/charselect_news.ts',
  'src/ui/charselect_redesign.ts',
  'src/ui/chat_command_menu.ts',
  'src/ui/claudium_window.ts',
  'src/ui/continent_art.ts',
  'src/ui/crafting_window.ts',
  'src/ui/commission_order_window.ts',
  // The spin celebration's live element: created, listened to, mounted on
  // document.body and torn down (Bank Storage phase 17). Its markup and geometry
  // are in the pure src/ui/daily_rewards_spin_view.ts. Named `_controller` so the
  // painter gate's filename sweep keeps the cold contract this code held while it
  // lived in the window, WITHOUT the stricter facet-routed contract a `_painter`
  // carries or the by-name sweep that would drop this very row. The double
  // coverage is the deliberate one this file's own header describes.
  'src/ui/daily_rewards_spin_controller.ts',
  'src/ui/daily_rewards_window.ts',
  'src/ui/deeds_window.ts',
  'src/ui/desktop_update_toast.ts',
  'src/ui/dev_command_window.ts',
  'src/ui/dialog_key_activation.ts',
  'src/ui/discord_widget.ts',
  'src/ui/entry_guard_banner.ts',
  'src/ui/epic_link.ts',
  'src/ui/focus_manager.ts',
  'src/ui/focus_restore.ts',
  'src/ui/form_draft.ts',
  'src/ui/gather_node_tooltip_controller.ts',
  'src/ui/gpu_notice_toast.ts',
  'src/ui/guild_bank_log_window.ts',
  'src/ui/guild_bank_window.ts',
  'src/ui/hud.ts',
  'src/ui/hud/action_bar/action_bar_toggle_controller.ts',
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
  'src/ui/hud/vendor/buy_quantity_prompt_window.ts',
  'src/ui/hud/vendor/heroic_vendor_window.ts',
  'src/ui/hud/vendor/crucible_vendor_window.ts',
  'src/ui/hud/vendor/train_window.ts',
  'src/ui/hud/vendor/unbind_window.ts',
  'src/ui/hud/vendor/vendor_window.ts',
  'src/ui/hud/vendor/warfare_vendor_window.ts',
  'src/ui/hud/woc_trade/woc_trade_controller.ts',
  'src/ui/i18n.ts',
  'src/ui/icon_prewarm.ts',
  'src/ui/icon_prewarm_worker.ts',
  'src/ui/icons.ts',
  'src/ui/inspect_window.ts',
  'src/ui/interface_unlock.ts',
  'src/ui/settings_transfer.ts',
  'src/ui/item_drop_hit_test.ts',
  'src/ui/loading_backdrop.ts',
  'src/ui/loading_slow_hint.ts',
  'src/ui/loading_tips.ts',
  'src/ui/mailbox_window.ts',
  'src/ui/map_art.ts',
  'src/ui/map_bg.ts',
  'src/ui/map_marker_icon_loader.ts',
  'src/ui/map_marker_palette_lifecycle.ts',
  'src/ui/market_window.ts',
  'src/ui/woc_market_window.ts',
  'src/ui/meters.ts',
  'src/ui/meters_frame.ts',
  'src/ui/minimap_gilded_ornament.ts',
  'src/ui/mobile_wallet_launcher.ts',
  'src/ui/wallet_reauth_prompt.ts',
  'src/ui/wallet_verify_request.ts',
  'src/ui/mount_race_controls.ts',
  'src/ui/mount_race_strip.ts',
  'src/ui/aura_overlay_config.ts',
  'src/ui/aura_overlay_controller.ts',
  'src/ui/aura_overlay_settings.ts',
  'src/ui/movable_frame.ts',
  'src/ui/native_update_prompt.ts',
  'src/ui/noticeboard_popup.ts',
  'src/ui/options_window.ts',
  'src/ui/ota_update_overlay.ts',
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
  'src/ui/preview_stand_in.ts',
  'src/ui/prompt_dialog.ts',
  'src/ui/tutorial_greeting_window.ts',
  // professions_window.ts is BACK on the ledger: the focus_restore move left
  // it host-free for a while, but armSentGuard's one-shot re-arm timer is a
  // real host reach, now spelled window.setTimeout so this sweep can see it
  // (a bare setTimeout sat in the sweep's blind spot, the whole-branch
  // review's note).
  'src/ui/professions_window.ts',
  'src/ui/raid_boss_guide_window.ts',
  'src/ui/raid_boss_guide_model_controller.ts',
  // The binder that gives a purchase-intent ledger a durable half. It reaches
  // localStorage (through the safe_local_storage seam, the one sanctioned door)
  // and the clock, which is precisely why it is not in the pure record core it
  // wraps: the age bound has to be injectable or it cannot be tested, and a
  // clock inside a registered core would break the scan the ledger's whole
  // testability rests on. Its sibling src/ui/purchase_intent_key.ts is listed
  // here too, for the same reason on the other half of the split.
  'src/ui/purchase_intent_durability.ts',
  // The ONE Claudium idempotency-key minter. It reaches globalThis.crypto and,
  // on the fallback arm, the clock and an rng, which is exactly why it is NOT
  // in store_purchase_intent.ts: that ledger is a pure core whose determinism
  // scan is what lets a caller inject a minter and test it deterministically.
  'src/ui/purchase_intent_key.ts',
  'src/ui/reconnect_overlay.ts',
  // reliquary_window.ts joined the ledger with the HUD-tracker pin store: the
  // pinned page set persists per character in localStorage (the deeds_window
  // watchlist shape), which is browser state this module owns.
  'src/ui/reliquary_window.ts',
  'src/ui/settings_controls.ts',
  'src/ui/social_window.ts',
  'src/ui/spectate_badge.ts',
  'src/ui/spellbook_window.ts',
  'src/ui/start_skin_picker_portraits.ts',
  'src/ui/steam_link.ts',
  'src/ui/steam_wishlist.ts',
  'src/ui/store_decision_prompt.ts',
  'src/ui/store_stack_diag.ts',
  'src/ui/swing_timer_bars.ts',
  'src/ui/talents_window.ts',
  'src/ui/target_auras_window.ts',
  // target_swing_timer_bars.ts mirrors swing_timer_bars.ts's own reach: it
  // resolves the #swingbar-target/#swingbar-tot elements via document.querySelector
  // once in its constructor, the same DOM-owning shape as its sibling above.
  'src/ui/target_swing_timer_bars.ts',
  'src/ui/theme.ts',
  'src/ui/touch_item_drag.ts',
  'src/ui/touch_tap.ts',
  'src/ui/town_focus_window.ts',
  // The tracker-stack seat applier: owns a resize listener and bounded
  // getBoundingClientRect reads by design (the module comment carries the
  // cadence contract); the seat math itself is the tracker_stack_anchor_core
  // pure core.
  'src/ui/tracker_stack_anchor.ts',
  'src/ui/tutorial.ts',
  'src/ui/bootcamp.ts',
  'src/ui/ui_effects_applier.ts',
  'src/ui/ui_icons.ts',
  'src/ui/ui_scale.ts',
  'src/ui/vault_window.ts',
  'src/ui/wiki_link.ts',
  'src/ui/window_drag.ts',
  'src/ui/window_resize.ts',
  'src/ui/woc_market_link.ts',
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
      'const host = enabled ? window : fallback;',
      'const doc = enabled ? document : fallback;',
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
    expect(HELPER_HOST_PATTERNS[1][1].test('const host = enabled ? window : fallback;')).toBe(true);
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

// Shipping source (src/ and server/) must stay free of raw C0 control bytes.
// This is not style: a single NUL makes the whole file BINARY to the grep-family
// tools the repo's own sweeps are built on, and they fail SILENTLY. On this
// machine `grep` is ugrep, which skips a binary file outright: before the Bank
// Storage phase 11 QA fix, `grep -c export server/storage_purchases.ts` printed
// nothing and exited 1 while `grep --binary-files=text` found ten, so the
// phase's largest money-path module read as an EMPTY file to every source sweep.
// tests/ is deliberately exempt: a test legitimately embeds a control byte as
// INPUT (appearance_wire_bounds pins one inside a name, enchant_apply_view builds
// a NUL-separated composite key, glb_assets feeds a sanitizer), and those files
// are not what a source sweep is trying to read.
const CONTROL_BYTE_ROOTS = ['src', 'server'] as const;

/** Index of the first raw C0 control byte (or DEL), else -1. A codepoint scan
 *  rather than a regex on purpose: a regex literal holding control characters
 *  is itself a biome error (noControlCharactersInRegex), and a character class
 *  is easy to widen or invert by accident, whereas this predicate is directly
 *  unit-testable. Tab and newline are the only legal ones; carriage return is
 *  banned with the rest because this repo is LF-only, so a CR here is
 *  corruption too. */
function firstControlByteIndex(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x09 || code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f) return i;
  }
  return -1;
}

describe('shipping source carries no raw control bytes', () => {
  const files = CONTROL_BYTE_ROOTS.flatMap((root) => walk(join(repoRoot, root)));

  it('finds both shipping source trees', () => {
    expect(files.length).toBeGreaterThan(400);
  });

  it('has no control byte in any src/ or server/ TypeScript file', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const at = firstControlByteIndex(text);
      if (at === -1) continue;
      const line = text.slice(0, at).split('\n').length;
      const code = text.charCodeAt(at).toString(16).padStart(4, '0');
      offenders.push(`${file.slice(repoRoot.length)}:${line} carries U+${code.toUpperCase()}`);
    }
    expect(
      offenders,
      'A raw control byte makes the file binary to grep, so every source sweep ' +
        'silently skips it. Write the character as an escape in a string literal ' +
        `instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the ban FIRES on every control byte and spares tab, newline, and real text', () => {
    // Mutation-proof for the predicate itself: the sweep above is only as strong
    // as this scan, and an off-by-one in either bound would silently disarm it.
    const nul = String.fromCharCode(0);
    const del = String.fromCharCode(0x7f);
    const esc = String.fromCharCode(0x1b);
    // The exact regression this guard was written for.
    expect(firstControlByteIndex(`const K = '${nul}recovery-scan';`)).toBe(11);
    expect(firstControlByteIndex(del)).toBe(0);
    expect(firstControlByteIndex(esc)).toBe(0);
    expect(firstControlByteIndex(String.fromCharCode(0x0d))).toBe(0);
    // Both edges of the legal window, so neither bound can drift.
    expect(firstControlByteIndex(String.fromCharCode(0x08))).toBe(0);
    expect(firstControlByteIndex(String.fromCharCode(0x0b))).toBe(0);
    expect(firstControlByteIndex(String.fromCharCode(0x1f))).toBe(0);
    expect(firstControlByteIndex(String.fromCharCode(0x20))).toBe(-1);
    expect(firstControlByteIndex(String.fromCharCode(0x7e))).toBe(-1);
    // Tab and newline stay legal, and the shipped fix uses a real SPACE.
    expect(firstControlByteIndex('\t')).toBe(-1);
    expect(firstControlByteIndex('\n')).toBe(-1);
    expect(firstControlByteIndex(`const K = ' recovery-scan';`)).toBe(-1);
    // The escaped SPELLING of a control byte stays legal: only the raw byte is
    // banned, so a module that genuinely needs one can still express it.
    expect(firstControlByteIndex(`const sep = '\\u0000';`)).toBe(-1);
    // It reports the FIRST offender, not merely "some", so the message locates it.
    expect(firstControlByteIndex(`ab${del}c${nul}`)).toBe(2);
  });
});
