// Real-browser regression for the top-band quest strip, the touch replacement
// for the right-anchored quest tracker. Composes the shipped markup, the real
// mobile stylesheet and the real controller, so what a unit test cannot see is
// pinned against real layout:
//
//   - the strip lands in the top band, clear of the target frame's static seat,
//   - it NEVER overlaps the action ring at 0, 1, 2 or 5 tracked quests, which is
//     the defect it exists to fix (the tracker had no height bound at all and
//     overlapped the ring by 122 x 42px at only two quests),
//   - its height does not move with the quest count,
//   - its LEFT-TOP anchor does not move when the shown quest's objective count
//     changes, so the box grows down and right from a point the thumb learned,
//   - its anchor is BYTE-IDENTICAL from first paint with no target, with a
//     target, and after losing one again (the seat is derived from the target
//     frame's STATIC seat in hud.mobile.css, never from its live box),
//   - it wears NO plate: its glyphs sit on the world and carry their own
//     reciprocal outline instead,
//   - the hit surface stays a constant pad around a box that shrinks,
//   - and tap / swipe cycling works through real pointer events.

import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { buildQuestStrip } from '../../src/ui/hud/quest/quest_strip_controller';
import {
  QUEST_STRIP_BAND_TOP_PX,
  QUEST_STRIP_TARGET_FRAME_GAP_PX,
} from '../../src/ui/hud/quest/quest_strip_core';
import type { TrackedQuest } from '../../src/ui/hud/quest/quest_tracker';
import '../../src/styles/index.css';
import { makeWriterFacet } from '../../src/ui/painter_host';
import { cleanup } from './_harness';

// Both are real landscape phone viewports the touch HUD ships to: 844x390 is the
// iPhone 14/15 class and 874x402 the iPhone 16 Pro, and they land on different
// layout tiers, which is the point of running the same pins twice.
const VIEWPORTS = [
  { label: '844x390', width: 844, height: 390, tier: 'hud-mobile-compact' },
  { label: '874x402', width: 874, height: 402, tier: '' },
] as const;

const EDGE_TOLERANCE_PX = 0.5;
/** Past QUEST_STRIP_SWIPE_DEADZONE_PX (22) in either direction. */
const SWIPE_PX = 40;

const STRIP_MARKUP = `
  <div id="quest-strip" class="empty">
    <button type="button" id="quest-strip-main" aria-labelledby="quest-strip-title quest-strip-complete quest-strip-count" aria-describedby="quest-strip-objs quest-strip-hint">
      <span class="quest-strip-title-row">
        <span id="quest-strip-title" class="quest-strip-title"></span>
        <span id="quest-strip-complete" class="quest-complete"></span>
        <span id="quest-strip-cycle" class="quest-strip-cycle" aria-hidden="true"><span id="quest-strip-prev" class="quest-strip-arrow">&#8249;</span><span id="quest-strip-count" class="quest-strip-count"></span><span id="quest-strip-next" class="quest-strip-arrow">&#8250;</span></span>
      </span>
      <span id="quest-strip-objs" class="quest-strip-objs">
        <span class="quest-strip-obj"></span>
        <span class="quest-strip-obj"></span>
        <span class="quest-strip-obj"></span>
        <span class="quest-strip-obj"></span>
        <span id="quest-strip-more" class="quest-strip-obj quest-strip-more"></span>
      </span>
    </button>
    <span id="quest-strip-hint" class="visually-hidden"></span>
  </div>`;

function quests(count: number, objectiveCount = 2): TrackedQuest[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `q${index}`,
    number: index + 1,
    title: `Cleanse the Gravewyrm Barrow ${index + 1}`,
    complete: false,
    objectives: Array.from({ length: objectiveCount }, (_row, row) => ({
      label: `Gravewyrm Acolyte ${row + 1} slain`,
      current: row,
      total: 6,
    })),
  }));
}

/** The shipped structure: the strip inside #mobile-controls beside the ring
 *  (matching index.html / play.html), and the left column the band's occupants
 *  live in. Party rows only render under .party-expanded; without it the
 *  container is 0x0 and the band looks freer than it is.
 *
 *  The target frame is NOT mounted: the strip must seat itself correctly before
 *  the player has ever had a target, so every pin starts from that state and
 *  calls addTarget() when it wants one. */
function mountHud() {
  const controls = document.createElement('section');
  controls.id = 'mobile-controls';

  const ring = document.createElement('div');
  ring.id = 'mobile-action-ring';
  for (let i = 0; i < 4; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-action-slot';
    btn.dataset.mobileIndex = String(i);
    ring.append(btn);
  }
  for (const id of ['mobile-action-attack', 'mobile-jump', 'mobile-action-page-toggle']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    ring.append(btn);
  }

  const row = document.createElement('div');
  row.id = 'mobile-combat-controls';
  const anchor = document.createElement('button');
  anchor.type = 'button';
  anchor.id = 'mobile-menu-anchor';
  anchor.className = 'mobile-btn';
  row.append(anchor);

  const moveZone = document.createElement('div');
  moveZone.id = 'mobile-move-zone';
  const moveJoystick = document.createElement('div');
  moveJoystick.id = 'mobile-move-joystick';
  moveJoystick.className = 'mobile-joystick';

  controls.append(moveZone, moveJoystick, row, ring);
  controls.insertAdjacentHTML('beforeend', STRIP_MARKUP);
  document.body.append(controls);

  const ui = document.createElement('div');
  ui.id = 'ui';
  // The band occupant the strip's width is actually bounded by. Seated with
  // inline geometry rather than the shipped aura painter: what is under test is
  // the RE-BOUND, so the fixture only has to own a box that moves.
  const buffBar = document.createElement('div');
  buffBar.id = 'buff-bar';
  buffBar.style.cssText =
    'position: fixed; top: 4px; right: 8px; height: 34px; display: flex; justify-content: flex-end;';
  const addBuff = (): HTMLElement => {
    const buff = document.createElement('div');
    buff.className = 'buff';
    buff.style.cssText = 'width: 34px; height: 34px;';
    buffBar.append(buff);
    return buff;
  };
  addBuff();
  ui.append(buffBar);
  const party = document.createElement('div');
  party.id = 'party-frames';
  party.className = 'party-present below-target has-party-chip party-expanded';
  const rows = document.createElement('div');
  rows.className = 'party-rows';
  party.append(rows);
  ui.append(party);
  document.body.append(ui);

  /** The shipped target frame's real content row: the bars column and the
   *  portrait medallion that overlaps it, which is what the CSS anchor is
   *  derived from. */
  const addTarget = (): HTMLElement => {
    const target = document.createElement('div');
    target.id = 'target-frame';
    target.className = 'unitframe';
    target.style.display = 'flex';
    const bars = document.createElement('div');
    bars.className = 'uf-bars';
    bars.textContent = 'Gravewyrm Acolyte';
    const portrait = document.createElement('div');
    portrait.className = 'portrait-wrap';
    target.append(bars, portrait);
    ui.prepend(target);
    return target;
  };

  const controller = buildQuestStrip({
    writers: makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      () => {},
      () => {},
    ),
    click: () => {},
  });
  if (!controller) throw new Error('the strip markup did not resolve');
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  return {
    controller,
    ring,
    addTarget,
    buffBar,
    addBuff,
    root: el('quest-strip'),
    surface: el('quest-strip-main'),
    title: el('quest-strip-title'),
    counter: el('quest-strip-count'),
    objective: document.querySelector('.quest-strip-obj:not(.quest-strip-more)') as HTMLElement,
    hint: el('quest-strip-hint'),
    objectives: el('quest-strip-objs'),
    prevArrow: el('quest-strip-prev'),
    nextArrow: el('quest-strip-next'),
  };
}

function pointer(type: string, clientX: number, clientY: number): MouseEvent {
  return Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY }), {
    pointerId: 1,
    pointerType: 'touch',
  });
}

/** The alpha channel of a resolved color; a plate that was removed resolves to
 *  the transparent keyword, which every engine serializes with an alpha of 0. */
function alpha(color: string): number {
  const parts = color.match(/[\d.]+/g);
  return parts && parts.length === 4 ? Number(parts[3]) : 1;
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right - EDGE_TOLERANCE_PX &&
    a.right > b.left + EDGE_TOLERANCE_PX &&
    a.top < b.bottom - EDGE_TOLERANCE_PX &&
    a.bottom > b.top + EDGE_TOLERANCE_PX
  );
}

afterEach(() => {
  cleanup();
  document.body.className = '';
  document.documentElement.style.removeProperty('--app-vw');
  document.documentElement.style.removeProperty('--app-vh');
});

describe.each(VIEWPORTS)('the touch quest strip at $label', ({ width, height, tier }) => {
  async function setup() {
    await page.viewport(width, height);
    document.body.className = `mobile-touch game-active${tier ? ` ${tier}` : ''}`;
    document.documentElement.style.setProperty('--app-vw', `${width}px`);
    document.documentElement.style.setProperty('--app-vh', `${height}px`);
    return mountHud();
  }

  it('seats itself in the top band, clear of the target frame it is derived from', async () => {
    const rig = await setup();
    rig.controller.update(quests(2), 0);

    const box = rig.root.getBoundingClientRect();
    expect(getComputedStyle(rig.root).display).not.toBe('none');
    expect(box.width).toBeGreaterThan(0);
    expect(box.top).toBeCloseTo(QUEST_STRIP_BAND_TOP_PX, 0);
    // Past the frame's real seat, with the authored clearance, and fully on
    // screen. The frame is added AFTER the strip already seated itself, which
    // is the whole point: the anchor was derived, not measured.
    const target = rig.addTarget().getBoundingClientRect();
    expect(target.width).toBeGreaterThan(0);
    expect(box.left - target.right).toBeCloseTo(QUEST_STRIP_TARGET_FRAME_GAP_PX, 0);
    expect(box.right).toBeLessThanOrEqual(width + EDGE_TOLERANCE_PX);
  });

  it('never overlaps the action ring, at ANY quest count', async () => {
    const rig = await setup();
    for (const count of [0, 1, 2, 5]) {
      rig.controller.update(quests(count, 4), 0);
      const ring = rig.ring.getBoundingClientRect();
      expect(ring.width, 'the ring must render for this pin to mean anything').toBeGreaterThan(0);
      if (count === 0) {
        // Nothing tracked: the strip is not rendered at all.
        expect(getComputedStyle(rig.root).display).toBe('none');
        continue;
      }
      const box = rig.root.getBoundingClientRect();
      expect(overlaps(box, ring), `${count} quests overlap the ring`).toBe(false);
      expect(box.bottom).toBeLessThanOrEqual(height + EDGE_TOLERANCE_PX);
    }
  });

  it('keeps a constant height as the quest count grows', async () => {
    const rig = await setup();
    const heights = new Set<number>();
    for (const count of [1, 2, 5]) {
      rig.controller.update(quests(count), 0);
      heights.add(Math.round(rig.root.getBoundingClientRect().height));
    }
    // ONE height across every count: the strip shows one quest, so the log's
    // size can no longer push anything (the whole point of replacing the
    // unbounded tracker).
    expect([...heights]).toHaveLength(1);
  });

  it('holds its left-top anchor as the shown quest gains objectives', async () => {
    const rig = await setup();
    rig.controller.update(quests(3, 1), 0);
    const start = rig.root.getBoundingClientRect();

    rig.controller.update(quests(3, 4), 0);
    const grown = rig.root.getBoundingClientRect();
    expect(grown.left).toBeCloseTo(start.left, 1);
    expect(grown.top).toBeCloseTo(start.top, 1);
    // It grew DOWNWARD from that anchor rather than moving.
    expect(grown.height).toBeGreaterThan(start.height);

    rig.controller.update(quests(3, 1), 0);
    const shrunk = rig.root.getBoundingClientRect();
    expect(shrunk.left).toBeCloseTo(start.left, 1);
    expect(shrunk.top).toBeCloseTo(start.top, 1);
  });

  it('holds a BYTE-IDENTICAL anchor with no target, with one, and after losing it', async () => {
    const rig = await setup();
    // First paint, before the player has ever had a target: the state the old
    // reservation could not seat correctly, because it had nothing to cache.
    rig.controller.update(quests(3), 0);
    const first = rig.root.getBoundingClientRect().left;
    expect(first).toBeGreaterThan(0);

    const target = rig.addTarget();
    rig.controller.update(quests(3, 3), 0);
    expect(rig.root.getBoundingClientRect().left).toBe(first);

    target.remove();
    rig.controller.update(quests(3, 2), 0);
    expect(rig.root.getBoundingClientRect().left).toBe(first);
  });

  it('re-bounds when a band occupant grows, with the quest text unchanged', async () => {
    // The strip used to enter its seat measure only when the rendered quest
    // TEXT changed, so a buff gained mid-fight (which grows the bar leftward
    // into the band) left the strip on a bound for a band that no longer
    // existed until the next quest event.
    const rig = await setup();
    const same = () => quests(3, 2);
    const cap = () => Number.parseFloat(rig.root.style.maxWidth);
    rig.controller.update(same(), 0);
    const start = rig.root.getBoundingClientRect();
    const startCap = cap();
    expect(startCap).toBeGreaterThan(0);
    expect(rig.buffBar.getBoundingClientRect().width).toBeGreaterThan(0);

    // Six more buffs: the bar grows leftward into the strip's lane.
    for (let i = 0; i < 6; i++) rig.addBuff();
    rig.controller.update(same(), 50);
    expect(cap()).toBeLessThan(startCap);
    // The tightened cap really does end the strip's lane before the bar.
    expect(rig.root.getBoundingClientRect().left).toBeCloseTo(start.left, 1);
    expect(start.left + cap()).toBeLessThanOrEqual(
      rig.buffBar.getBoundingClientRect().left + EDGE_TOLERANCE_PX,
    );
  });

  it('re-bounds within the periodic window when an occupant only gets WIDER', async () => {
    // The change no cheap signal can see: the same element, the same classes,
    // the same child count, a wider box. Only the bounded periodic sweep
    // catches it, and it must catch it inside its own window.
    const rig = await setup();
    const same = () => quests(3, 2);
    const cap = () => Number.parseFloat(rig.root.style.maxWidth);
    rig.controller.update(same(), 0);
    const startCap = cap();
    expect(startCap).toBeGreaterThan(0);

    const buff = rig.buffBar.firstElementChild as HTMLElement;
    buff.style.width = '320px';
    // Nothing the cheap key can see moved, so the sweep is what must catch it.
    for (let tick = 1; tick <= 4; tick++) rig.controller.update(same(), tick * 250);
    expect(cap()).toBeLessThan(startCap);
  });

  it('wears no plate: the text sits on the world and outlines itself', async () => {
    const rig = await setup();
    rig.controller.update(quests(3), 0);

    // Nothing paints a box behind the glyphs: no fill, no image, no plate
    // shadow. (A fully transparent background-color resolves to alpha 0.)
    for (const el of [rig.root, rig.surface]) {
      const style = getComputedStyle(el);
      expect(style.backgroundImage).toBe('none');
      expect(style.boxShadow).toBe('none');
      expect(alpha(style.backgroundColor)).toBe(0);
    }

    // So every glyph carries its own edge instead, the reciprocal outline the
    // overhead nameplates use.
    for (const el of [rig.title, rig.counter, rig.objective, rig.prevArrow, rig.nextArrow]) {
      expect(getComputedStyle(el).textShadow, el.className || el.id).not.toBe('none');
    }
  });

  it('keeps a visible focus ring now that the plate is gone', async () => {
    const rig = await setup();
    rig.controller.update(quests(3), 0);
    rig.surface.focus();
    const style = getComputedStyle(rig.surface);
    // The ring was never the panel's border, and it must not have left with it.
    expect(style.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThan(0);
  });

  it('keeps a hit surface bigger than the text block, and bigger than the touch floor', async () => {
    const rig = await setup();
    // The smallest the visual box ever gets: one quest, one objective.
    rig.controller.update(quests(1, 1), 0);
    const box = rig.surface.getBoundingClientRect();

    // A touch just OUTSIDE the text block still lands on the strip: the pad is a
    // constant, so it does not shrink with the box the way padding would.
    const outside = document.elementFromPoint(box.left - 6, box.top + box.height / 2);
    expect(outside === rig.surface || rig.surface.contains(outside)).toBe(true);
    const above = document.elementFromPoint(box.left + box.width / 2, box.top - 6);
    expect(above === rig.surface || rig.surface.contains(above)).toBe(true);
    // And the block itself already clears the touch floor at its smallest.
    expect(box.height).toBeGreaterThanOrEqual(30);
  });

  it('cycles on a tap and on a swipe, in both directions', async () => {
    const rig = await setup();
    rig.controller.update(quests(3), 0);
    const box = rig.surface.getBoundingClientRect();
    const y = box.top + box.height / 2;
    const x = box.left + box.width / 2;
    const first = rig.title.textContent;
    expect(rig.counter.textContent).toBe('1/3');

    rig.surface.dispatchEvent(pointer('pointerdown', x, y));
    rig.surface.dispatchEvent(pointer('pointerup', x, y));
    expect(rig.counter.textContent).toBe('2/3');
    expect(rig.title.textContent).not.toBe(first);

    // Swipe LEFT advances (the carousel convention), swipe RIGHT goes back.
    rig.surface.dispatchEvent(pointer('pointerdown', x, y));
    rig.surface.dispatchEvent(pointer('pointerup', x - SWIPE_PX, y));
    expect(rig.counter.textContent).toBe('3/3');
    rig.surface.dispatchEvent(pointer('pointerdown', x, y));
    rig.surface.dispatchEvent(pointer('pointerup', x + SWIPE_PX, y));
    expect(rig.counter.textContent).toBe('2/3');
  });

  it('exposes the objective progress to assistive tech, not only to the eye', async () => {
    const rig = await setup();
    rig.controller.update(quests(3, 2), 0);
    // NO aria-label: one on a button REPLACES its whole subtree for name
    // computation, so the objective lines the sighted touch player reads were
    // never announced at all. The name comes from the strip's own nodes and the
    // objectives are the DESCRIPTION.
    expect(rig.surface.hasAttribute('aria-label')).toBe(false);
    expect(rig.surface.getAttribute('aria-labelledby')).toBe(
      'quest-strip-title quest-strip-complete quest-strip-count',
    );
    expect(rig.surface.getAttribute('aria-describedby')).toBe('quest-strip-objs quest-strip-hint');

    // Every referenced id resolves to a real, non-empty node in the rendered
    // tree, which is what a name/description computation would walk.
    const textOf = (attr: string) =>
      (rig.surface.getAttribute(attr) ?? '')
        .split(' ')
        .map((id) => {
          const node = document.getElementById(id);
          expect(node, `${attr} points at a missing #${id}`).not.toBeNull();
          return node?.textContent ?? '';
        })
        .join(' ');
    const name = textOf('aria-labelledby');
    const description = textOf('aria-describedby');
    expect(name).toContain(rig.title.textContent ?? '');
    expect(name).toContain('1/3');
    // The progress counts: the information the aria-label used to swallow.
    expect(description).toMatch(/\d+\/\d+/);
    expect(description).toContain('Gravewyrm Acolyte 1 slain');
    expect(rig.hint.textContent?.length ?? 0).toBeGreaterThan(0);

    // The NAME tracks the selection, because it is computed from the same nodes
    // the strip repaints rather than from a stamped-on string.
    rig.controller.cycle(1);
    expect(textOf('aria-labelledby')).toContain(rig.title.textContent ?? '');
    expect(textOf('aria-labelledby')).toContain('2/3');
  });

  it('switches to the quest that just made progress, and stays laid out', async () => {
    const rig = await setup();
    const tracked = quests(3, 2);
    rig.controller.update(tracked, 1000);
    expect(rig.counter.textContent).toBe('1/3');
    const anchorLeft = rig.root.getBoundingClientRect().left;

    // The only mutation is a kill credit on the THIRD quest's first objective.
    const progressed = quests(3, 2);
    progressed[2].objectives = [
      { ...progressed[2].objectives[0], current: progressed[2].objectives[0].current + 1 },
      progressed[2].objectives[1],
    ];
    rig.controller.update(progressed, 1050);

    expect(rig.counter.textContent).toBe('3/3');
    expect(rig.title.textContent).toBe(tracked[2].title);
    expect(rig.objective.textContent).toContain('1/6');
    // The switch repaints the content; the learned anchor must not move with it.
    expect(rig.root.getBoundingClientRect().left).toBeCloseTo(anchorLeft, 1);
  });
});
