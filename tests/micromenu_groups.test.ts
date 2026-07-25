// Structure guard for the micro-menu's positional sections (#side-buttons).
// The rail is a flat run of ~20 launchers; it is now split into .micro-group
// sections separated by a keyline so finding one entry is a scan of a small
// block. Three things can silently break that and none were pinned before:
//   1. The markup is DUPLICATED in index.html and play.html. Editing one alone
//      ships a grouped rail offline and a flat one at /play, which is exactly
//      the drift tests/entry_window_parity.test.ts does not catch (it scans
//      `.window panel` divs only, never the rail).
//   2. A section whose every entry is hidden (#mm-town-focus out of town,
//      #mm-discord on a non-Discord build, the lone daily chest whenever the
//      showDailyRewardsChest setting is off) must collapse AND take its
//      keyline with it. display:none does not remove it from the sibling
//      chain, so the obvious adjacent-sibling divider still rules the next
//      surviving section against nothing.
//   3. The sections are wrappers around buttons the HUD finds by id. A button
//      dropped or renamed during a regroup would leave a dead $('#mm-...').
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

const hudCss = read('../src/styles/hud.css');
const hudMobileCss = read('../src/styles/hud.mobile.css');
const hudTs = read('../src/ui/hud.ts');
const ENTRIES = [
  ['index.html', read('../index.html')],
  ['play.html', read('../play.html')],
] as const;

// The design, as authored: section order per column, and member order inside
// each section. Literal ids, not derived from the markup, so a reorder or a
// dropped launcher fails here instead of re-deriving itself into a pass.
const COL_A_SECTIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['you', ['mm-char', 'mm-spell', 'mm-talents', 'mm-deeds', 'mm-professions']],
  ['world', ['mm-quest', 'mm-map', 'mm-town-focus']],
  ['stuff', ['mm-bag', 'mm-crafting']],
];
const COL_B_SECTIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['rewards', ['daily-rewards-button']],
  ['activities', ['mm-arena', 'mm-dfinder', 'mm-valecup', 'mm-cardduel', 'mm-leaderboard']],
  ['people', ['mm-social', 'mm-discord', 'mm-emote']],
  ['system', ['mm-music', 'mm-options']],
];

function railMarkup(html: string): string {
  const start = html.indexOf('<div id="side-buttons">');
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  const token = /<div\b|<\/div>/g;
  token.lastIndex = start;
  for (let m = token.exec(html); m; m = token.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error('unterminated #side-buttons wrapper');
}

// Sections of one column, as [groupName, memberIds] in document order.
function sectionsOf(html: string, colId: string): Array<[string, string[]]> {
  const rail = railMarkup(html);
  const start = rail.indexOf(`id="${colId}"`);
  expect(start, colId).toBeGreaterThan(-1);
  const otherCol = colId.endsWith('-a') ? 'side-buttons-col-b' : 'side-buttons-col-a';
  const otherStart = rail.indexOf(`id="${otherCol}"`);
  const column = rail.slice(start, otherStart > start ? otherStart : rail.length);

  // Attribute-order independent (the group name is read from anywhere in the
  // opening tag) and body-shape independent (everything up to the matching
  // close, so a section that ever wraps a nested element still parses).
  return [...column.matchAll(/<div class="micro-group"([^>]*)>([\s\S]*?)\n\s*<\/div>/g)].map(
    (m) => {
      const name = /\bdata-group="([a-z]+)"/.exec(m[1])?.[1] ?? '';
      const ids = [...m[2].matchAll(/<button[^>]*\bid="([^"]+)"/g)].map((b) => b[1]);
      return [name, ids] as [string, string[]];
    },
  );
}

describe('micro-menu sections: markup, in BOTH game entries', () => {
  for (const [name, html] of ENTRIES) {
    it(`groups col-a into you / world / stuff in ${name}`, () => {
      expect(sectionsOf(html, 'side-buttons-col-a')).toEqual(
        COL_A_SECTIONS.map(([g, ids]) => [g, [...ids]]),
      );
    });

    it(`groups col-b into rewards / activities / people / system in ${name}`, () => {
      expect(sectionsOf(html, 'side-buttons-col-b')).toEqual(
        COL_B_SECTIONS.map(([g, ids]) => [g, [...ids]]),
      );
    });

    it(`leaves no rail button outside a section in ${name}`, () => {
      const rail = railMarkup(html);
      const allIds = [...rail.matchAll(/<button[^>]*\bid="([^"]+)"/g)].map((m) => m[1]).sort();
      const grouped = [...COL_A_SECTIONS, ...COL_B_SECTIONS].flatMap(([, ids]) => [...ids]).sort();
      // Set equality both ways: a launcher that escaped its wrapper (or a new
      // one nobody assigned a section) shows up as a difference here.
      expect(allIds).toEqual(grouped);
    });
  }

  it('ships the identical section structure in both entries', () => {
    const structure = (html: string) =>
      JSON.stringify([
        sectionsOf(html, 'side-buttons-col-a'),
        sectionsOf(html, 'side-buttons-col-b'),
      ]);
    expect(structure(ENTRIES[0][1])).toBe(structure(ENTRIES[1][1]));
  });
});

describe('micro-menu sections: the keyline and its hidden-section rule', () => {
  const block = (selector: string): string => {
    const match = new RegExp(`\\n  ${selector.replace(/[+.*()[\]]/g, '\\$&')} \\{([^}]*)\\}`).exec(
      hudCss,
    );
    if (!match) throw new Error(`missing "${selector}" rule in src/styles/hud.css`);
    return match[1];
  };

  // These are SOURCE pins: they prove the rules are written, never that they
  // match anything. The rendered behavior (which is what actually regressed
  // once, via an invalid nested :has) is asserted against a real engine in
  // tests/browser/micromenu_groups.browser.test.ts.
  const DIVIDER_RULE = /\n {2}\.micro-group \+ \.micro-group \{([^}]*)\}/;
  // Quote-agnostic: biome normalizes CSS attribute selectors to double quotes,
  // so pinning one form makes the test a formatting hostage.
  const NEUTRALIZER_RULE =
    /\.micro-group\[data-group=["']rewards["']\]:not\(:has\(> :not\(\[hidden\]\)\)\) \+ \.micro-group \{([^}]*)\}/;

  it('draws the divider in the shared showcase keyline token, no new color', () => {
    const rule = DIVIDER_RULE.exec(hudCss)?.[1];
    expect(rule, 'missing the section-divider rule in src/styles/hud.css').toBeTruthy();
    expect(rule).toMatch(/border-top:\s*1px solid var\(--color-border-showcase\)/);
    // A border on `.micro-group` itself would rule every section, including
    // the first one in a column.
    expect(block('.micro-group')).not.toMatch(/border/);
    // The token has to exist upstream in tokens.css rather than be invented here.
    expect(read('../src/styles/tokens.css')).toMatch(/--color-border-showcase:\s*#[0-9a-f]{6};/);
  });

  it('stacks the divider perpendicular to the column axis', () => {
    // The columns stack vertically (.side-buttons-col { flex-direction: column }),
    // so the divider must be a horizontal rule, never an inline one.
    expect(block('.side-buttons-col')).toMatch(/flex-direction:\s*column/);
    expect(block('.micro-group')).toMatch(/flex-direction:\s*column/);
    const rule = DIVIDER_RULE.exec(hudCss)?.[1] ?? '';
    expect(rule).toMatch(/border-top:/);
    expect(rule).not.toMatch(/border-(left|right|bottom):/);
  });

  it('collapses a section that has nothing visible left in it', () => {
    // Structural, not per-button. Without this a section whose entries are all
    // hidden is still a zero-height flex item, so the column gap reserves dead
    // space on both sides of nothing.
    expect(hudCss).toMatch(/\.micro-group:not\(:has\(> :not\(\[hidden\]\)\)\) \{\s*display: none;/);
  });

  it('drops the keyline off the section below the one that can collapse', () => {
    // display:none does NOT remove a collapsed section from the sibling chain,
    // so `.micro-group + .micro-group` still matches the first SURVIVING
    // section and would rule it against nothing. Live, not hypothetical: the
    // rewards section is a lone #daily-rewards-button that the
    // showDailyRewardsChest setting hides, and it is first in its column.
    const rule = NEUTRALIZER_RULE.exec(hudCss)?.[1];
    expect(rule, 'missing the collapsed-section keyline neutralizer').toBeTruthy();
    expect(rule).toMatch(/border-top:\s*0;/);
    // Zeroed together: leaving the margin or padding behind keeps the dead
    // space even once the rule itself is gone.
    expect(rule).toMatch(/margin-top:\s*0;/);
    expect(rule).toMatch(/padding-top:\s*0;/);
  });

  it('leaves every other section incapable of collapsing, which is what makes one neutralizer enough', () => {
    // The neutralizer is deliberately scoped to `rewards` rather than written
    // as a general "after any collapsed section" rule, because a general rule
    // would ALSO strip the keyline off the section following a collapsed
    // MIDDLE section, which should keep it. That scoping is only sound while
    // rewards is the sole section that can empty. Pin exactly that: every
    // other section must hold at least one entry the HUD never hides, so a
    // future all-conditional section fails here until it gets its own
    // neutralizer (or the rule is generalized).
    const CONDITIONAL = new Set(['mm-town-focus', 'mm-discord', 'daily-rewards-button']);
    const neutralized = new Set(['rewards']);
    for (const [group, ids] of [...COL_A_SECTIONS, ...COL_B_SECTIONS]) {
      if (neutralized.has(group)) continue;
      expect(
        ids.some((id) => !CONDITIONAL.has(id)),
        `section "${group}" can empty but has no keyline neutralizer`,
      ).toBe(true);
    }
  });

  it('never nests :has() inside :has(), which drops the whole rule', () => {
    // The exact bug this suite was extended for: `:has()` inside `:has()` is
    // invalid per Selectors 4 and every shipping engine discards the entire
    // rule (verified in Chrome 150). The stylesheet still reads correctly and
    // every other source pin here still passes, while nothing paints.
    const railRules = hudCss.match(/^ {2}\.micro-group[^{]*\{/gm) ?? [];
    expect(railRules.length).toBeGreaterThan(2);
    for (const selector of railRules) {
      const outer = /:has\((.*)\)/s.exec(selector)?.[1] ?? '';
      expect(outer, `nested :has() in "${selector.trim()}" drops the rule`).not.toMatch(/:has\(/);
    }
  });

  it('keeps .micro-group free of anything that opens a stacking context', () => {
    // .micro-btn::before (the hover flyout) paints at z-index: -1 and has to
    // escape its column; a stacking context on the wrapper would trap it and
    // re-break the clipping #side-buttons-col-b's z-index exists to fix.
    // Both rules that target a section, not just the base one: a transform on
    // the divider rule would trap the flyout just as effectively.
    const rules: Array<[string, string]> = [
      ['.micro-group', block('.micro-group')],
      ['the section-divider rule', DIVIDER_RULE.exec(hudCss)?.[1] ?? ''],
      ['the keyline neutralizer', NEUTRALIZER_RULE.exec(hudCss)?.[1] ?? ''],
    ];
    for (const [where, rule] of rules) {
      for (const prop of ['position', 'z-index', 'opacity', 'transform', 'filter']) {
        expect(rule, `${where} must not declare ${prop}`).not.toMatch(
          new RegExp(`(?:^|[\\s;])${prop}\\s*:`),
        );
      }
      // Nor may it clip the flyout, which grows leftward out of the wrapper.
      expect(rule, `${where} must not clip`).not.toMatch(/overflow/);
    }
  });

  it('renders no sections on mobile, where the whole rail is hidden', () => {
    // The mobile decision, made explicitly rather than by fallthrough: the
    // rail itself is display:none under body.mobile-touch (the launchers live
    // in the More tray instead), so the grouping never reaches a phone and
    // needs no separate mobile treatment or tap-target accounting.
    expect(hudMobileCss).toMatch(/body\.mobile-touch #side-buttons \{\s*display: none;/);
  });
});

describe('micro-menu sections: the wrappers changed no wiring', () => {
  it('toggles the conditional launchers on the BUTTON, not on a wrapper', () => {
    // Both conditional entries drive their own `hidden`. Toggling a parent
    // instead would fight the section rule above (and hide its neighbours).
    expect(hudTs).toContain('if (townFocusBtn) townFocusBtn.hidden = !inTown;');
    expect(hudTs).not.toMatch(/townFocusBtn\.style\.display/);
    expect(read('../src/main.ts')).toContain('desktopBtn.hidden = !DISCORD_BUILD_ENABLED;');
    // The third conditional entry, and the one that makes the no-orphan rule
    // matter to ordinary players rather than only to a build flag: the chest
    // is the whole rewards section, and the showDailyRewardsChest SETTING
    // hides it. It has to use `hidden` like the other two, or its section
    // stays laid out and its keyline stays painted.
    expect(hudTs).toContain("button.toggleAttribute('hidden', !visible);");
    expect(hudTs).toContain("dailyRewardsButton?.setAttribute('hidden', '');");
    // No handler may reach for a section wrapper to show/hide a launcher:
    // the sections are presentation, and the HUD only ever touches buttons.
    expect(hudTs).not.toMatch(/(?:querySelector|querySelectorAll|closest|\$)\([^)]*micro-group/);
  });

  it('still resolves every micro-menu id hud.ts binds, in both entries', () => {
    const bound = [...hudTs.matchAll(/['"]#(mm-[a-z-]+)['"]/g)].map((m) => m[1]);
    expect(bound.length).toBeGreaterThan(10);
    for (const [name, html] of ENTRIES) {
      const rail = railMarkup(html);
      for (const id of new Set(bound)) {
        expect(rail, `${name} is missing ${id}, which hud.ts binds by id`).toContain(`id="${id}"`);
      }
    }
  });
});
