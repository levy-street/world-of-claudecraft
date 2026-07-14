// Pure-core tests for the OVERVIEW tab's "Milestones" block renderer
// (src/ui/milestones_overview_view.ts), plus a source guard on hud.ts's thin
// progressionHtml caller. Together these make the Phase 5 "no duplicate
// progression data across tabs" trim DECISIVE: before this, the trimmed
// progressionHtml was only ever exercised through stubs (the char_window_frame
// fakeDeps), so a revert that re-showed Total XP / Virtual Level / Prestige Rank
// on the Overview tab, or restored the "Progression" heading, passed every test.
//
// - renderMilestonesOverview is unit-tested directly for the badges / none-state
//   / at-cap / eligible states and for the STRUCTURAL absence of the three
//   duplicated rows.
// - the hud.ts source guard pins that its data-gatherer resolves the Milestones
//   heading key and gathers NONE of the totalXp/virtualLevel/prestigeRank/heading
//   keys, so a revert of the trim in hud.ts itself reddens here.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type MilestonesOverviewModel,
  renderMilestonesOverview,
} from '../src/ui/milestones_overview_view';

const BASE: MilestonesOverviewModel = {
  headingText: 'Milestones',
  badges: [],
  noneText: 'None yet',
  prestige: null,
};

describe('renderMilestonesOverview: block structure', () => {
  it('wraps the block in .char-progression with the heading in .cp-title', () => {
    const html = renderMilestonesOverview(BASE);
    expect(html.startsWith('<div class="char-progression">')).toBe(true);
    expect(html).toContain('<div class="cp-title">Milestones</div>');
  });

  it('renders the none-state copy when no milestone is unlocked (no badge nodes)', () => {
    const html = renderMilestonesOverview({ ...BASE, badges: [] });
    expect(html).toContain('<span class="cp-none">None yet</span>');
    expect(html).not.toContain('ms-badge');
  });

  it('renders one .ms-badge per unlocked milestone, with the kind class and localized name', () => {
    const html = renderMilestonesOverview({
      ...BASE,
      badges: [
        { kind: 'title', name: 'Veteran' },
        { kind: 'border', name: 'Paragon' },
      ],
    });
    expect(html).toContain('<span class="ms-badge ms-title">Veteran</span>');
    expect(html).toContain('<span class="ms-badge ms-border">Paragon</span>');
    // Badges replace the none-state, never both.
    expect(html).not.toContain('cp-none');
  });
});

describe('renderMilestonesOverview: does NOT duplicate the Equipment tab progression rows', () => {
  // The whole point of the trim: these three rows live on the Equipment tab's
  // Progression panel (char_panels_view.ts buildProgressionPanel), so the
  // Overview block must never render them. A model with populated badges +
  // prestige is the richest state; none of the three labels may appear.
  const RICH: MilestonesOverviewModel = {
    headingText: 'Milestones',
    badges: [{ kind: 'title', name: 'Veteran' }],
    noneText: 'None yet',
    prestige: { ready: true, actionText: 'Prestige', hint: null },
  };

  it.each([
    'Total XP',
    'Virtual Level',
    'Prestige Rank',
  ])('never renders the %s label (it lives on the Equipment tab)', (label) => {
    expect(renderMilestonesOverview(RICH)).not.toContain(label);
  });

  it('never stamps the "Progression" heading (that title is the Equipment panel\'s)', () => {
    // The model carries the heading text; the Overview block must be fed the
    // Milestones heading, so a "Progression" heading never appears here.
    expect(renderMilestonesOverview(RICH)).not.toContain('Progression');
  });
});

describe('renderMilestonesOverview: prestige action row', () => {
  it('omits the whole prestige row below the level cap (prestige: null)', () => {
    const html = renderMilestonesOverview({ ...BASE, prestige: null });
    expect(html).not.toContain('cp-actions');
    expect(html).not.toContain('data-act="prestige"');
    expect(html).not.toContain('cp-hint');
  });

  it('renders an ENABLED prestige button with no hint when eligible', () => {
    const html = renderMilestonesOverview({
      ...BASE,
      prestige: { ready: true, actionText: 'Prestige (2)', hint: null },
    });
    expect(html).toContain('<button class="btn" data-act="prestige">Prestige (2)</button>');
    // "ready" means the disabled attribute is absent.
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('cp-hint');
  });

  it('renders a DISABLED prestige button plus the requirement hint when not yet eligible', () => {
    const html = renderMilestonesOverview({
      ...BASE,
      prestige: {
        ready: false,
        actionText: 'Prestige',
        hint: '12,000 XP more to prestige',
      },
    });
    expect(html).toContain('<button class="btn" data-act="prestige" disabled>Prestige</button>');
    expect(html).toContain('<span class="cp-hint">12,000 XP more to prestige</span>');
  });
});

// Source guard on hud.ts's thin progressionHtml caller: the pure view above
// cannot see WHICH i18n keys hud.ts feeds it, so this scan pins the trim at the
// data-gathering site. Isolating the method body (from its signature to the next
// private method) mirrors the char_window.test.ts source-scan style.
describe('hud.ts progressionHtml wiring guard (Phase 5 trim)', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  const start = hud.indexOf('private progressionHtml(');
  const end = hud.indexOf('private openPrestigeDialog(', start);
  const body = hud.slice(start, end);

  it('finds the progressionHtml method body to scan', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('resolves the Milestones heading key, delegating render to the pure core', () => {
    expect(body).toContain("t('game.progression.milestones')");
    expect(body).toContain('renderMilestonesOverview(');
  });

  it('does NOT re-introduce the Total XP / Virtual Level / Prestige Rank rows or the Progression heading', () => {
    // A revert of the trim would re-add any of these keys here; the guard reds.
    expect(body).not.toContain('game.progression.totalXp');
    expect(body).not.toContain('game.progression.virtualLevel');
    expect(body).not.toContain('game.progression.prestigeRank');
    expect(body).not.toContain('game.progression.heading');
  });
});
