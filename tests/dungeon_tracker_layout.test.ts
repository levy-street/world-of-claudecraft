// The dungeon objectives tracker's seat and stylesheet contracts: the things a
// behavior test in a Node DOM cannot see (a :not() fold, a media query, the
// entries' markup) and that nothing else ties together. Each pin names the
// defect it stands against. What the painter DOES with that markup is pinned
// by behavior in dungeon_tracker_painter.test.ts and dungeon_tracker_touch.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HUD_FRAME_GROUPS } from '../src/ui/hud_frame_groups';
import { HUD_FRAME_SPECS } from '../src/ui/interface_unlock_core';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const hudCss = read('src/styles/hud.css');
const mobileCss = read('src/styles/hud.mobile.css');

/** The tracker's own ten-dash section of hud.css. */
function section(): string {
  const start = hudCss.indexOf('/* ---------- dungeon objectives tracker ---------- */');
  const end = hudCss.indexOf('/* ---------- practice DPS tracker ---------- */');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return hudCss.slice(start, end);
}

describe('dungeon tracker seat (both entries)', () => {
  it.each(['index.html', 'play.html'])(
    '%s seats it as the FIRST tracker of the right stack, a named group',
    (entry) => {
      // First, so it sits above the quest tracker: inside a dungeon it is the
      // business at hand. An entry that drops it hands the painter a null root.
      expect(read(entry)).toMatch(
        /<div id="right-tracker-stack" class="ui-outline">\s*<div id="dungeon-tracker" role="group"><\/div>\s*<div id="quest-tracker">/,
      );
    },
  );
});

describe('dungeon tracker stylesheet', () => {
  it('leaves the stack entirely outside a run, so it never spends a gap', () => {
    // The stack is a flex column with a gap: a zero-height child would still
    // push the quest tracker down 14px for every player outside a dungeon.
    expect(section()).toMatch(/#dungeon-tracker:not\(\.is-live\)\s*\{\s*display:\s*none;/);
  });

  it('keeps the empty plate out of the frame editor`s placeholder', () => {
    // The editor force-shows a hidden frame (display !important): the plate and
    // the list must stay hidden under it, or the placeholder is an empty box.
    expect(section()).toMatch(
      /#dungeon-tracker:not\(\.is-live\) > \.dgt-plate,\s*#dungeon-tracker:not\(\.is-live\) > \.dgt-list\s*\{\s*display:\s*none;/,
    );
    expect(hudCss).toMatch(
      /body\.interface-unlocked #dungeon-tracker\.tf-unlocked,[\s\S]*?display:\s*block !important;/,
    );
  });

  it('is click-through, like every other tracker over the world', () => {
    expect(section()).toMatch(/#dungeon-tracker\s*\{[^}]*pointer-events:\s*none;/);
  });

  it('sizes the plate from the painter`s measure, never from a viewport breakpoint', () => {
    // The plate is the one opaque box in the stack and must keep out from
    // under the button rail. Both live inside #ui's zoom, the rail can be
    // horizontal or moved and so can the tracker, so no viewport query can
    // say when they meet: the painter measures and writes a share of the
    // column (dungeonPlateFraction, pinned in dungeon_tracker_view.test.ts),
    // and the stylesheet only reads it. A percentage of a border-box width, so
    // the same value holds at every UI scale.
    const css = section();
    const plate = /#dungeon-tracker \.dgt-plate\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(plate).toMatch(/width:\s*var\(--dgt-plate-w, 100%\);/);
    expect(plate).toMatch(/box-sizing:\s*border-box;/);
    // No query on the viewport's size anywhere in the section: the only media
    // queries left are the preference ones.
    const queries = [...css.matchAll(/@media\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(queries.sort()).toEqual(['forced-colors: active', 'prefers-reduced-motion: reduce']);
    // The narrowed plate sets its name a size down but keeps the line height,
    // so narrowing can never make the plate shorter and flip the measure back.
    expect(css).toMatch(/#dungeon-tracker\.is-narrow \.dgt-name\s*\{\s*font-size:\s*13px;\s*\}/);
    expect(/#dungeon-tracker \.dgt-name\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(
      /line-height:\s*18px;/,
    );
    // And nothing exempts a detached frame, because nothing depends on one.
    expect(css).not.toContain('hud-frame-detached');
    // The name the painter writes is the name the stylesheet reads.
    expect(read('src/ui/hud/dungeon/dungeon_tracker_painter.ts')).toContain(
      "const PLATE_WIDTH_PROP = '--dgt-plate-w';",
    );
  });

  it('keeps every boss on one line: the rows span the whole column', () => {
    // Row text over a rail icon is harmless (every row in the stack does it),
    // so the list takes no margin against the rail: a margin there wrapped
    // long boss names to two lines exactly where height is scarcest.
    const list = /#dungeon-tracker \.dgt-list\s*\{([^}]*)\}/.exec(section())?.[1] ?? '';
    expect(list).toMatch(/margin:\s*7px 0 0 10px;/);
    expect(list).not.toMatch(/margin-right|width/);
  });

  it('lets the progress row wrap, so a narrowed plate never squeezes the rail to nothing', () => {
    // A finished heroic run in a long locale ("Heroisch" + "Abgeschlossen") on
    // the narrowed plate: the tally drops to its own line, right aligned, and
    // the rail keeps a floor.
    const css = section();
    expect(css).toMatch(/#dungeon-tracker \.dgt-progress\s*\{[^}]*flex-wrap:\s*wrap;/);
    expect(css).toMatch(/#dungeon-tracker \.dgt-bar\s*\{[^}]*min-width:\s*28px;/);
    expect(css).toMatch(/#dungeon-tracker \.dgt-tally\s*\{[^}]*margin-left:\s*auto;/);
  });

  it('never re-declares the plate primitive`s look', () => {
    // ui-panel-soft owns the fill, border and shadow; the section sets geometry.
    const plate = /#dungeon-tracker \.dgt-plate\s*\{([^}]*)\}/.exec(section())?.[1] ?? '';
    expect(plate).toContain('padding');
    // Property names only: `box-sizing: border-box` is geometry.
    expect(plate).not.toMatch(/(?:^|[\s;])(?:background|border|box-shadow|outline)[\w-]*\s*:/);
  });

  it('spells no raw color', () => {
    const css = section().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
  });

  it('both glows stand down under reduced motion, by media query and by the setting', () => {
    const css = section();
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*#dungeon-tracker \.dgt-row\.is-flash,\s*#dungeon-tracker \.dgt-plate\.is-complete-flash::after\s*\{\s*animation:\s*none;/,
    );
    expect(css).toMatch(
      /body\.reduce-motion #dungeon-tracker \.dgt-row\.is-flash,\s*body\.reduce-motion #dungeon-tracker \.dgt-plate\.is-complete-flash::after\s*\{\s*animation:\s*none;/,
    );
  });

  it('the done state does not rest on color alone under forced colors', () => {
    expect(section()).toMatch(
      /@media \(forced-colors: active\)\s*\{\s*#dungeon-tracker \.dgt-row\.is-done\s*\{\s*color:\s*Highlight;/,
    );
  });

  it('anchors no :has() of its own', () => {
    expect(section()).not.toContain(':has(');
  });

  it('is hidden on touch, where the quest strip carries the run instead', () => {
    // Its seat on a landscape phone sits on the action ring.
    expect(mobileCss).toMatch(/body\.mobile-touch #dungeon-tracker\s*\{\s*display:\s*none;\s*\}/);
  });
});

describe('dungeon tracker as a movable frame', () => {
  it('has a frame row and rides the combined tracker group, leading it', () => {
    const spec = HUD_FRAME_SPECS.find((row) => row.id === 'dungeonTracker');
    expect(spec).toMatchObject({
      elementId: 'dungeon-tracker',
      storageKey: 'woc_hud_frame_dungeon_tracker',
      labelKey: 'hudChrome.interfaceUnlock.frameNames.dungeonTracker',
      detachToUiRoot: true,
    });
    const group = HUD_FRAME_GROUPS.find((row) => row.id === 'trackerGroup');
    expect(group?.members[0]).toBe('dungeonTracker');
  });

  it('wears every piece of frame chrome the rift tracker wears', () => {
    // The chrome is seven hand-kept selector lists in hud.css. A tracker left
    // out of one of them unlocks without a cursor, a width or a move button.
    const chrome = (id: string): string[] => {
      const line = new RegExp(
        `^\\s*((?:body\\.interface-unlocked )?)#${id}((?:\\.[\\w-]+)+| \\.tf-move-btn(?::focus-visible)?),?$`,
        'gm',
      );
      return [...hudCss.matchAll(line)].map((m) => `${m[1]}${m[2]}`).sort();
    };
    const rift = chrome('rift-tracker');
    expect(rift.length).toBeGreaterThanOrEqual(7);
    expect(chrome('dungeon-tracker')).toEqual(rift);
  });
});
