// The world quest entry banner (src/ui/hud/quest/world_quest_banner_view.ts):
// the model, and both halves of its collision rule. Timing: it queues through
// the one #banner scheduler as a celebration, so it never replaces (or is
// replaced by) the zone-entry name or the hoard goblin warning that share the
// slot. Space: its plate is bottom-anchored above the separate #subzone-banner
// line through one shared token, on desktop and on every touch layout.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { BannerQueue } from '../src/ui/banner_queue';
import {
  WORLD_QUEST_BANNER_MS,
  worldQuestBannerModel,
} from '../src/ui/hud/quest/world_quest_banner_view';
import { HOARD_GOBLIN_BANNER_MS } from '../src/ui/quest_event_view';
import { worldQuestDisplayName } from '../src/ui/world_quest_view';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** The declarations of one exact selector's rule block(s) in a sheet. */
function ruleBodies(css: string, selector: string): string[] {
  const out: string[] = [];
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g');
  for (let m = re.exec(css); m; m = re.exec(css)) out.push(m[1]);
  return out;
}

describe('world quest banner model', () => {
  it('titles the plate with the quest name and names it a World Quest underneath', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const model = worldQuestBannerModel(quest.id);
    expect(model.title).toBe(worldQuestDisplayName(quest.id));
    expect(model.title).not.toBe(quest.id);
    expect(model.subtitle).toBe('World Quest');
    expect(model.variant).toBe('worldQuest');
    expect(model.bannerClass).toBe('deed');
    expect(model.durationMs).toBe(WORLD_QUEST_BANNER_MS);
  });

  it('is a pure function of the quest id', () => {
    const a = worldQuestBannerModel('wq_eastbrook_bandits');
    const b = worldQuestBannerModel('wq_eastbrook_bandits');
    expect(a).toEqual(b);
    expect(worldQuestBannerModel('wq_eastbrook_calligraphy').title).not.toBe(a.title);
  });
});

describe('world quest banner: the timing half of the collision rule', () => {
  const zone = { text: 'Eastbrook Vale', cls: 'ambient' as const };
  const goblin = { text: 'A goblin thief appears!', cls: 'ambient' as const };
  const entry = worldQuestBannerModel('wq_eastbrook_bandits');

  it('waits behind a live zone-entry name instead of replacing it', () => {
    const q = new BannerQueue<string>();
    expect(q.enqueue(zone.cls, zone.text)).toBe('show');
    expect(q.enqueue(entry.bannerClass, entry.title)).toBe('queued');
    expect(q.advance()).toBe(entry.title);
    expect(q.advance()).toBeNull();
  });

  it('parks a zone name that arrives while it is live, then shows it', () => {
    const q = new BannerQueue<string>();
    expect(q.enqueue(entry.bannerClass, entry.title)).toBe('show');
    expect(q.enqueue(zone.cls, zone.text)).toBe('queued');
    expect(q.advance()).toBe(zone.text);
  });

  it('waits behind the goblin warning and parks one that lands on it', () => {
    const q = new BannerQueue<string>();
    expect(q.enqueue(goblin.cls, goblin.text)).toBe('show');
    expect(q.enqueue(entry.bannerClass, entry.title)).toBe('queued');
    expect(q.advance()).toBe(entry.title);
    expect(q.enqueue(goblin.cls, goblin.text)).toBe('queued');
    expect(q.advance()).toBe(goblin.text);
  });

  it('is classed as a celebration: an ambient arrival never replaces it in place', () => {
    // The pre-plate banner was ambient: a zone name arriving mid-read wiped it.
    const ambient = new BannerQueue<string>();
    ambient.enqueue('ambient', 'World quest started');
    expect(ambient.enqueue(zone.cls, zone.text)).toBe('show');
    const queued = new BannerQueue<string>();
    queued.enqueue(entry.bannerClass, entry.title);
    expect(queued.enqueue(zone.cls, zone.text)).not.toBe('show');
  });

  it('holds for less than the ambient deferral window, so a parked zone name is never aged out', () => {
    const hud = read('src/ui/hud.ts');
    const gap = Number(/const BANNER_ADVANCE_GAP_MS = (\d+);/.exec(hud)?.[1]);
    const maxDefer = Number(/const AMBIENT_MAX_DEFER_MS = (\d+);/.exec(hud)?.[1]);
    expect(gap).toBeGreaterThan(0);
    expect(maxDefer).toBeGreaterThan(0);
    expect(WORLD_QUEST_BANNER_MS + gap).toBeLessThan(maxDefer);
    // Long enough to read, and no longer than the goblin warning's hold.
    expect(WORLD_QUEST_BANNER_MS).toBeGreaterThan(2600);
    expect(WORLD_QUEST_BANNER_MS).toBeLessThanOrEqual(HOARD_GOBLIN_BANNER_MS);
  });
});

describe('world quest banner: the space half of the collision rule', () => {
  const hudCss = read('src/styles/hud.css');
  const mobileCss = read('src/styles/hud.mobile.css');
  const tokens = read('src/styles/tokens.css');
  const hudTs = read('src/ui/hud.ts');

  it('paints the plate class from the worldQuest variant and clears the flash lane', () => {
    expect(hudTs).toContain(
      "this.bannerEl.classList.toggle('banner-world-quest', variant === 'worldQuest');",
    );
    // Where the plate actually paints (a queued plate included), the yellow
    // quest-progress flash above it yields for the plate's hold.
    expect(hudTs).toContain(
      "if (variant === 'worldQuest') this.questBanner.yieldToPlate(durationMs);",
    );
  });

  it('keeps a touch title on one line so the upward-growing plate stays on screen', () => {
    const title = ruleBodies(
      mobileCss,
      'body.mobile-touch #banner.banner-world-quest .banner-title',
    ).join('\n');
    expect(title).toMatch(/white-space:\s*nowrap;/);
    expect(title).toMatch(/text-overflow:\s*ellipsis;/);
  });

  it('declares the shared subzone anchor once, and the subzone line reads it', () => {
    expect(tokens).toMatch(/--subzone-banner-top:\s*35%;/);
    expect(tokens).toMatch(/--banner-stack-gap:\s*\d+px;/);
    const subzone = ruleBodies(hudCss, '#subzone-banner').join('\n');
    expect(subzone).toMatch(/top:\s*var\(--subzone-banner-top\);/);
    // No layout may pin the subzone line to a literal: it would drift off the
    // anchor the plate stacks above.
    for (const body of ruleBodies(mobileCss, 'body.mobile-touch #subzone-banner')) {
      expect(body).not.toMatch(/\btop\s*:/);
    }
  });

  it('bottom-anchors the plate a gap above the subzone line on desktop', () => {
    const plate = ruleBodies(hudCss, '#banner.banner-world-quest').join('\n');
    expect(plate).toMatch(
      /top:\s*calc\(var\(--subzone-banner-top\) - var\(--banner-stack-gap\)\);/,
    );
    // translate -100% on Y: `top` names the plate's BOTTOM edge.
    expect(plate).toMatch(/transform:\s*translate\(-50%,\s*-100%\);/);
  });

  it('keeps the same anchor on touch, where the plain #banner top is re-pinned', () => {
    const plate = ruleBodies(mobileCss, 'body.mobile-touch #banner.banner-world-quest').join('\n');
    expect(plate).toMatch(
      /top:\s*calc\(var\(--subzone-banner-top\) - var\(--banner-stack-gap\)\);/,
    );
    // The landscape layout moves the subzone line through the token only.
    expect(mobileCss).toMatch(/body\.mobile-touch \{\s*--subzone-banner-top:\s*25%;\s*\}/);
  });

  it('drops the fade under reduced motion', () => {
    expect(hudCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*#banner\.banner-world-quest \{\s*transition: none;/,
    );
  });
});
