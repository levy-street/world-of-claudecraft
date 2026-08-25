// @vitest-environment happy-dom
// What only a DOM can show about the touch quest strip. The arithmetic has its
// own suite (quest_strip_core.test.ts) and is not repeated here: this covers the
// wiring around it, which is where the strip can actually break.
//
//   - the cycle gestures through real pointer events (tap advances, swipe LEFT
//     advances, swipe RIGHT goes back, both wrapping), plus the assistive click
//     path that emits no pointer events at all,
//   - the rendered strings, so the objective cap and the "+N more" overflow are
//     pinned against the real t() catalog rather than a stub,
//   - the handoff: on touch the tracker stops rendering its own markup and the
//     strip is fed the SAME projection, which is what makes this a second
//     presentation rather than a second data model,
//   - and the seat: the painter writes a max-width and nothing else, and the
//     target frame coming or going changes not one byte of it. The strip used
//     to reserve that frame's MEASURED box, so it started at the screen edge and
//     slid right the first time the player targeted anything; the anchor is
//     hud.mobile.css's now (--quest-strip-anchor-left) and the real resolved
//     value is pinned in tests/browser/quest_strip.browser.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QUESTS } from '../src/sim/data';
import type { QuestProgress } from '../src/sim/types';
import { buildQuestStrip } from '../src/ui/hud/quest/quest_strip_controller';
import { QUEST_STRIP_MAX_OBJECTIVES } from '../src/ui/hud/quest/quest_strip_core';
import type { TrackedQuest } from '../src/ui/hud/quest/quest_tracker';
import { QuestTrackerController } from '../src/ui/hud/quest/quest_tracker_controller';
import * as i18nModule from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import type { IWorld } from '../src/world_api';

/** A private facet per rig: the controller takes Hud's shared one in
 *  production, and a test needs only the elision behaviour. */
function writers() {
  return makeWriterFacet(
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    () => {},
    () => {},
  );
}

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

function quest(id: string, objectiveCount = 1): TrackedQuest {
  return {
    id,
    number: 1,
    title: `Title ${id}`,
    complete: false,
    objectives: Array.from({ length: objectiveCount }, (_unused, index) => ({
      label: `Objective ${index}`,
      current: index,
      total: 3,
    })),
  };
}

function mountStrip() {
  const controls = document.createElement('section');
  controls.id = 'mobile-controls';
  controls.innerHTML = STRIP_MARKUP;
  document.body.append(controls);
  document.body.classList.add('mobile-touch');
  const click = vi.fn();
  const controller = buildQuestStrip({ writers: writers(), click });
  if (!controller) throw new Error('the strip markup did not resolve');
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  return {
    controller,
    click,
    root: el('quest-strip'),
    surface: el('quest-strip-main'),
    title: el('quest-strip-title'),
    counter: el('quest-strip-count'),
    more: el('quest-strip-more'),
    hint: el('quest-strip-hint'),
    objectives: [
      ...document.querySelectorAll<HTMLElement>('.quest-strip-obj:not(.quest-strip-more)'),
    ],
  };
}

function pointer(type: string, clientX: number): MouseEvent {
  return Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY: 20 }), {
    pointerId: 1,
    pointerType: 'touch',
  });
}

function swipe(surface: HTMLElement, dx: number): void {
  surface.dispatchEvent(pointer('pointerdown', 200));
  surface.dispatchEvent(pointer('pointerup', 200 + dx));
}

beforeEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
});

describe('the quest strip cycles through real pointer events', () => {
  it('advances on a tap and wraps at the end', () => {
    const rig = mountStrip();
    rig.controller.update([quest('a'), quest('b')], 0);
    expect(rig.title.textContent).toBe('Title a');

    swipe(rig.surface, 0);
    expect(rig.title.textContent).toBe('Title b');
    swipe(rig.surface, 0);
    expect(rig.title.textContent).toBe('Title a');
    // The tap confirms itself audibly, the same click every HUD control plays.
    expect(rig.click).toHaveBeenCalledTimes(2);
  });

  it('advances on a swipe LEFT and goes back on a swipe RIGHT, wrapping both ways', () => {
    const rig = mountStrip();
    rig.controller.update([quest('a'), quest('b'), quest('c')], 0);

    swipe(rig.surface, -SWIPE_PX);
    expect(rig.title.textContent).toBe('Title b');
    swipe(rig.surface, SWIPE_PX);
    expect(rig.title.textContent).toBe('Title a');
    // Backwards off the start lands on the LAST quest, not on nothing.
    swipe(rig.surface, SWIPE_PX);
    expect(rig.title.textContent).toBe('Title c');
  });

  it('advances on a bare click, the path assistive tech takes', () => {
    const rig = mountStrip();
    rig.controller.update([quest('a'), quest('b')], 0);
    rig.surface.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.title.textContent).toBe('Title b');
  });

  it('does not double-cycle when a gesture is followed by its synthetic click', () => {
    const rig = mountStrip();
    rig.controller.update([quest('a'), quest('b'), quest('c')], 0);
    swipe(rig.surface, -SWIPE_PX);
    // detail 1: a browser-synthesized compatibility click carries a click count,
    // which is what separates it from the assistive path above.
    rig.surface.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(rig.title.textContent).toBe('Title b');
  });

  it('lets an assistive click through after a swipe that fired no click at all', () => {
    const rig = mountStrip();
    rig.controller.update([quest('a'), quest('b'), quest('c')], 0);
    // Past the browser's tap slop, so no compatibility click follows the release
    // and the suppression it armed is left standing.
    swipe(rig.surface, -SWIPE_PX);
    expect(rig.title.textContent).toBe('Title b');
    // The next activation is click-only (VoiceOver, Switch Control, Enter on the
    // focused button). A latched suppression used to swallow it whole.
    rig.surface.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(rig.title.textContent).toBe('Title c');
  });

  it('clears a stale suppression at the next press, never carrying it into a tap', () => {
    const rig = mountStrip();
    rig.controller.update([quest('a'), quest('b'), quest('c')], 0);
    swipe(rig.surface, -SWIPE_PX);
    // A real tap now, with its own compatibility click: the press clears what the
    // swipe left behind, and the release arms it again for exactly this click.
    swipe(rig.surface, 0);
    rig.surface.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(rig.title.textContent).toBe('Title c');
  });

  it('cycles nowhere with a single tracked quest, and hides the position hint', () => {
    const rig = mountStrip();
    rig.controller.update([quest('a')], 0);
    expect(document.getElementById('quest-strip-cycle')?.style.display).toBe('none');
    swipe(rig.surface, -SWIPE_PX);
    expect(rig.title.textContent).toBe('Title a');
    expect(rig.click).not.toHaveBeenCalled();
  });

  it('drops a gesture the button never sees through the window backstop', () => {
    const rig = mountStrip();
    rig.controller.update([quest('a'), quest('b')], 0);
    rig.surface.dispatchEvent(pointer('pointerdown', 200));
    expect(rig.surface.classList.contains('gesturing')).toBe(true);
    window.dispatchEvent(pointer('pointerup', 900));
    expect(rig.surface.classList.contains('gesturing')).toBe(false);
    // Dropped, not resolved: a release the strip never saw cycles nothing.
    expect(rig.title.textContent).toBe('Title a');
  });
});

describe('the quest strip renders one quest in full', () => {
  it('shows the position, every objective, and the overflow line past the cap', () => {
    const rig = mountStrip();
    const many = quest('a', QUEST_STRIP_MAX_OBJECTIVES + 2);
    rig.controller.update([many, quest('b')], 0);

    expect(rig.counter.textContent).toBe('1/2');
    const shown = rig.objectives.filter((el) => el.style.display !== 'none');
    expect(shown).toHaveLength(QUEST_STRIP_MAX_OBJECTIVES);
    expect(shown[0].textContent).toContain('Objective 0');
    expect(shown[0].textContent).toContain('0/3');
    // A met objective is marked done rather than dropped.
    expect(shown[3].classList.contains('done')).toBe(true);
    expect(rig.more.textContent).toBe('+2 more');
    expect(rig.more.style.display).not.toBe('none');
  });

  it('names the button from its own nodes and describes it with the objectives', () => {
    const rig = mountStrip();
    rig.controller.update([quest('a', 2), quest('b'), quest('c')], 0);
    // NO aria-label: one on a button REPLACES its subtree for name computation,
    // which is what hid the objective progress from assistive tech entirely.
    expect(rig.surface.hasAttribute('aria-label')).toBe(false);
    // The name is the title, the complete marker and the position, all real
    // nodes the painter already writes, so it moves with what is rendered.
    expect(rig.surface.getAttribute('aria-labelledby')).toBe(
      'quest-strip-title quest-strip-complete quest-strip-count',
    );
    expect(rig.title.textContent).toBe('Title a');
    expect(rig.counter.textContent).toContain('1');
    expect(rig.counter.textContent).toContain('3');
    // The objectives are the DESCRIPTION, beside the activation hint, so the
    // progress a sighted touch player reads is announced too.
    expect(rig.surface.getAttribute('aria-describedby')).toBe('quest-strip-objs quest-strip-hint');
    const described = rig.surface
      .getAttribute('aria-describedby')
      ?.split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain('Objective 0');
    expect(described).toContain('0/3');
    expect(described).toContain('Title a');
    // With nothing to cycle to the hint drops the position instead of saying
    // "1 of 1" and promising a cycle that does nothing.
    rig.controller.update([quest('a')], 0);
    expect(rig.hint.textContent).not.toContain('1 of 1');
    expect(rig.hint.textContent).toContain('Title a');
  });

  it('marks a quest that is ready to turn in', () => {
    const rig = mountStrip();
    const ready = { ...quest('a'), complete: true };
    const mark = document.getElementById('quest-strip-complete') as HTMLElement;
    rig.controller.update([quest('b')], 0);
    expect(mark.style.display).toBe('none');
    rig.controller.update([ready], 0);
    expect(mark.textContent).toBe('(Complete)');
    expect(mark.style.display).not.toBe('none');
  });

  it('hides itself with nothing tracked and comes back with the next quest', () => {
    const rig = mountStrip();
    rig.controller.update([], 0);
    expect(rig.root.classList.contains('empty')).toBe(true);
    rig.controller.update([quest('a')], 0);
    expect(rig.root.classList.contains('empty')).toBe(false);
  });

  it('holds the selection as the tracked set shrinks under it', () => {
    const rig = mountStrip();
    rig.controller.update([quest('a'), quest('b'), quest('c')], 0);
    swipe(rig.surface, -SWIPE_PX);
    swipe(rig.surface, -SWIPE_PX);
    expect(rig.title.textContent).toBe('Title c');
    // Turning in the first quest must not throw the player back to the top of
    // the list mid-fight; the index clamps to the new end instead.
    rig.controller.update([quest('a'), quest('b')], 0);
    expect(rig.title.textContent).toBe('Title b');
  });
});

describe('the tracker hands its projection to the strip on touch', () => {
  function progress(questId: string): QuestProgress {
    return {
      questId,
      state: 'active',
      counts: QUESTS[questId].objectives.map(() => 0),
    };
  }

  function mountTracker(entries: QuestProgress[]) {
    const rig = mountStrip();
    const element = document.createElement('div');
    element.id = 'quest-tracker';
    document.body.append(element);
    const questLog = new Map(entries.map((entry) => [entry.questId, entry]));
    const controller = new QuestTrackerController({
      writers: writers(),
      element,
      document,
      world: () => ({ questLog }) as Pick<IWorld, 'questLog'>,
      settings: {
        available: () => true,
        collapsed: () => false,
        setCollapsed: () => {},
      },
      questTitle: (questId) => `title:${questId}`,
      objectiveLabel: (questId, index) => `objective:${questId}:${index}`,
      click: () => {},
    });
    return { ...rig, element, controller };
  }

  it('renders the strip and NOT the right-anchored markup while touch is live', () => {
    const rig = mountTracker([progress('q_wolves'), progress('q_boars')]);
    rig.controller.update(0);
    expect(rig.element.innerHTML).toBe('');
    expect(rig.title.textContent).toBe('title:q_wolves');
    expect(rig.counter.textContent).toBe('1/2');
  });

  it('renders the right-anchored markup and leaves the strip alone off touch', () => {
    const rig = mountTracker([progress('q_wolves')]);
    document.body.classList.remove('mobile-touch');
    rig.controller.update(0);
    expect(rig.element.innerHTML).toContain('title:q_wolves');
    expect(rig.root.classList.contains('empty')).toBe(true);
  });
});

describe('the strip is seated by CSS, never by the painter', () => {
  const CONTAINER_RECT = { left: 0, right: 874, top: 0, bottom: 402 };
  /** Where hud.mobile.css seats the strip on this tier: past the target frame's
   *  STATIC seat, whether or not a frame is there. */
  const ANCHOR_RECT = { left: 276, right: 500, top: 6, bottom: 46 };
  const TARGET_RECT = { left: 6, right: 250, top: 6, bottom: 47 };

  function stubRect(
    el: Element,
    rect: { left: number; right: number; top: number; bottom: number },
  ) {
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }),
    });
  }

  /** happy-dom reports a zero box for everything, so the seat would early-return
   *  and every pin below would pass vacuously. Stub the two boxes the seat
   *  actually reads instead. */
  function mountSeated() {
    const rig = mountStrip();
    stubRect(rig.root.parentElement as Element, CONTAINER_RECT);
    stubRect(rig.root, ANCHOR_RECT);
    return rig;
  }

  function addTargetFrame(): HTMLElement {
    const frame = document.createElement('div');
    frame.id = 'target-frame';
    document.body.append(frame);
    stubRect(frame, TARGET_RECT);
    return frame;
  }

  it('writes a max-width and nothing else', () => {
    const rig = mountSeated();
    rig.controller.update([quest('a', 2)], 0);
    expect(rig.root.style.maxWidth).not.toBe('');
    // The anchor is the stylesheet's; an inline left or top here would be the
    // painter taking it back.
    expect(rig.root.style.left).toBe('');
    expect(rig.root.style.top).toBe('');
  });

  it('writes the same bound with, without, and after losing a target frame', () => {
    const rig = mountSeated();
    rig.controller.update([quest('a', 2)], 0);
    const untargeted = rig.root.getAttribute('style');
    expect(untargeted).toBeTruthy();

    const frame = addTargetFrame();
    rig.controller.update([quest('a', 3)], 0);
    expect(rig.root.getAttribute('style')).toBe(untargeted);

    frame.remove();
    rig.controller.update([quest('a', 2)], 0);
    expect(rig.root.getAttribute('style')).toBe(untargeted);
  });

  it('lets a band occupant right of the anchor cap the width', () => {
    // The one thing still measured: the buff bar grows leftward, so how far the
    // strip may run is a real measure even though where it starts is not.
    const rig = mountSeated();
    const buffs = document.createElement('div');
    buffs.id = 'buff-bar';
    document.body.append(buffs);
    stubRect(buffs, { left: 681, right: 860, top: 4, bottom: 40 });
    rig.controller.update([quest('a', 2)], 0);
    // 681 - QUEST_STRIP_BAND_GAP_PX (10) - the 276px anchor.
    expect(rig.root.style.maxWidth).toBe('395px');
    expect(rig.root.style.left).toBe('');
  });
});

// The seat used to be ENTERED only when the rendered quest TEXT changed, so its
// own cheap key (viewport, body class, root style) could never be consulted:
// a rotation, a tier flip, and every band occupant coming or going left the
// strip on a bound measured for a band that no longer existed.
describe('the strip re-seats without the quest text changing', () => {
  const CONTAINER_RECT = { left: 0, right: 874, top: 0, bottom: 402 };
  const ANCHOR_RECT = { left: 276, right: 500, top: 6, bottom: 46 };

  function stubRect(
    el: Element,
    rect: { left: number; right: number; top: number; bottom: number },
  ) {
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }),
    });
  }

  /** The strip plus one band occupant (the buff bar), whose box the test moves.
   *  Occupants are shell-static, so they are mounted before the first seat. */
  function mountWithBuffBar() {
    const rig = mountStrip();
    stubRect(rig.root.parentElement as Element, CONTAINER_RECT);
    stubRect(rig.root, ANCHOR_RECT);
    const buffs = document.createElement('div');
    buffs.id = 'buff-bar';
    document.body.append(buffs);
    stubRect(buffs, { left: 681, right: 860, top: 4, bottom: 40 });
    return { ...rig, buffs };
  }

  /** The SAME rendered strings every call, so nothing in the content signature
   *  can be what moves the bound. */
  const sameQuest = () => [quest('a', 2)];

  it('re-seats on a body-class change (a tier flip) with identical quest text', () => {
    const { controller, root, buffs } = mountWithBuffBar();
    controller.update(sameQuest(), 0);
    expect(root.style.maxWidth).toBe('395px');
    // The tier flip moves the buff bar; the quest text does not move at all.
    stubRect(buffs, { left: 601, right: 860, top: 4, bottom: 40 });
    document.body.classList.add('mobile-landscape');
    controller.update(sameQuest(), 50);
    expect(root.style.maxWidth).toBe('315px');
  });

  it('re-seats when a band occupant gains content', () => {
    const { controller, root, buffs } = mountWithBuffBar();
    controller.update(sameQuest(), 0);
    expect(root.style.maxWidth).toBe('395px');
    // A buff gained: the bar grows leftward, and its child count is the cheap
    // non-layout signal the key reads for it.
    buffs.append(document.createElement('div'));
    stubRect(buffs, { left: 621, right: 860, top: 4, bottom: 40 });
    controller.update(sameQuest(), 50);
    expect(root.style.maxWidth).toBe('335px');
  });

  it('re-measures within the bounded periodic window when only a WIDTH moved', () => {
    // The occupant change no cheap signal can see: same element, same classes,
    // same child count, wider box (a longer zone name, a stack count growing).
    // The periodic sweep is what catches it, inside SEAT_REMEASURE_TICKS ticks.
    const { controller, root, buffs } = mountWithBuffBar();
    controller.update(sameQuest(), 0);
    expect(root.style.maxWidth).toBe('395px');
    stubRect(buffs, { left: 561, right: 860, top: 4, bottom: 40 });
    // Nothing the cheap key can see moved, so the bound holds until the sweep
    // lands on the SEAT_REMEASURE_TICKS'th tracker tick.
    for (let tick = 1; tick <= 2; tick++) controller.update(sameQuest(), tick * 50);
    expect(root.style.maxWidth).toBe('395px');
    controller.update(sameQuest(), 150);
    expect(root.style.maxWidth).toBe('275px');
  });
});

describe('a quest that progresses takes the strip', () => {
  /** The tracked quest as the tracker projects it, with one countable objective. */
  function counted(id: string, current: number, complete = false): TrackedQuest {
    return {
      id,
      number: 1,
      title: `Title ${id}`,
      complete,
      objectives: [{ label: 'Objective 0', current, total: 3 }],
    };
  }

  it('switches to the quest that just earned credit', () => {
    const rig = mountStrip();
    rig.controller.update([counted('a', 0), counted('b', 0)], 1000);
    expect(rig.title.textContent).toBe('Title a');
    rig.controller.update([counted('a', 0), counted('b', 1)], 1050);
    expect(rig.title.textContent).toBe('Title b');
    expect(rig.counter.textContent).toBe('2/2');
    // Silent: the click is the player's own confirmation of a tap, and this
    // switch is not one.
    expect(rig.click).not.toHaveBeenCalled();
  });

  it('switches to a quest that just turned complete', () => {
    const rig = mountStrip();
    rig.controller.update([counted('a', 3), counted('b', 0)], 1000);
    swipe(rig.surface, -SWIPE_PX);
    expect(rig.title.textContent).toBe('Title b');
    // Past the grace, so the completion is free to take the band back.
    rig.controller.update([counted('a', 3, true), counted('b', 0)], 20_000);
    expect(rig.title.textContent).toBe('Title a');
  });

  it('leaves a hand cycle alone for the grace window, then yields', () => {
    const rig = mountStrip();
    rig.controller.update([counted('a', 0), counted('b', 0)], 1000);
    swipe(rig.surface, -SWIPE_PX);
    expect(rig.title.textContent).toBe('Title b');
    // Inside the grace: credit on quest 'a' must not yank the strip off the
    // quest the player just swiped to and is reading.
    rig.controller.update([counted('a', 1), counted('b', 0)], 2000);
    expect(rig.title.textContent).toBe('Title b');
    // Past it, the next credit moves the band.
    rig.controller.update([counted('a', 2), counted('b', 0)], 20_000);
    expect(rig.title.textContent).toBe('Title a');
  });

  it('does not move for a newly accepted quest', () => {
    const rig = mountStrip();
    rig.controller.update([counted('a', 0)], 1000);
    rig.controller.update([counted('a', 0), counted('b', 0)], 2000);
    expect(rig.title.textContent).toBe('Title a');
  });
});

// The strip used to run its full t()/formatNumber resolve on every medium-band
// tick, keyed off the RENDERED strings it had just produced, so it could only
// ever elide the DOM write and never the resolve behind it. It now gates the
// resolve on a raw pre-resolve key (quest id, objective current/total/done,
// counter position/total, the overflow count, plus a locale generation) and
// reuses the last resolved model whenever that key holds.
describe('the resolve is elided against a raw pre-resolve key', () => {
  it('performs zero t() calls on a tick with unchanged quest data', () => {
    const rig = mountStrip();
    const quests = [quest('a', 1)];
    rig.controller.update(quests, 0);
    const tSpy = vi.spyOn(i18nModule, 't');
    // A fresh array with byte-identical quest data, not the same reference:
    // the key is built from raw fields, never object identity.
    rig.controller.update([quest('a', 1)], 50);
    expect(tSpy).not.toHaveBeenCalled();
    tSpy.mockRestore();
  });

  it('resolves exactly once when a quest-progress tick actually changes the data', () => {
    const rig = mountStrip();
    rig.controller.update([quest('a', 1)], 0);
    const warmSpy = vi.spyOn(i18nModule, 't');
    rig.controller.update([quest('a', 1)], 50);
    const coldResolveCallCount = warmSpy.mock.calls.length;
    warmSpy.mockRestore();
    expect(coldResolveCallCount).toBe(0);

    const baselineSpy = vi.spyOn(i18nModule, 't');
    // Re-resolve once from a clean cache to learn how many t() calls one full
    // resolve of this exact model performs, without hardcoding that count.
    rig.controller.relocalize();
    const oneResolveCallCount = baselineSpy.mock.calls.length;
    baselineSpy.mockRestore();
    expect(oneResolveCallCount).toBeGreaterThan(0);

    const progressed = {
      ...quest('a', 1),
      objectives: [{ label: 'Objective 0', current: 2, total: 3 }],
    };
    const progressSpy = vi.spyOn(i18nModule, 't');
    rig.controller.update([progressed], 100);
    expect(progressSpy).toHaveBeenCalledTimes(oneResolveCallCount);
    progressSpy.mockRestore();
    expect(rig.objectives[0]?.textContent).toContain('2');
  });

  it('relocalize() forces a resolve with identical quest data', () => {
    const rig = mountStrip();
    const quests = [quest('a', 1)];
    rig.controller.update(quests, 0);
    const settledSpy = vi.spyOn(i18nModule, 't');
    rig.controller.update(quests, 50);
    expect(settledSpy).not.toHaveBeenCalled();
    settledSpy.mockRestore();

    const relocalizeSpy = vi.spyOn(i18nModule, 't');
    rig.controller.relocalize();
    expect(relocalizeSpy.mock.calls.length).toBeGreaterThan(0);
    relocalizeSpy.mockRestore();
  });
});
