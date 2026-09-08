// The frames-unlock coverage guard: every STANDING HUD surface must be
// movable through one of the sanctioned mechanisms, or carry a written
// exemption here. This is the future-proofing half of the movable-frames
// feature: a NEW persistent HUD element added to either entry document (or a
// new module that mounts chrome on #ui) fails this suite until its author
// either registers a HUD_FRAME_SPECS row (src/ui/interface_unlock_core.ts,
// the default for standing chrome), classifies it as a .window (window_drag
// owns those), or records a reasoned exemption below. The classification is
// deliberately a table in this file, the MOBILE_WINDOW_EXCEPTIONS shape
// (tests/mobile_window_coverage.test.ts): the guard forces the QUESTION to be
// answered in the same change, never a particular answer.
//
// Harvest model: both entries wrap the HUD in <template id="game-ui-template">
// (the live DOM clones it at world entry), so the scrape slices that template,
// then depth-walks the #ui subtree collecting DIRECT children plus the direct
// children of the known layout CONTAINERS (the bottom bar cluster and the
// right tracker stack), which is where standing chrome lands. Transient nodes
// minted at runtime are held by the second gate instead: the exact-set pin of
// FILES allowed to reach the #ui root at all.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HUD_FRAME_SPECS } from '../src/ui/interface_unlock_core';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const HTML_ENTRIES = ['index.html', 'play.html'] as const;

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// HTML void elements (per spec); everything else, SVG children included,
// closes explicitly. Treating <path> as void desynchronizes the depth walk.
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

interface HarvestedChild {
  id: string;
  classes: string[];
  /** The raw inner slice, so a container's own children can be harvested. */
  inner: string;
}

/** The game-ui template's markup (comments stripped first, so a commented-out
 *  close tag cannot throw the depth count off: the entry_window_parity idiom). */
function gameUiTemplate(html: string): string {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const start = clean.indexOf('<template id="game-ui-template">');
  const end = clean.indexOf('</template>', start);
  if (start < 0 || end < 0) throw new Error('game-ui-template not found');
  return clean.slice(start, end);
}

/** Direct children of the element whose OPENING TAG starts at `openAt`. */
function directChildren(markup: string, openAt: number): HarvestedChild[] {
  const tagRe = /<(\/?)([a-z][a-z0-9-]*)([^>]*?)(\/?)>/gi;
  tagRe.lastIndex = openAt;
  const rootTag = tagRe.exec(markup);
  if (!rootTag || rootTag[1] === '/') throw new Error('directChildren must start at an open tag');
  const children: HarvestedChild[] = [];
  let depth = 1;
  let childOpen: { at: number; attrs: string; contentAt: number } | null = null;
  for (let m = tagRe.exec(markup); m; m = tagRe.exec(markup)) {
    const [whole, closing, tag, attrs, selfClose] = m;
    const voidTag = VOID_TAGS.has(tag.toLowerCase()) || selfClose === '/';
    if (closing === '/') {
      depth -= 1;
      if (depth === 0) break;
      if (depth === 1 && childOpen) {
        children.push(harvested(childOpen.attrs, markup.slice(childOpen.contentAt, m.index)));
        childOpen = null;
      }
      continue;
    }
    if (depth === 1) {
      if (voidTag) children.push(harvested(attrs, ''));
      else childOpen = { at: m.index, attrs, contentAt: m.index + whole.length };
    }
    if (!voidTag) depth += 1;
  }
  if (depth !== 0) throw new Error('unbalanced markup under the harvested root');
  return children;
}

function harvested(attrs: string, inner: string): HarvestedChild {
  const id = /\bid="([^"]+)"/.exec(attrs)?.[1] ?? '';
  const classes = (/\bclass="([^"]*)"/.exec(attrs)?.[1] ?? '').split(/\s+/).filter(Boolean);
  return { id, classes, inner };
}

/** Layout containers whose DIRECT children are standing chrome too; each is
 *  descended (and must itself never become a movable frame: it is a layout
 *  slot other frames dock into). */
const CONTAINERS: Record<string, string> = {
  'right-tracker-stack':
    'the anchored flex column the five trackers dock into; the trackers are the frames',
  'bottom-bar': 'the transformed bottom cluster wrapper; its contents are the frames',
  'actionbar-row': 'the flex row seating the action-bar stack and the meter panels',
  'actionbar-stack': 'the centered column of bars and the player frame',
  'pet-cluster': 'the one-row pet bar + pet frame pairing; both halves are frames',
  'aura-stack': 'the flex column seating the buff and debuff rows; the rows are the frames',
  'actionbar-group': 'the combined-bars block, itself the actionBarGroup frame content host',
};

/** Standing surfaces governed by a movement mechanism OTHER than the
 *  HUD_FRAME_SPECS registry. Each names its owner. */
const SELF_GOVERNED: Record<string, string> = {
  'player-frame': 'legacy unit-frame MovableFrame, registered with the unlock registry in Hud',
  'target-frame': 'legacy unit-frame MovableFrame, registered with the unlock registry in Hud',
  'party-frames': 'legacy unit-frame MovableFrame, registered with the unlock registry in Hud',
  'chatlog-wrap': 'the chat box: ChatGeometryController owns its drag, resize and persistence',
  'heal-window': 'pop-out meter window: its own MeterFrame owns drag, resize and persistence',
  'threat-window': 'pop-out meter window: its own MeterFrame owns drag, resize and persistence',
  'target-auras-window': 'the target aura panel: its own MeterFrame owns its geometry',
};

/** Everything standing-but-deliberately-NOT-movable, with the reason. A new
 *  entry here is a decision, not a default: prefer a HUD_FRAME_SPECS row. */
const FRAME_EXEMPT: Record<string, string> = {
  'combat-live': 'off-screen aria-live region, never visible chrome',
  'target-live': 'off-screen aria-live region, never visible chrome',
  'chat-live': 'off-screen aria-live region, never visible chrome',
  'crafting-live': 'off-screen aria-live region, never visible chrome',
  'perf-overlay': 'dev-only diagnostics readout with its own placing mode (perf_overlay.ts)',
  'click-move-marker': 'transient world-anchored click ping, positioned per click',
  'ctx-menu': 'transient right-click menu, positioned at the cursor per open',
  'prompt-stack': 'transient modal prompt host (prompt_dialog.ts), centered by design',
  'cross-hotbar': 'mobile cross-hotbar input cluster; frame editing is desktop-only',
  tooltip: 'hover tooltip, positioned at the cursor per hover',
  'error-msg': 'transient toast, pointer-inert',
  'quest-banner': 'transient quest accept/complete banner',
  banner: 'transient level-up and zone banner (banner_queue.ts)',
  'low-health-vignette': 'decorative full-screen veil, pointer-inert',
  'subzone-banner': 'transient subzone name fade',
  'death-overlay': 'death veil with the Release Spirit prompt, modal by design',
  'ghost-prompt': 'transient ghost-state prompt',
  'interact-affordance':
    'transient nearby-interaction press-to-act prompt (farm_press_affordance_controller.ts drives its .is-shown class); positioned near the reticle, never standing chrome',
  'mount-race-strip': 'event-scoped race timer strip, hidden outside a race',
  'race-start-btn': 'event-scoped race control, hidden outside a race',
  'race-countdown': 'event-scoped race countdown, hidden outside a race',
  'arena-status': 'match-scoped arena status strip, pointer-inert',
  'dfinder-proposal-popup': 'transient dungeon-finder proposal popup',
  'bg-proposal-popup': 'transient battleground proposal popup',
  'practice-tracker':
    'live DPS readout strip (src/ui/hud/practice/), read-only text: not yet promoted to a movable frame (pre-existing gap, not introduced by this change)',
  'hub-lesson-coach':
    'guided Meters coaching strip beside practice-tracker (src/ui/hud/practice/), read-only text plus its own small ack/replay buttons: same standing-tracker family, not yet promoted to a movable frame',
};

/** The FILES allowed to reach the #ui root (mount, re-home, or measure).
 *  An exact set on purpose: a NEW module that mounts chrome on #ui shows up
 *  here first, and the author decides whether the thing it mounts is a frame
 *  (register it and, if minted at runtime, list it in RUNTIME_MOUNTED_FRAME_IDS),
 *  self-governed, or transient (extend this table with the reason). */
const UI_ROOT_TOUCHERS: Record<string, string> = {
  'src/main.ts': 'mounts the breath bar (transient survival meter, exempt for now) into #ui',
  'src/ui/hud.ts': 'the HUD coordinator: mounts the proc overlay, FCT pool, match strips',
  'src/ui/interface_unlock.ts': 'the unlock coordinator: its own edit chrome + the detacher',
  'src/ui/meters_frame.ts': 're-homes framed meter panels onto #ui',
  'src/ui/bootcamp.ts': 'world-anchored tutorial prompts, transient coachmarks',
  'src/ui/tutorial.ts': 'transient tutorial coachmarks',
  'src/ui/noticeboard_popup.ts': 'transient noticeboard popup card',
  'src/ui/realm_builder_popup.ts': 'transient Realm Builder honour roll card',
  'src/ui/dev_command_window.ts': 'dev-only command window (a .window, window_drag governs it)',
  'src/ui/hud/professions/perfecting_window.ts':
    'the Perfecting window (a .window.panel, window_drag governs it), minted at runtime like dev_command_window.ts since no markup entry ships it',
  'src/ui/keyboard_map_window.ts':
    'the keyboard overview pop-out (a .window, window_drag governs it; closeManagedWindow closes it)',
  'src/ui/hud/fiesta/fiesta_controller.ts': 'match-scoped fiesta strips and confetti',
  'src/ui/hud/loot/loot_roll_controller.ts': 'transient loot roll stack',
  'src/ui/hud/practice/hub_lesson_controller.ts':
    'world-anchored "target the dummy" coachmark bubble, transient (the bootcamp.ts pattern)',
};

/** Registry frames whose elements are minted at runtime rather than written
 *  in the entry documents, so the HTML harvest cannot see them. */
const RUNTIME_MOUNTED_FRAME_IDS = ['proc-overlay', 'warlock-doom-frame'];

interface Harvest {
  ids: string[];
  /** Ids of the DIRECT #ui children only (the container interiors excluded),
   *  so the anti-vacuity floor can hold each harvest half separately. */
  directIds: string[];
  windows: Set<string>;
  /** class= strings of any id-less child, reported by a named test below
   *  (an expect() here would fire at collection time and take the whole
   *  suite down as one anonymous collection error). */
  anonymous: string[];
}

/** Every standing-chrome candidate in one entry: the #ui direct children plus
 *  the direct children of each known layout container, recursively. */
function harvestEntry(html: string): Harvest {
  const template = gameUiTemplate(html);
  const uiOpen = template.indexOf('<div id="ui"');
  if (uiOpen < 0) throw new Error('#ui not found in the game-ui template');
  const ids: string[] = [];
  const directIds: string[] = [];
  const windows = new Set<string>();
  const anonymous: string[] = [];
  const visit = (children: HarvestedChild[], direct: boolean) => {
    for (const child of children) {
      // A standing surface with no id cannot be classified, persisted, or
      // registered: give it one (the breath bar is the historical example).
      if (child.id === '') anonymous.push(child.classes.join(' ') || '(classless)');
      ids.push(child.id);
      if (direct) directIds.push(child.id);
      if (child.classes.includes('window') && child.classes.includes('panel')) {
        windows.add(child.id);
      }
      if (child.id in CONTAINERS) {
        const opened = `${child.inner}`;
        // Recurse over the container's own direct children. The container's
        // inner slice starts AFTER its opening tag, so wrap it in a
        // synthetic root for the walker.
        visit(directChildren(`<div>${opened}</div>`, 0), false);
      }
    }
  };
  visit(directChildren(template, uiOpen), true);
  return { ids, directIds, windows, anonymous };
}

describe('hud_frame_coverage (standing HUD surfaces are movable frames)', () => {
  // Lazily built and memoized so a harvest failure surfaces inside a NAMED
  // test rather than as a describe-scope collection error.
  let built: Array<{ entry: string; harvest: Harvest }> | null = null;
  const entries = () =>
    (built ??= HTML_ENTRIES.map((entry) => ({ entry, harvest: harvestEntry(read(entry)) })));
  const frameIds = new Set(HUD_FRAME_SPECS.map((s) => s.elementId));

  it('every element in the harvest carries an id', () => {
    for (const { entry, harvest } of entries()) {
      expect(harvest.anonymous, `${entry}: #ui-subtree element(s) with no id`).toEqual([]);
    }
  });

  it('classifies every standing surface in both entries', () => {
    for (const { entry, harvest } of entries()) {
      const unclassified = harvest.ids.filter(
        (id) =>
          !frameIds.has(id) &&
          !harvest.windows.has(id) &&
          !(id in CONTAINERS) &&
          !(id in SELF_GOVERNED) &&
          !(id in FRAME_EXEMPT),
      );
      expect(
        unclassified,
        `${entry}: new standing HUD surface(s) with no movability story. Register a ` +
          `HUD_FRAME_SPECS row (src/ui/interface_unlock_core.ts, the default), make it a ` +
          `.window.panel, or record a reasoned FRAME_EXEMPT / SELF_GOVERNED entry in this file.`,
      ).toEqual([]);
    }
  });

  it('the two entries carry the same standing-surface set', () => {
    const [index, play] = entries().map(({ harvest }) => new Set(harvest.ids));
    expect([...index].filter((id) => !play.has(id))).toEqual([]);
    expect([...play].filter((id) => !index.has(id))).toEqual([]);
  });

  it('harvests a full-size surface set in BOTH halves (anti-vacuity floors)', () => {
    // Held per half on purpose: a single total floor under the direct-child
    // count alone would stay green with the container recursion (where every
    // registered frame row of the 0.42 round lives) failing outright.
    for (const { entry, harvest } of entries()) {
      expect(harvest.directIds.length, `${entry}: direct #ui children`).toBeGreaterThanOrEqual(60);
      const containerIds = harvest.ids.length - harvest.directIds.length;
      expect(containerIds, `${entry}: container interiors`).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps the exemption and container tables honest', () => {
    const harvestedIds = new Set(entries().flatMap(({ harvest }) => harvest.ids));
    for (const [id, reason] of [
      ...Object.entries(FRAME_EXEMPT),
      ...Object.entries(SELF_GOVERNED),
      ...Object.entries(CONTAINERS),
    ]) {
      expect(harvestedIds.has(id), `stale table row: #${id} is no longer in either entry`).toBe(
        true,
      );
      expect(reason.length, `#${id} needs a real reason`).toBeGreaterThan(10);
    }
    // An id can hold only one classification, or the sweep order would decide.
    const tables = [FRAME_EXEMPT, SELF_GOVERNED, CONTAINERS].flatMap((t) => Object.keys(t));
    expect(new Set(tables).size).toBe(tables.length);
    // A registered frame must be findable: in the entries, or minted at
    // runtime by an allowlisted #ui toucher and listed as such.
    for (const spec of HUD_FRAME_SPECS) {
      const found =
        harvestedIds.has(spec.elementId) || RUNTIME_MOUNTED_FRAME_IDS.includes(spec.elementId);
      expect(found, `frame row '${spec.id}' points at unknown element #${spec.elementId}`).toBe(
        true,
      );
    }
  });

  it('pins the exact file set allowed to reach the #ui root', () => {
    // Runtime mounts are the harvest's blind spot, so the gate moves to the
    // module level: touching the #ui root at all is a classified act. The
    // alternation covers every spelling this tree could reach for (both
    // quote styles, getElementById, querySelector/querySelectorAll, and the
    // $ helper); a genuinely new spelling still needs adding here, so the
    // pin is exactly as wide as this regex, no wider.
    const uiRootRe =
      /getElementById\(\s*["']ui["']\s*\)|\$\(\s*["']#ui["']\s*\)|querySelector(?:All)?\(\s*["']#ui["']\s*\)/;
    const touchers = tsFilesUnder(fileURLToPath(new URL('../src', import.meta.url)))
      .filter((source) => uiRootRe.test(readFileSync(source.full, 'utf8')))
      .map((source) => `src/${source.file}`)
      .sort();
    expect(touchers).toEqual(Object.keys(UI_ROOT_TOUCHERS).sort());
    for (const [file, reason] of Object.entries(UI_ROOT_TOUCHERS)) {
      expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(10);
    }
  });

  it('every runtime-mounted frame id is really minted somewhere in src', () => {
    // RUNTIME_MOUNTED_FRAME_IDS is otherwise an unchecked escape hatch from
    // the harvest parity above: tie each id to the module that assigns it
    // (el.id = '<id>'), so a renamed or deleted mount fails here by name.
    const sources = tsFilesUnder(fileURLToPath(new URL('../src', import.meta.url)));
    for (const id of RUNTIME_MOUNTED_FRAME_IDS) {
      const assignRe = new RegExp(`id\\s*=\\s*'${id}'`);
      const minted = sources.some((source) => assignRe.test(readFileSync(source.full, 'utf8')));
      expect(minted, `runtime frame #${id} has no id assignment in src`).toBe(true);
    }
  });

  it('scans only through the shared walkers', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });
});

// The gathering-goal panel is the one persistent tracker whose OWN root relied
// on flex `gap` for its vertical rhythm (the sibling trackers' roots are not
// `display: flex` at all, so they need no equivalent rule). Wrapping its
// children in `#gathering-goal-body` (the `#qt-body` / `#delve-body` mover-
// chrome pattern, src/ui/CLAUDE.md) moved those children out of that flex
// context, so both halves of the fix get a literal, source-level pin here:
// the production markup really carries the wrapper (the painter's standalone
// fallback for a caller with no such child must never stand in as proof of
// that), and the CSS really re-declares the layout on it.
describe('gathering goal panel inner-body markup + spacing', () => {
  const GATHERING_GOAL_CSS = 'src/styles/hud.gathering-goal.css';

  /** The `<div id="gathering-goal-tracker">` root's direct children, via the
   *  same harvest primitives the frame sweep above uses. */
  function gatheringGoalTrackerChildren(html: string): HarvestedChild[] {
    const template = gameUiTemplate(html);
    const openAt = template.indexOf('<div id="gathering-goal-tracker"');
    if (openAt < 0) throw new Error('#gathering-goal-tracker not found in the game-ui template');
    return directChildren(template, openAt);
  }

  it("both entries mount #gathering-goal-body as the tracker root's only child", () => {
    for (const entry of HTML_ENTRIES) {
      const children = gatheringGoalTrackerChildren(read(entry));
      expect(
        children.map((c) => c.id),
        `${entry}: #gathering-goal-tracker children`,
      ).toEqual(['gathering-goal-body']);
    }
  });

  it("the CSS re-declares the panel's flex column + gap on #gathering-goal-body", () => {
    const css = readFileSync(new URL(`../${GATHERING_GOAL_CSS}`, import.meta.url), 'utf8');
    const bodyRule = /#gathering-goal-body\s*\{([^}]*)\}/.exec(css);
    expect(bodyRule, `${GATHERING_GOAL_CSS}: no #gathering-goal-body rule`).not.toBeNull();
    const decls = bodyRule![1];
    expect(decls, `${GATHERING_GOAL_CSS}: #gathering-goal-body declarations`).toMatch(
      /display:\s*flex;/,
    );
    expect(decls).toMatch(/flex-direction:\s*column;/);
    expect(decls).toMatch(/gap:\s*4px;/);
  });
});
