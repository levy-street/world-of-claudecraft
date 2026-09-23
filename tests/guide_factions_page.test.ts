// @vitest-environment happy-dom

import { beforeAll, describe, expect, it } from 'vitest';
import { pageFor } from '../src/guide/pages';
import { GUIDE_ROUTES } from '../src/guide/routes';
import { FACTION_VENDOR_NPCS } from '../src/sim/content/faction_vendors';
import { FACTIONS } from '../src/sim/factions';
import { setLanguage } from '../src/ui/i18n';

// The Factions and Standing page, rendered the way the router renders it (the same
// contract tests/guide_route_render.test.ts sweeps every route with). Its own sibling
// suite per src/guide/CLAUDE.md: page-shape claims never land in tests/guide.test.ts.
//
// The page is prose only and spoiler-safe: it names the three factions and their
// quartermasters (both pinned against the live sim tables so a rename cannot leave the
// wiki stale), and it must never leak a balance number. The regex below carries every
// standing threshold, the per-level cap, and the per-quest awards from
// src/sim/factions.ts, so a future edit that pastes one into the prose fails here.
const BALANCE_NUMBER = /\b(1[ ,]?000|3[ ,]?000|7[ ,]?000|13[ ,]?000|20[ ,]?000|400|80|100)\b/;

function renderFactions(): string {
  const route = GUIDE_ROUTES.find((r) => r.id === 'factions');
  expect(route, 'the factions route must be registered in GUIDE_ROUTES').toBeTruthy();
  const page = pageFor('factions');
  expect(page, 'the factions route must have a registered page module').toBeTruthy();
  if (!route || !page) return '';
  return page.render({ params: [], sub: route.sub, titleKey: route.navKey });
}

function textOf(html: string): string {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root.textContent ?? '';
}

describe('Guide: Factions and Standing page', () => {
  beforeAll(() => setLanguage('en'));

  it('renders exactly one h1 with every key resolved and no stray placeholder', () => {
    const html = renderFactions();
    expect(html.length).toBeGreaterThan(0);
    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    expect(html.match(/\bguide\.[a-zA-Z0-9_.]+/g) ?? []).toEqual([]);
    expect(html.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) ?? []).toEqual([]);
  });

  it('names all three factions, pinned to the live faction table', () => {
    const text = textOf(renderFactions());
    const names = Object.values(FACTIONS).map((f) => f.name);
    expect(names.length).toBe(3);
    for (const name of names) expect(text, `faction "${name}" missing`).toContain(name);
  });

  it('names all three quartermasters, pinned to the live vendor table', () => {
    const text = textOf(renderFactions());
    const quartermasters = Object.values(FACTION_VENDOR_NPCS)
      .filter((npc) => (npc.vendorItems?.length ?? 0) > 0)
      .map((npc) => npc.name);
    expect(quartermasters.length).toBe(3);
    for (const name of quartermasters) {
      expect(text, `quartermaster "${name}" missing`).toContain(name);
    }
  });

  it('leaks no standing threshold, cap, or per-quest award into the prose', () => {
    const text = textOf(renderFactions());
    expect(text).not.toMatch(BALANCE_NUMBER);
  });

  it('cross-links to quests, economy, deeds, and the character sheet', () => {
    const html = renderFactions();
    for (const href of ['/wiki/quests', '/wiki/economy', '/wiki/deeds', '/wiki/reference/stats']) {
      expect(html, `related link "${href}" missing`).toContain(`href="${href}"`);
    }
  });
});
