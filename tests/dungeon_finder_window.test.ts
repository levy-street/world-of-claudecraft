// Source-scan guard for src/ui/dungeon_finder_window.ts (the arena_window.test.ts
// shape): the painter must stay a thin, accessible, token-driven consumer of the
// pure core, with the perf contract (signature skip + in-place clock slots)
// visible in source. Node-only: reads the file as text, no DOM.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(process.cwd(), 'src/ui/dungeon_finder_window.ts'), 'utf8');
const board = readFileSync(resolve(process.cwd(), 'src/ui/dungeon_board_chrome.ts'), 'utf8');
const activities = readFileSync(
  resolve(process.cwd(), 'src/ui/dungeon_activity_chrome.ts'),
  'utf8',
);

describe('dungeon finder window painter (source contract)', () => {
  it('renders from the pure core, never from raw world state', () => {
    expect(src).toContain('buildDungeonFinderView(');
  });

  it('skips the DOM rebuild on an unchanged signature and refreshes clocks in place', () => {
    expect(src).toContain('if (sig === this.lastSig) {');
    expect(src).toContain('this.updateClocks(view.clocks);');
    expect(src).toContain('data-df-clock');
  });

  // The rebuild at `el.innerHTML = this.liveHtml(view)` replaces the whole window
  // subtree, so the freshly parsed .df-rail starts at scrollTop 0. Selecting a row
  // always takes that branch (the click flips this.pane and feeds selectedId into
  // view.sig), which is why picking a dungeon near the bottom snapped the list back
  // to the top. Capture-before / restore-after is the same idiom bank_window,
  // spellbook_window and crafting_window already use for their own scrollers.
  it('preserves the catalogue rail scroll offset across a rebuild', () => {
    expect(src).toContain("el.querySelector('.df-rail')?.scrollTop ?? 0");
    expect(src).toContain('rail.scrollTop = prevRailScrollTop');
  });

  it('owns WCAG focus: dialog root marked once on open, focus captured and restored', () => {
    expect(src).toContain("markDialogRoot(root, { labelledBy: 'dfinder-title' })");
    expect(src).toContain('this.openerFocus = this.deps.captureFocus();');
    expect(src).toContain('this.deps.restoreFocus(this.openerFocus);');
    // Keyboard focus moves into the freshly opened window.
    expect(src).toContain("querySelector('[data-close]') as HTMLElement | null)?.focus()");
  });

  it('closes through close() with a real labelled close button', () => {
    expect(src).toMatch(/data-close aria-label="\$\{esc\(t\('hudChrome\.finder\.close'\)\)\}"/);
  });

  it('escapes every interpolated name and uses t() for every label', () => {
    // Player/leader names and localized entity names always pass through esc().
    expect(board).toContain('esc(applicant.name)');
    expect(board).toContain("esc(t('hudChrome.finder.leader', { name: listing.leaderName }))");
    // No raw innerHTML of unescaped world text: interpolations inside template
    // literals must call esc(, tEntity via esc(, or a builder.
    expect(board).not.toMatch(/\$\{applicant\.name\}/);
    expect(board).not.toMatch(/\$\{listing\.leaderName\}/);
  });

  it('keeps tab and role toggles stateful with aria-pressed / role=checkbox semantics', () => {
    expect(src).toContain('finderNavigationHtml(');
    expect(activities).toMatch(/data-role="\$\{r\.role\}" aria-pressed=/);
    expect(readFileSync(resolve(process.cwd(), 'src/ui/dungeon_create_form.ts'), 'utf8')).toMatch(
      /role="checkbox" aria-checked=/,
    );
  });

  it('never half-applies a tablist / listbox contract over plain toggle buttons', () => {
    // aria-pressed buttons with no role=tab / role=option children read WORSE to a
    // screen reader under role=tablist / role=listbox than under a labelled group.
    expect(src).not.toContain('role="tablist"');
    expect(src).not.toContain('role="listbox"');
    // W12: shared visual primitives sit beside legacy group hooks without changing roles.
    expect(src).not.toContain('class="df-tabs ui-seg"');
    expect(src).toContain('class="df-rail ui-panel-soft" role="group"');
  });

  it('composes every localizable sentence from tokens, never from a concat', () => {
    // Count-plus-role, the needs line, the mm:ss clock and the slot fraction are all
    // token templates, so a locale owns the ORDER (and the clock separator).
    expect(src).toContain(
      "t('hudChrome.finder.roleCount', { count: num(n), role: this.roleLabel(role) })",
    );
    expect(board).toContain(
      "esc(t('hudChrome.finder.needs', { roles: t('hudChrome.finder.roleCount'",
    );
    expect(board).toContain(
      "esc(t('hudChrome.finder.slots', { size: num(listing.size), capacity: num(listing.capacity) }))",
    );
    expect(src).toContain("t('hudChrome.finder.clock', {");
    expect(src).toContain("tPlural('hudChrome.plurals.finderPartySize'");
    // No hand-rolled ':' clock and no `${count} ${label}` role concat.
    expect(src).not.toMatch(/seconds < 10 \? '0' : ''/);
    expect(src).not.toMatch(/\$\{num\(n\)\} \$\{esc\(this\.roleLabel/);
  });

  it('ships prerendered portraits with fixed dimensions and lazy decode (no live 3D)', () => {
    expect(src).toContain('width="64" height="64" loading="lazy" decoding="async"');
    // No renderer import: the header may SAY "no Three.js", the code must not use it.
    expect(src).not.toMatch(/from 'three'|from "three"|\.\.\/render\//);
  });

  it('keeps item quality colors in token-driven stylesheet classes', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
    expect(src).toMatch(/df-quality-\$\{i\.quality\}/);
    for (const quality of ['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary']) {
      expect(css).toMatch(new RegExp(`\\.df-quality-${quality} \\{\\s*color: var\\(--`));
    }
    for (const code of [src, board]) {
      expect(code).not.toMatch(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
      expect(code).not.toMatch(/rgb\(/);
    }
  });

  it('names its cadence constants instead of inlining thresholds', () => {
    expect(src).toContain("const FINDER_LOADING_SIG = 'dfinder-loading'");
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });

  it('routes the map action through the injected non-teleporting hook', () => {
    expect(src).toContain('this.deps.showOnMap(detail.entrance.x, detail.entrance.z)');
    expect(src).not.toMatch(/enterDungeon|leaveDungeon|setDungeonDifficulty/);
  });

  // The window's own components rule sits in @layer components, which OUTRANKS the
  // shared `.window { display: none }` in @layer layout: a `display: flex` there would
  // leave the closed window on screen from HUD boot (issue found in review of #1789).
  // The house pattern (#market-window) is: closed state in the components rule, painter
  // opens with inline flex. These three assertions pin all three halves of it.
  it('opens and closes with inline flex, matching its flex-column components rule', () => {
    expect(src).toContain("root.style.display = 'flex';");
    expect(src).toContain("el.style.display = 'none';");
    expect(src).toContain("return this.deps.root().style.display === 'flex';");
    expect(src).not.toContain("style.display = 'block'");
  });

  // Regression: the heroic-only loot rows (a bespoke heroic equipment slot, plus the
  // ungrouped heroic-only rolls like mount reins) were BOTH always labelled with the
  // "always drops" lootHeroic string, even when the underlying entries are a partial
  // roll group (heroicGroups whose chances sum below 1, e.g. the farm-pattern bonus)
  // or an independent low-chance single (a heroic mount, 0.1% to 0.5% per clear). A
  // Heroic Nythraxis raider reading "Heroic bonus, one of these always drops:" directly
  // over the mount reins row read that mount as guaranteed, which it never was: only
  // the label was wrong, never the roll. Mirror the non-heroic groups/singles split
  // (lootGuaranteed/lootMaybe, lootChance) so a non-guaranteed heroic group or an
  // ungrouped heroic single is never claimed as an always-drops slot.
  it('never claims a non-guaranteed heroic loot row always drops', () => {
    expect(src).toContain(
      "g.guaranteed ? 'hudChrome.finder.lootHeroic' : 'hudChrome.finder.lootHeroicMaybe'",
    );
    expect(src).toContain("t('hudChrome.finder.lootHeroicChance')");
    // The old unconditional heroic-singles header must be gone: heroicSingles are
    // ungrouped independent-chance rolls (mounts), never a guaranteed slot.
    expect(src).not.toMatch(
      /heroicSingles\.length > 0[\s\S]{0,80}t\('hudChrome\.finder\.lootHeroic'\)/,
    );
  });

  it('supports the vault tab to preview the Great Vault in read-only mode', () => {
    const navigation = readFileSync(
      resolve(process.cwd(), 'src/ui/dungeon_finder_navigation.ts'),
      'utf8',
    );
    expect(navigation).toContain('data-tab="vault"');
    expect(navigation).toContain("t('hudChrome.weeklyRewards.title')");
    expect(src).toContain('createWeeklyRewardsTab(');
    expect(src).toContain('readOnly: true');
    expect(src).toContain("el.classList.toggle('df-vault-mode', view.tab === 'vault')");
    expect(src).toContain('this.vaultPane.close()');
  });
});

describe('dungeon finder group-found popup (source contract)', () => {
  const popup = readFileSync(
    resolve(process.cwd(), 'src/ui/dungeon_finder_proposal_popup.ts'),
    'utf8',
  );

  it('announces itself to a screen reader without stealing focus', () => {
    // The popup deliberately never moves focus (the player may be fighting), so with no
    // live region an SR user misses the whole 30-second answer window.
    expect(popup).toContain("setAttribute('role', 'alert')");
    expect(popup).toContain("setAttribute('aria-live', 'assertive')");
    expect(popup).not.toContain('.focus()');
  });

  it('builds the accepted/total meter from the shared slots template', () => {
    expect(popup).toContain(
      "t('hudChrome.finder.slots', { size: num(s.accepted), capacity: num(s.total) })",
    );
    expect(popup).not.toMatch(/\$\{num\(s\.accepted\)\}\/\$\{num\(s\.total\)\}/);
  });
});

describe('dungeon finder window stylesheet contract', () => {
  const components = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');
  const mobile = readFileSync(resolve(process.cwd(), 'src/styles/hud.mobile.css'), 'utf8');

  it('defaults the window to display: none in its own components rule', () => {
    const rule = /#dungeon-finder-window \{([^}]*)\}/.exec(components);
    expect(rule, 'the #dungeon-finder-window base rule').toBeTruthy();
    expect(rule?.[1]).toContain('display: none;');
    expect(rule?.[1]).not.toContain('display: flex;');
  });

  it('keeps every mobile finder rule inside @layer hud-mobile and sets no root display', () => {
    // Unlayered rules outrank every layer: a block appended after the wrapper closes
    // would beat both the closed-state default and the painter's own cascade.
    const afterLayer = mobile.slice(mobile.lastIndexOf('\n}\n') + 3).trim();
    expect(afterLayer, 'no CSS may sit after the @layer hud-mobile wrapper closes').toBe('');
    expect(mobile).toContain('body.mobile-touch #dungeon-finder-window {');
    const rule = /body\.mobile-touch #dungeon-finder-window \{([^}]*)\}/.exec(mobile);
    expect(rule?.[1]).not.toContain('display:');
  });

  it('gives the HUD render gate the same flex open-state check the painter writes', () => {
    const hud = readFileSync(resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');
    expect(hud).toContain("$('#dungeon-finder-window').style.display === 'flex'");
  });

  it('defines .df-vault-mode and preview notice styling with token variables', () => {
    expect(components).toContain('#dungeon-finder-window.df-vault-mode');
    expect(components).toContain('.df-body-vault');
    expect(components).toContain('.df-vault-container');
    expect(components).toContain('.weekly-preview-notice');
  });
});

describe('dungeon finder boss guide button (source contract)', () => {
  it('offers the boss guide only through the injected hooks, labelled and escaped', () => {
    expect(src).toContain('this.deps.hasBossGuide?.(dungeonId, e.mobId)');
    expect(src).toContain("t('hudChrome.raidBossGuide.finderOpenLabel', { boss: name })");
    expect(src).toContain('data-bossguide="${esc(e.mobId)}"');
    expect(src).toContain('this.deps.openBossGuide(detail.dungeonId, mobId, detail.difficulty);');
  });
});
