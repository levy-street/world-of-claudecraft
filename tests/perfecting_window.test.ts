// @vitest-environment happy-dom
//
// The Perfecting window painter (Masterwrought phase 14):
// src/ui/hud/professions/perfecting_window.ts over real DOM, with the world
// answered through the REAL perfectingInfoFrom (both hosts' idiom), a
// recording perfectItem, and fake timers driving the 1 Hz convergence clock.
// Covers the radiogroup semantics, the aria-busy send-once lifecycle
// (including the error-toast clear and the mirrors-answered clear), the R2
// bind-warning confirm step, the focus-key carry across a repaint, and the
// naming dialog's cap, shape guidance, and submit debounce (the msg_lanes
// name_screen obligation).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({
  audio: {
    perfectingAttempt: vi.fn(),
    perfectingSuccess: vi.fn(),
    legendaryForged: vi.fn(),
    click: vi.fn(),
  },
}));

import { MSG_LANE_NAME_SCREEN_REFILL_PER_SECOND } from '../server/msg_lanes';
import { audio } from '../src/game/audio';
import { MAX_LEGENDARY_NAME_LENGTH } from '../src/sim/professions/legendary_name';
import {
  PERFECTING_SKILL_REQ,
  type PerfectItemRef,
  perfectingInfoFrom,
} from '../src/sim/professions/perfecting';
import type { EquipSlot, InvSlot, ItemInstancePayload } from '../src/sim/types';
import { NAME_SUBMIT_LOCK_MS, PerfectingWindow } from '../src/ui/hud/professions/index';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import type { IWorld } from '../src/world_api';

const APEX = 'duskforged_warblade';

class FakeWorld {
  equipment: Partial<Record<EquipSlot, string>> = { mainhand: APEX };
  equipmentInstances: Partial<Record<EquipSlot, ItemInstancePayload>> = {};
  inventory: InvSlot[] = [
    { itemId: 'makers_ember', count: 2 },
    { itemId: 'sundered_essence', count: 1 },
    { itemId: 'prismglass_setting', count: 3 },
  ];
  craftingIdentity = { synced: true };
  craftSkills: Record<string, number> = { weaponcrafting: PERFECTING_SKILL_REQ };
  perfectItem = vi.fn();
  perfectingInfo(ref: PerfectItemRef) {
    return perfectingInfoFrom({
      ref,
      inventory: this.inventory,
      equipment: this.equipment,
      equipmentInstances: this.equipmentInstances,
      craftSkills: this.craftSkills,
    });
  }
}

let world: FakeWorld;

type WindowDeps = ConstructorParameters<typeof PerfectingWindow>[0];

const makeWindow = (overrides: Partial<WindowDeps> = {}): PerfectingWindow =>
  new PerfectingWindow({
    itemIcon: () => '<img class="icon">',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
    world: () => world as unknown as IWorld,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    ...overrides,
  });

const root = (): HTMLElement => document.getElementById('perfecting-window') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  world = new FakeWorld();
  document.body.innerHTML = '<div id="ui"></div><div id="prompt-stack"></div>';
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('radiogroup semantics (the plant sheet shape)', () => {
  it('rows are natively tabbable radios in a title-labelled group', () => {
    world.inventory.push({ itemId: 'wyrmfall_pendant', count: 1 });
    const win = makeWindow();
    win.open();
    const group = root().querySelector('[role="radiogroup"]') as HTMLElement;
    expect(group.getAttribute('aria-labelledby')).toBe('perfecting-title');
    const radios = [...root().querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    expect(radios.length).toBe(2);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    // Every radio is a real button (natively tabbable; no roving tabindex,
    // the recorded OPEN follow-up).
    for (const radio of radios) expect(radio.tagName).toBe('BUTTON');
    radios[1].click();
    const after = [...root().querySelectorAll('[role="radio"]')];
    expect(after.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);
  });

  it('the dialog root is marked and the empty state renders without candidates', () => {
    world.equipment = {};
    world.inventory = [];
    const win = makeWindow();
    win.open();
    expect(root().getAttribute('role')).toBe('dialog');
    expect(root().getAttribute('aria-labelledby')).toBe('perfecting-title');
    // The empty state rides the shared professions family class (the
    // unification slice's .prof-empty), not a bespoke pf- one.
    expect(root().querySelector('.prof-empty')).not.toBeNull();
    expect(root().querySelector('[data-action]')).toBeNull();
  });

  it('the rank track rides the shared professions track family (phase 14)', () => {
    world.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 1 } };
    const win = makeWindow();
    win.open();
    // One presentation family for the journal's growth stages and this rank
    // track: the shared prof-track classes carry the anatomy, the pf-
    // classes stay only for the settled-state fills keyed off data-state.
    const track = root().querySelector('.prof-track.pf-track') as HTMLElement;
    expect(track).not.toBeNull();
    const steps = track.querySelector('.prof-track-steps') as HTMLElement;
    expect(steps.getAttribute('aria-hidden')).toBe('true');
    expect(steps.querySelectorAll('.prof-track-step.pf-step').length).toBeGreaterThan(0);
    expect(track.querySelector('.prof-track-text.pf-track-label')).not.toBeNull();
  });
});

describe('the aria-busy send-once lifecycle', () => {
  beforeEach(() => {
    // A BOUND, mid-track copy: no bind confirm in the way of the send path.
    world.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 1 } };
  });

  it('an attempt sends once, arms aria-busy, and swallows the double click', () => {
    const win = makeWindow();
    win.open();
    const action = root().querySelector('[data-action]') as HTMLButtonElement;
    expect(action.disabled).toBe(false);
    action.click();
    expect(world.perfectItem).toHaveBeenCalledTimes(1);
    expect(world.perfectItem).toHaveBeenCalledWith({ slot: 'mainhand' });
    expect((audio.perfectingAttempt as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(root().getAttribute('aria-busy')).toBe('true');
    action.click();
    expect(world.perfectItem).toHaveBeenCalledTimes(1);
  });

  it('the Hud error-toast forward re-arms the control (the deny answer)', () => {
    const win = makeWindow();
    win.open();
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    expect(root().getAttribute('aria-busy')).toBe('true');
    win.notifyErrorToast();
    expect(root().getAttribute('aria-busy')).toBe('false');
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    expect(world.perfectItem).toHaveBeenCalledTimes(2);
  });

  it('a repaint where the selected info signature moved clears it and cues success', () => {
    const win = makeWindow();
    win.open();
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    expect(root().getAttribute('aria-busy')).toBe('true');
    // The mirrors answer: a material spent and the rank advanced.
    world.inventory[0].count -= 1;
    world.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 2 } };
    vi.advanceTimersByTime(1000);
    expect(root().getAttribute('aria-busy')).toBe('false');
    expect((audio.perfectingSuccess as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(root().textContent).toContain('Rank 2 of 4');
  });

  it('announces a landed rank and the Perfected stamp through the persistent status region', () => {
    const win = makeWindow();
    win.open();
    const live = root().querySelector('.pf-live-status') as HTMLElement;
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent).toBe('');
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    world.inventory[0].count -= 1;
    world.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 2 } };
    vi.advanceTimersByTime(1000);
    // The SAME node persists across the repaint (a region that re-enters the
    // tree drops or repeats its announcements) and carries a fresh span
    // naming the item.
    expect(root().querySelector('.pf-live-status')).toBe(live);
    expect(live.textContent).toContain('rank 2 of 4');
    expect(live.textContent).toContain('Duskforged Warblade');
    expect(live.children.length).toBe(1);
    // A byte-identical repeat still lands a FRESH span (the discipline's
    // whole point): drop back and re-land the same rank text.
    const firstSpan = live.firstElementChild;
    world.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 1 } };
    vi.advanceTimersByTime(1000);
    world.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 2 } };
    vi.advanceTimersByTime(1000);
    expect(live.textContent).toContain('rank 2 of 4');
    expect(live.firstElementChild).not.toBe(firstSpan);
    // The Perfected flip outranks a same-frame rank line.
    world.equipmentInstances = { mainhand: { boundTo: 1, perfected: true } };
    vi.advanceTimersByTime(1000);
    expect(live.textContent).toContain('is now Perfected');
    // The landed promotion announces with the chosen name (the dialog
    // auto-dismisses on it, so this line is the reader's confirmation).
    world.equipmentInstances = {
      mainhand: { boundTo: 1, perfected: true, rolled: { quality: 'legendary' }, name: 'Oath' },
    };
    vi.advanceTimersByTime(1000);
    expect(live.textContent).toContain('forged as Oath');
    // A language switch clears the standing announcement (old-locale text).
    win.relocalize();
    expect(live.textContent).toBe('');
    // Close clears a FRESH announcement (decisive: land one first, then
    // close; without the clock advance this arm was vacuous).
    world.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 3 } };
    vi.advanceTimersByTime(1000);
    expect(live.textContent).not.toBe('');
    win.close();
    expect(live.textContent).toBe('');
  });

  it('an unchanged world ticks without repainting (the signature gate)', () => {
    // Decisive against deleting the tick's signature compare: the itemIcon
    // dep is re-invoked by every real rebuild (each candidate and material
    // row resolves an icon), so its call count is the rebuild count. The
    // earlier marker/innerHTML shape survived a repaint (paintFrom rewrites
    // only the inner .pf-shell) and asserted nothing.
    const itemIcon = vi.fn(() => '<img class="icon">');
    const win = makeWindow({ itemIcon });
    win.open();
    const paintedOnce = itemIcon.mock.calls.length;
    expect(paintedOnce).toBeGreaterThan(0);
    vi.advanceTimersByTime(3000);
    // Three 1 Hz ticks over a byte-identical world: zero rebuilds.
    expect(itemIcon.mock.calls.length).toBe(paintedOnce);
    // A moved material count is a signature move: exactly one rebuild.
    world.inventory[0].count -= 1;
    vi.advanceTimersByTime(1000);
    expect(itemIcon.mock.calls.length).toBeGreaterThan(paintedOnce);
    win.close();
  });

  // The sim's slot walk SPLICES an exhausted stack, so a bagged copy above it
  // re-enters the answering poll one cell lower. The selection follows the
  // copy through its (ordinal, count) anchor among same-id bagged candidates
  // (buildPerfectingView), and the edge gate accepts exactly that pair, so
  // the landed rank cues once, the followed radio stays checked, and the
  // action keeps targeting THAT copy; a same-id sibling never passes.
  const successCues = (): number =>
    (audio.perfectingSuccess as ReturnType<typeof vi.fn>).mock.calls.length;
  const checkedRef = (): string | null =>
    (root().querySelector('[role="radio"][aria-checked="true"]') as HTMLElement | null)
      ?.textContent ?? null;

  it('a bagged copy shifted by an exhausted stack still cues, with a WORN apex piece first in the walk', () => {
    // The endgame shape: a worn Masterwrought piece precedes every bagged
    // candidate, so a fallback to the first candidate would jump the
    // selection to the worn piece and the next click would spend an ember on
    // a copy the player never picked.
    world.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 1 } };
    // The post-state below is a HAND-MODELED shift (the window is agnostic
    // to which stack vanished): the sim's consume walks from the highest
    // index and with a one-unit bill can never exhaust a stack BELOW the
    // copy while leaving the bill met, so the trailing essence exists only
    // to keep the follow-up click a real send. The mid-bag arm models the
    // walk's own exhausted stack faithfully.
    world.inventory = [
      { itemId: 'sundered_essence', count: 1 },
      { itemId: 'makers_ember', count: 2 },
      { itemId: 'prismglass_setting', count: 3 },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 1 } },
      { itemId: 'sundered_essence', count: 2 },
    ];
    const win = makeWindow();
    win.open();
    const live = root().querySelector('.pf-live-status') as HTMLElement;
    const radios = [...root().querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    expect(radios.length).toBe(2);
    radios[1].click(); // the bagged copy
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    expect(world.perfectItem).toHaveBeenLastCalledWith({ bag: 3, itemId: APEX });
    // The modeled answer: cell 0 spliced, one ember and one setting spent,
    // the copy lands rank 2 one cell lower.
    world.inventory.splice(0, 1);
    world.inventory[0].count -= 1;
    world.inventory[1].count -= 1;
    world.inventory[2] = { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 2 } };
    vi.advanceTimersByTime(1000);
    expect(root().getAttribute('aria-busy')).toBe('false');
    expect(successCues()).toBe(1);
    expect(live.textContent).toContain('rank 2 of 4');
    // The bagged radio stays checked (the second row is the bagged copy),
    // and the action still targets it at its NEW cell.
    const after = [...root().querySelectorAll('[role="radio"]')];
    expect(after.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    expect(world.perfectItem).toHaveBeenLastCalledWith({ bag: 2, itemId: APEX });
  });

  it('a mid-bag copy (stacks below AND above it) shifts and still cues', () => {
    world.equipment = {};
    world.equipmentInstances = {};
    world.inventory = [
      { itemId: 'makers_ember', count: 1 },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 1 } },
      { itemId: 'sundered_essence', count: 2 },
      { itemId: 'prismglass_setting', count: 3 },
    ];
    const win = makeWindow();
    win.open();
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    expect(world.perfectItem).toHaveBeenLastCalledWith({ bag: 1, itemId: APEX });
    world.inventory.splice(0, 1);
    world.inventory[0] = { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 2 } };
    world.inventory[1].count -= 1;
    vi.advanceTimersByTime(1000);
    expect(successCues()).toBe(1);
    expect(root().textContent).toContain('Rank 2 of 4');
  });

  it('a same-id SIBLING never passes the gate: a failed attempt beside a higher rank cues nothing', () => {
    // Two bagged copies of one id, the SECOND selected (rank 1) beside a
    // rank-3 sibling. The attempt FAILS (rank unchanged) but exhausts the
    // ember stack: both copies shift; the selection follows the second copy
    // (ordinal 1), not the sibling, and no success cue plays.
    world.equipment = {};
    world.equipmentInstances = {};
    world.inventory = [
      { itemId: 'makers_ember', count: 1 },
      { itemId: 'sundered_essence', count: 2 },
      { itemId: 'prismglass_setting', count: 3 },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 3 } },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 1 } },
      { itemId: 'makers_ember', count: 2 },
    ];
    const win = makeWindow();
    win.open();
    const radios = [...root().querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    radios[1].click();
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    expect(world.perfectItem).toHaveBeenLastCalledWith({ bag: 4, itemId: APEX });
    world.inventory.splice(0, 1);
    world.inventory[0].count -= 1;
    world.inventory[1].count -= 1;
    vi.advanceTimersByTime(1000);
    expect(successCues()).toBe(0);
    expect((root().querySelector('.pf-live-status') as HTMLElement).textContent).toBe('');
    expect(root().getAttribute('aria-busy')).toBe('false');
    const after = [...root().querySelectorAll('[role="radio"]')];
    expect(after.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    expect(world.perfectItem).toHaveBeenLastCalledWith({ bag: 3, itemId: APEX });
  });

  it('a LOST selected copy (sold mid-attempt) beside a same-id sibling cues nothing', () => {
    // The FIRST copy (rank 1) is selected and sold while the ember stack is
    // spent; the higher-ranked sibling now sits at ordinal 0 with the count
    // moved 2 -> 1. No worn piece: the fallback IS the sibling, so only the
    // gate's COUNT compare stands between the pair and a spurious cue (the
    // ordinal alone reads equal).
    world.equipment = {};
    world.equipmentInstances = {};
    world.inventory = [
      { itemId: 'makers_ember', count: 1 },
      { itemId: 'sundered_essence', count: 2 },
      { itemId: 'prismglass_setting', count: 3 },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 1 } },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 3 } },
    ];
    const win = makeWindow();
    win.open();
    expect(checkedRef()).toContain('Rank 1 of 4');
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    expect(world.perfectItem).toHaveBeenLastCalledWith({ bag: 3, itemId: APEX });
    world.inventory.splice(3, 1);
    world.inventory.splice(0, 1);
    vi.advanceTimersByTime(1000);
    expect(successCues()).toBe(0);
    expect((root().querySelector('.pf-live-status') as HTMLElement).textContent).toBe('');
    // The fallback selected the surviving sibling (the CHECKED row, not
    // merely a row somewhere in the list).
    expect(checkedRef()).toContain('Rank 3 of 4');
  });

  it('a radio click never cues: moving from a low-rank copy to a high-rank same-id copy', () => {
    // The gate's ORDINAL compare against the click path: two same-id copies,
    // the rank-1 copy selected, then the rank-3 copy clicked. Count is
    // unchanged, the ordinal moved; without the ordinal compare the pair
    // reads as one copy advancing two ranks and plays the success cue.
    world.equipment = {};
    world.equipmentInstances = {};
    world.inventory = [
      { itemId: 'makers_ember', count: 2 },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 1 } },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 3 } },
    ];
    const win = makeWindow();
    win.open();
    expect(checkedRef()).toContain('Rank 1 of 4');
    ([...root().querySelectorAll('[role="radio"]')][1] as HTMLButtonElement).click();
    expect(checkedRef()).toContain('Rank 3 of 4');
    expect(successCues()).toBe(0);
    expect((root().querySelector('.pf-live-status') as HTMLElement).textContent).toBe('');
  });

  it('a radio click that lands after a bag shift selects the CLICKED copy, not the old anchor', () => {
    // Between the last repaint and the click the bag shifted (a stack below
    // both copies exhausted by a consumable keybind, an online snapshot).
    // The painted radio still carries the pre-shift ref; the click latches
    // THAT copy's own anchor, so the re-target follows the clicked copy. With
    // the previous selection's anchor applied instead, the click silently
    // stayed on the old copy and the action spent the next ember on it.
    world.equipment = {};
    world.equipmentInstances = {};
    world.inventory = [
      { itemId: 'linen_cloth', count: 1 },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 1 } },
      { itemId: 'sundered_essence', count: 2 },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 3 } },
      { itemId: 'prismglass_setting', count: 3 },
      { itemId: 'makers_ember', count: 2 },
    ];
    const win = makeWindow();
    win.open(); // selection: the first copy (bag 1), anchor {0, 2}
    // The shift, with no tick in between: the cloth stack below both copies
    // vanishes (sold), so every later cell moves one down.
    world.inventory.splice(0, 1);
    const radios = [...root().querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    radios[1].click(); // the painted second copy, ref {bag: 3} pre-shift
    expect(checkedRef()).toContain('Rank 3 of 4');
    // A click is a selection move (prev anchor {0, 2} vs {1, 2}): never a
    // success cue.
    expect(successCues()).toBe(0);
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    expect(world.perfectItem).toHaveBeenLastCalledWith({ bag: 2, itemId: APEX });
  });

  it('the anchor never spans a close: a shifted bagged pick falls back on reopen', () => {
    // The selection survives a close only where its exact cell still holds
    // the copy; the closed span must not become the ordinal's blind window
    // (a same-id copy sold and another picked up while closed would reopen
    // on the other copy), so the anchor is dropped at close and a shift
    // while closed falls back to the first candidate.
    world.equipment = {};
    world.equipmentInstances = {};
    world.inventory = [
      { itemId: 'linen_cloth', count: 1 },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 3 } },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 1 } },
    ];
    const win = makeWindow();
    win.open();
    ([...root().querySelectorAll('[role="radio"]')][1] as HTMLButtonElement).click();
    expect(checkedRef()).toContain('Rank 1 of 4');
    win.close();
    world.inventory.splice(0, 1);
    win.open();
    expect(checkedRef()).toContain('Rank 3 of 4');
    expect(successCues()).toBe(0);
  });

  it('a different-id bagged candidate taking the vacated selection cues nothing', () => {
    // The itemId guard: the selected pendant is sold, the remaining apex
    // copy (another id, higher rank) becomes the selection; no cue.
    world.equipment = {};
    world.equipmentInstances = {};
    world.inventory = [
      { itemId: 'makers_ember', count: 2 },
      { itemId: APEX, count: 1, instance: { boundTo: 1, perfecting: 3 } },
      { itemId: 'wyrmfall_pendant', count: 1, instance: { boundTo: 1, perfecting: 1 } },
    ];
    world.craftSkills.jewelcrafting = PERFECTING_SKILL_REQ;
    const win = makeWindow();
    win.open();
    ([...root().querySelectorAll('[role="radio"]')][1] as HTMLButtonElement).click();
    expect(checkedRef()).toContain('Wyrmfall');
    world.inventory.splice(2, 1);
    vi.advanceTimersByTime(1000);
    expect(successCues()).toBe(0);
    expect(checkedRef()).toContain('Duskforged');
  });

  it('a reopen never replays a stale edge (the close-time latch reset)', () => {
    const win = makeWindow();
    win.open();
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    world.inventory[0].count -= 1;
    world.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 2 } };
    vi.advanceTimersByTime(1000);
    expect((audio.perfectingSuccess as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    win.close();
    // A rank lands while the window is closed: old news on the reopen, so
    // neither the open's paint nor the next tick may replay the cue or
    // announce it (deleting the close-time prevSelected reset replays both).
    world.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 3 } };
    win.open();
    const live = root().querySelector('.pf-live-status') as HTMLElement;
    expect((audio.perfectingSuccess as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(live.textContent).toBe('');
    vi.advanceTimersByTime(1000);
    expect((audio.perfectingSuccess as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(live.textContent).toBe('');
  });

  it('relocalize repaints in the new locale and re-latches the signature', async () => {
    // The repaint signature is text-independent by design, so setLanguage
    // alone can never move it: relocalize() must force exactly one rebuild
    // (deleting its paint() leaves the whole window in the old locale) and
    // leave the signature re-latched (a cleared signature buys a second
    // rebuild on the next tick, which would undo any draft restore).
    // ja_JP because the phase's M16 fills landed there (the Latin locales
    // pend to the release fill, so es would resolve to English and prove
    // nothing).
    await ensureLocaleLoaded('ja_JP');
    const itemIcon = vi.fn(() => '<img class="icon">');
    const win = makeWindow({ itemIcon });
    win.open();
    const englishTitle = (root().querySelector('#perfecting-title') as HTMLElement).textContent;
    const afterOpen = itemIcon.mock.calls.length;
    try {
      setLanguage('ja_JP');
      win.relocalize();
      // Exactly one rebuild, rendering the new locale's text.
      expect(itemIcon.mock.calls.length).toBeGreaterThan(afterOpen);
      const relocalized = itemIcon.mock.calls.length;
      const localizedTitle = (root().querySelector('#perfecting-title') as HTMLElement).textContent;
      expect(localizedTitle).not.toBe(englishTitle);
      // Re-latched, never cleared: the next tick over an unchanged world
      // rebuilds nothing.
      vi.advanceTimersByTime(1000);
      expect(itemIcon.mock.calls.length).toBe(relocalized);
    } finally {
      setLanguage('en');
    }
    win.close();
  });

  it('the candidate tooltip thunk resolves the copy off the LIVE world at hover time', () => {
    const thunks: Array<{ el: Element; resolve: () => string }> = [];
    const itemTooltip = vi.fn(
      (_def: unknown, instance?: ItemInstancePayload) => `tip:${instance?.perfecting ?? 'none'}`,
    );
    const win = makeWindow({
      itemTooltip: itemTooltip as unknown as WindowDeps['itemTooltip'],
      attachTooltip: (el, resolve) => thunks.push({ el, resolve }),
    });
    win.open();
    const radio = root().querySelector('[role="radio"]') as HTMLElement;
    const candidate = thunks.find((entry) => entry.el === radio);
    expect(candidate).toBeDefined();
    // The mirrors move WITHOUT a repaint; hovering now must show the new
    // payload (an eager render-time resolve would serve the stale rank).
    world.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 2 } };
    expect(candidate!.resolve()).toBe('tip:2');
    win.close();
  });
});

describe('the R2 bind-warning confirm step', () => {
  it('an unbound, rank 0 selection shows the warning before any attempt', () => {
    const win = makeWindow();
    win.open();
    const warning = root().querySelector('.pf-warning') as HTMLElement;
    expect(warning).not.toBeNull();
    // Icon + text, never color alone.
    expect(warning.querySelector('svg')).not.toBeNull();
    // "binds", not "permanently binds": a FAILED first attempt leaves a
    // bound rank-0 copy the Maker's Bond unbind can still clear for its
    // fee, so the copy claims only what holds (the QA round's correctness
    // finding); the detail line carries the accurate refusal set.
    expect(warning.textContent).toContain('Your first perfecting attempt binds');
    expect(warning.textContent).not.toContain('permanently binds');
    // The single-half refusal set ("progress cannot be unbound, and ...")
    // must not come back: the Perfected half is part of the sentence.
    expect(warning.textContent).not.toContain('Perfecting progress cannot be unbound, and');
    expect(warning.textContent).toContain('never lowers a rank');
    expect(warning.textContent).toContain(
      'A piece with Perfecting progress or a Perfected piece cannot be unbound, and a promotion is permanent.',
    );
  });

  it('the first attempt routes through the confirm; confirming sends, cancelling does not', () => {
    const win = makeWindow();
    win.open();
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    // No send yet: the confirm prompt took the click.
    expect(world.perfectItem).not.toHaveBeenCalled();
    const prompt = document.querySelector('.pf-bind-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    expect(prompt.getAttribute('role')).toBe('dialog');
    (prompt.querySelector('.pf-bind-confirm') as HTMLButtonElement).click();
    expect(world.perfectItem).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.pf-bind-prompt')).toBeNull();
    // A cancel on a fresh prompt sends nothing.
    win.notifyErrorToast();
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    const second = document.querySelector('.pf-bind-prompt') as HTMLElement;
    (second.querySelectorAll('button')[0] as HTMLButtonElement).click();
    expect(world.perfectItem).toHaveBeenCalledTimes(1);
  });

  it('a mid-dialog repaint cannot retarget the confirm: the OPENED ref is sent', () => {
    // The security-review retarget class: bags stay interactive behind the
    // prompt and the 1 Hz repaint keeps running, so a bag shift while the
    // confirm is open makes a re-resolved selection fall back to another
    // candidate. The confirm must send the ref it was opened for; a stale
    // captured ref dies on the server's index-plus-id pin instead.
    world.equipment = {};
    world.inventory.push({ itemId: APEX, count: 1 });
    const win = makeWindow();
    win.open();
    const bagIndex = world.inventory.length - 1;
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    expect(document.querySelector('.pf-bind-prompt')).not.toBeNull();
    // The bag shifts under the open prompt (a preceding stack is consumed),
    // and a repaint runs: the candidate's cell index is different now.
    world.inventory.splice(0, 1);
    vi.advanceTimersByTime(1000);
    const prompt = document.querySelector('.pf-bind-prompt') as HTMLElement;
    (prompt.querySelector('.pf-bind-confirm') as HTMLButtonElement).click();
    expect(world.perfectItem).toHaveBeenCalledTimes(1);
    expect(world.perfectItem.mock.calls[0][0]).toEqual({ bag: bagIndex, itemId: APEX });
  });

  it('a bound copy skips the confirm entirely', () => {
    world.equipmentInstances = { mainhand: { boundTo: 1 } };
    const win = makeWindow();
    win.open();
    expect(root().querySelector('.pf-warning')).toBeNull();
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    expect(document.querySelector('.pf-bind-prompt')).toBeNull();
    expect(world.perfectItem).toHaveBeenCalledTimes(1);
  });
});

describe('focus across the rebuild (the focus_restore carry)', () => {
  it('a repaint restores focus to the same keyed control', () => {
    world.equipmentInstances = { mainhand: { boundTo: 1, perfecting: 1 } };
    const win = makeWindow();
    win.open();
    const action = root().querySelector('[data-action]') as HTMLButtonElement;
    action.focus();
    expect(document.activeElement).toBe(action);
    world.inventory[0].count -= 1;
    vi.advanceTimersByTime(1000);
    const rebuilt = root().querySelector('[data-action]') as HTMLButtonElement;
    expect(rebuilt).not.toBe(action);
    expect(document.activeElement).toBe(rebuilt);
  });
});

describe('the naming dialog (deliverable B)', () => {
  beforeEach(() => {
    world.equipmentInstances = { mainhand: { perfected: true, boundTo: 1 } };
    world.inventory.push({ itemId: 'deed_of_making', count: 1 });
  });

  const openDialog = (win: PerfectingWindow): HTMLElement => {
    win.open();
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    return document.querySelector('.pf-name-prompt') as HTMLElement;
  };

  it('caps the input at the sim shape ceiling and names it for AT', () => {
    const prompt = openDialog(makeWindow());
    expect(prompt).not.toBeNull();
    expect(prompt.getAttribute('role')).toBe('dialog');
    const input = prompt.querySelector('.pf-name-input') as HTMLInputElement;
    expect(input.maxLength).toBe(MAX_LEGENDARY_NAME_LENGTH);
    expect(input.getAttribute('aria-label')).toBeTruthy();
    // The window behind the modal goes inert (the prompt_dialog recipe).
    expect(root().inert).toBe(true);
  });

  it('shape guidance: an ill-shaped draft disables the submit and flags the hint', () => {
    const prompt = openDialog(makeWindow());
    const input = prompt.querySelector('.pf-name-input') as HTMLInputElement;
    const submit = prompt.querySelector('.pf-name-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // empty draft
    input.value = '9starts-with-digit';
    input.dispatchEvent(new Event('input'));
    expect(submit.disabled).toBe(true);
    expect((prompt.querySelector('.pf-name-hint') as HTMLElement).dataset.invalid).toBe('true');
    input.value = "Dawn's Edge";
    input.dispatchEvent(new Event('input'));
    expect(submit.disabled).toBe(false);
    expect((prompt.querySelector('.pf-name-hint') as HTMLElement).dataset.invalid).toBe('false');
  });

  it('the lock constant is sized to outlast one name-lane refill beat', () => {
    // NAME_SUBMIT_LOCK_MS is load-bearing against the server lane
    // (MSG_LANE_NAME_SCREEN_REFILL_PER_SECOND = one token per 500ms): the
    // debounce tests advance BY the constant, so both sides would move
    // together and 1ms or 60s would pass them. Pin the literal and the
    // relation it exists to satisfy.
    expect(NAME_SUBMIT_LOCK_MS).toBe(600);
    expect(NAME_SUBMIT_LOCK_MS).toBeGreaterThan(1000 / MSG_LANE_NAME_SCREEN_REFILL_PER_SECOND);
  });

  it('a mid-dialog repaint cannot retarget the submit: the OPENED ref is sent (D14-2)', () => {
    // The naming dialog is D14-2's SECOND dialog, and its consequence is the
    // worse one: a re-resolve implementation would spend the Deed of Making
    // naming a DIFFERENT copy after a bag shift. Mirror of the bind-confirm
    // retarget arm: a bagged Perfected copy, a preceding stack consumed
    // under the open prompt, then submit.
    world.equipment = {};
    world.equipmentInstances = {};
    world.inventory.push({ itemId: APEX, count: 1, instance: { perfected: true, boundTo: 1 } });
    const bagIndex = world.inventory.length - 1;
    const win = makeWindow();
    win.open();
    (root().querySelector('[data-action]') as HTMLButtonElement).click();
    const prompt = document.querySelector('.pf-name-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    // The bag shifts under the open prompt and the 1 Hz repaint runs: the
    // copy now sits one cell earlier.
    world.inventory.splice(0, 1);
    vi.advanceTimersByTime(1000);
    const input = prompt.querySelector('.pf-name-input') as HTMLInputElement;
    const submit = prompt.querySelector('.pf-name-submit') as HTMLButtonElement;
    input.value = 'Oath';
    input.dispatchEvent(new Event('input'));
    submit.click();
    expect(world.perfectItem).toHaveBeenCalledTimes(1);
    expect(world.perfectItem.mock.calls[0][0]).toEqual({ bag: bagIndex, itemId: APEX });
    expect(world.perfectItem.mock.calls[0][1]).toBe('Oath');
  });

  it('the auto-dismiss repairs only a DROPPED focus: an outside control keeps it', () => {
    // The fresh-reader round's narrowing: the promotion's repaint-driven
    // auto-dismiss can fire while the player is typing in chat behind the
    // dialog, and yanking them onto a perfecting rung mid-word is worse
    // than the drop it repairs. Deleting the early-return guard steals it.
    const win = makeWindow();
    openDialog(win);
    const outside = document.createElement('button');
    outside.id = 'outside-control';
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);
    world.inventory = world.inventory.filter((cell) => cell.itemId !== 'deed_of_making');
    world.equipmentInstances = {
      mainhand: { perfected: true, boundTo: 1, rolled: { quality: 'legendary' }, name: 'Oath' },
    };
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('.pf-name-prompt')).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('a hostile chosen name renders escaped on the candidate row (no markup injection)', () => {
    // The legal shape excludes markup, so exposure needs a divergent mirror
    // payload; the painter must not rely on that. The esc() around
    // chosenName is what this pins (the item_instance_tooltip shape).
    world.equipmentInstances = {
      mainhand: {
        perfected: true,
        boundTo: 1,
        rolled: { quality: 'legendary' },
        name: '<b>Oath</b>',
      },
    };
    const win = makeWindow();
    win.open();
    expect(root().querySelector('b')).toBeNull();
    expect(root().innerHTML).toContain('&lt;b&gt;');
  });

  it('submit sends the NORMALIZED name once and locks for the msg-lane beat', () => {
    const prompt = openDialog(makeWindow());
    const input = prompt.querySelector('.pf-name-input') as HTMLInputElement;
    const submit = prompt.querySelector('.pf-name-submit') as HTMLButtonElement;
    input.value = '  Dawn   Edge ';
    input.dispatchEvent(new Event('input'));
    submit.click();
    expect(world.perfectItem).toHaveBeenCalledTimes(1);
    expect(world.perfectItem).toHaveBeenCalledWith({ slot: 'mainhand' }, 'Dawn Edge');
    // The lock: disabled + a busy affordance, so a mash never reads as a
    // dead button while the name_screen lane may have dropped the frame.
    expect(submit.disabled).toBe(true);
    expect(prompt.getAttribute('aria-busy')).toBe('true');
    submit.click();
    expect(world.perfectItem).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(NAME_SUBMIT_LOCK_MS);
    expect(submit.disabled).toBe(false);
    expect(prompt.getAttribute('aria-busy')).toBeNull();
    submit.click();
    expect(world.perfectItem).toHaveBeenCalledTimes(2);
  });

  it('an error toast lifts the lock early (an answer arrived)', () => {
    const win = makeWindow();
    const prompt = openDialog(win);
    const input = prompt.querySelector('.pf-name-input') as HTMLInputElement;
    const submit = prompt.querySelector('.pf-name-submit') as HTMLButtonElement;
    input.value = 'Oath';
    input.dispatchEvent(new Event('input'));
    submit.click();
    expect(submit.disabled).toBe(true);
    win.notifyErrorToast();
    expect(submit.disabled).toBe(false);
  });

  it('the landed promotion dismisses the dialog and frees the window', () => {
    const win = makeWindow();
    const prompt = openDialog(win);
    expect(prompt).not.toBeNull();
    world.inventory = world.inventory.filter((cell) => cell.itemId !== 'deed_of_making');
    world.equipmentInstances = {
      mainhand: { perfected: true, boundTo: 1, rolled: { quality: 'legendary' }, name: 'Oath' },
    };
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('.pf-name-prompt')).toBeNull();
    expect(root().inert).toBe(false);
    // The detail pane now leads with the chosen name and the promoted face.
    expect(root().textContent).toContain('Oath');
    expect(root().querySelector('[data-action]')).toBeNull();
    // Focus lands on a live rung, never <body> (the wave-1 frontend review:
    // dismiss() has no opener return, so the window repairs it itself; the
    // promoted face has no action button, so the candidate row takes it).
    expect(document.activeElement).not.toBe(document.body);
    expect(root().contains(document.activeElement)).toBe(true);
  });

  it('cancelling after a mid-prompt repaint still returns focus into the window', () => {
    // The captured opener node is destroyed by any 1 Hz repaint whose
    // signature moved (root.innerHTML rebuild), so dismissAndReturn's
    // opener.focus() is a detached no-op; the refocus repair puts the
    // keyboard somewhere real.
    const win = makeWindow();
    openDialog(win);
    world.inventory[0].count -= 1;
    vi.advanceTimersByTime(1000);
    const prompt = document.querySelector('.pf-name-prompt') as HTMLElement;
    expect(prompt).not.toBeNull();
    (prompt.querySelector('.pf-name-cancel') as HTMLButtonElement).click();
    expect(document.querySelector('.pf-name-prompt')).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(root().contains(document.activeElement)).toBe(true);
  });

  it('closing the window under an open dialog clears inert (the backstop)', () => {
    const win = makeWindow();
    openDialog(win);
    expect(root().inert).toBe(true);
    win.close();
    expect(document.querySelector('.pf-name-prompt')).toBeNull();
    expect(root().inert).toBe(false);
    expect(root().style.display).toBe('none');
  });
});
