// The R38 banner scheduler (src/ui/banner_queue.ts): celebrations queue,
// level-up files ahead of queued deeds, ambient keeps replace semantics with
// a latest-wins pending seat behind a live celebration, and the queue is
// bounded. Pure core, driven directly; the Hud's timer chain is the caller.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANNER_QUEUE_LIMIT, BannerQueue, bannerSubtextLines } from '../src/ui/banner_queue';

describe('BannerQueue', () => {
  it('the R38 collision: a deed landing behind a live level-up queues instead of replacing', () => {
    const q = new BannerQueue<string>();
    expect(q.enqueue('levelup', 'Level 2!')).toBe('show');
    expect(q.enqueue('deed', 'First Steps')).toBe('queued');
    // The level-up's time ends; the deed takes the slot whole.
    expect(q.advance()).toBe('First Steps');
    expect(q.advance()).toBeNull();
    expect(q.isLive).toBe(false);
  });

  it('level-up files ahead of queued deeds but behind an earlier level-up (R38 ordering)', () => {
    const q = new BannerQueue<string>();
    expect(q.enqueue('deed', 'live-deed')).toBe('show');
    expect(q.enqueue('deed', 'deed-a')).toBe('queued');
    expect(q.enqueue('levelup', 'level-3')).toBe('queued');
    expect(q.enqueue('levelup', 'level-4')).toBe('queued');
    // Never preempts the live banner; both level-ups outrank the queued
    // deed, and stay in their own arrival order.
    expect(q.advance()).toBe('level-3');
    expect(q.advance()).toBe('level-4');
    expect(q.advance()).toBe('deed-a');
    expect(q.advance()).toBeNull();
  });

  it('ambient over ambient keeps the immediate replace (countdowns depend on it)', () => {
    const q = new BannerQueue<string>();
    expect(q.enqueue('ambient', '3')).toBe('show');
    expect(q.enqueue('ambient', '2')).toBe('show');
    expect(q.enqueue('ambient', '1')).toBe('show');
    // Nothing queued: the slot was replaced in place each time.
    expect(q.depth).toBe(0);
  });

  it('ambient behind a live celebration waits in ONE latest-wins seat', () => {
    const q = new BannerQueue<string>();
    expect(q.enqueue('deed', 'live-deed')).toBe('show');
    expect(q.enqueue('ambient', 'Zone A')).toBe('queued');
    expect(q.enqueue('ambient', 'Zone B')).toBe('queued');
    expect(q.depth).toBe(1);
    // Celebrations still outrank the pending ambient at advance time.
    expect(q.enqueue('levelup', 'level-2')).toBe('queued');
    expect(q.advance()).toBe('level-2');
    expect(q.advance()).toBe('Zone B');
    expect(q.advance()).toBeNull();
  });

  it('the celebration queue is bounded: a full queue drops the incoming banner', () => {
    const q = new BannerQueue<number>();
    expect(q.enqueue('deed', 0)).toBe('show');
    for (let i = 1; i <= BANNER_QUEUE_LIMIT; i++) {
      expect(q.enqueue('deed', i)).toBe('queued');
    }
    expect(q.enqueue('deed', 99)).toBe('dropped');
    expect(q.enqueue('levelup', 100)).toBe('dropped');
    expect(q.depth).toBe(BANNER_QUEUE_LIMIT);
  });

  it('hideLive keeps queued celebrations, drops the pending ambient, frees the slot', () => {
    // The ambient-takeover arm (the phase 14 QA): distinct from clear(),
    // which stays the hard reset. A takeover ends the LIVE banner and
    // retires the stale pending-ambient seat, but every queued celebration
    // survives to play afterwards.
    const q = new BannerQueue<string>();
    expect(q.enqueue('levelup', 'L1')).toBe('show');
    expect(q.enqueue('deed', 'D1')).toBe('queued');
    expect(q.enqueue('ambient', 'A1')).toBe('queued');
    q.hideLive();
    expect(q.isLive).toBe(false);
    expect(q.advance()).toBe('D1');
    expect(q.advance()).toBeNull();
  });

  it('clear() wipes everything; retainQueued purges only the waiters', () => {
    const q = new BannerQueue<{ source: string | null }>();
    const unstuck = { source: 'unstuck' };
    const plain = { source: null };
    expect(q.enqueue('deed', plain)).toBe('show');
    q.enqueue('deed', unstuck);
    q.enqueue('deed', plain);
    q.enqueue('ambient', unstuck);
    q.retainQueued((p) => p.source !== 'unstuck');
    expect(q.depth).toBe(1);
    expect(q.advance()).toBe(plain);
    q.enqueue('deed', plain);
    q.clear();
    expect(q.depth).toBe(0);
    expect(q.isLive).toBe(false);
    // After a clear, the next arrival shows immediately.
    expect(q.enqueue('ambient', plain)).toBe('show');
  });
});

describe('bannerSubtextLines: the banner secondary-line contract', () => {
  it('keeps a single string as one line', () => {
    expect(bannerSubtextLines('Rating 1520 (+20)')).toEqual(['Rating 1520 (+20)']);
  });

  it('keeps a list as separate lines, in order', () => {
    // The battleground verdict: three independent sentences, each its own t()
    // key, never concatenated into one string a locale could not reorder.
    expect(bannerSubtextLines(['Time expired', 'Thornhollow Fields 2:1', '+120 Honor'])).toEqual([
      'Time expired',
      'Thornhollow Fields 2:1',
      '+120 Honor',
    ]);
  });

  it('normalizes "no subtext" to an empty list, whatever shape it arrived in', () => {
    // The paint side gates on a single `!!subtext`, and `!![]` is true: an empty
    // list reaching the element would add has-subtext to a banner with no
    // subtext and lay out an empty second row.
    expect(bannerSubtextLines(undefined)).toEqual([]);
    expect(bannerSubtextLines([])).toEqual([]);
    expect(bannerSubtextLines('')).toEqual([]);
  });

  it('drops empty lines out of a list rather than painting a blank row', () => {
    expect(bannerSubtextLines(['Time expired', '', 'Rating 1520'])).toEqual([
      'Time expired',
      'Rating 1520',
    ]);
    expect(bannerSubtextLines(['', ''])).toEqual([]);
  });
});

describe('the banner paint side consumes the normalized lines', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('normalizes ONCE at enqueue, so the payload never carries an empty list', () => {
    expect(hud).toContain('const subtextLines = bannerSubtextLines(subtext);');
    expect(hud).toContain('subtext: subtextLines.length > 0 ? subtextLines : undefined,');
  });

  it('paints one .banner-subtext span per line under one .banner-title', () => {
    const paint = hud.slice(
      hud.indexOf('private paintBanner('),
      hud.indexOf('private paintBanner(') + 2000,
    );
    expect(paint).toContain("classList.toggle('has-subtext', !!subtext)");
    expect(paint).toContain('const details = subtext.map((line) => {');
    expect(paint).toContain("detail.className = 'banner-subtext';");
    expect(paint).toContain('this.bannerEl.replaceChildren(title, ...details);');
  });
});
