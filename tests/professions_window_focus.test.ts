// @vitest-environment happy-dom
//
// DOM behavioral guard: keyboard focus, scroll position, and write elision
// across professions-window rebuilds (the deeds_window_focus.test.ts family).
// The painter rebuilds via full innerHTML on every data change, so focus must
// land on the role-equivalent fresh control (Close, the window's single
// interactive control, a premise pinned below), the scroll container must
// keep its offset, and an UNCHANGED refresh signature must produce zero DOM
// writes. Drives the real ProfessionsWindow over jsdom with stub deps.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfessionsWindow, type ProfessionsWindowDeps } from '../src/ui/professions_window';

// jsdom ships no 2D canvas, so the procedural icon compositor cannot run here;
// the painter only ever uses the returned string as an <img src>.
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: () => 'data:,',
  // Echo the requested id into the URL so painter tests catch a wrong or
  // hardcoded profession/gathering resolver argument.
  professionIconUrl: (id: string) => `/test-professions/${id}.webp`,
  // The tool-effect hover card (tool_effect_tooltip.ts) colors its title by
  // item quality; mirror the full record so wiring the card does not crash
  // here and a partial-mock miss cannot bite a later quality.
  QUALITY_COLOR: {
    poor: '#9d9d9d',
    common: '#ffffff',
    uncommon: '#1eff00',
    rare: '#0070dd',
    epic: '#a335ee',
    legendary: '#ff8000',
  },
}));

interface WorldState {
  identity: {
    version: 1;
    synced: boolean;
    craftSkills: Record<string, number>;
    activeArchetype: string | null;
    pairedMajor: string | null;
    hobbyCraft: string | null;
    attunedPairs: string[];
    switchCount: number;
    amendsProgress: number;
    amendsRequired: number;
  };
  gathering: { professionId: string; skill: number; maxSkill: number }[];
  // The viewer's slotted tool effects (IWorld `toolEffectSlots`). Defaults to
  // empty, which is what every player reads today, so the existing cases keep
  // asserting the no-effect surface.
  toolEffects?: {
    professionId: string;
    effectId: string;
    charges: number;
    maxCharges: number;
    confirmMode: 'always' | 'prompt';
  }[];
  // The viewer's bags (IWorld `inventory`), the slot/recharge affordance
  // input. Defaults to empty: no charms, no buttons, so the existing cases
  // keep asserting the button-free surface.
  inventory?: { itemId: string; count: number }[];
}

// An attuned, tiered identity so the window opens in full mode (ring, ten
// bars, perks), the surface with the most interactive controls.
function baseState(): WorldState {
  return {
    identity: {
      version: 1,
      synced: true,
      craftSkills: {
        engineering: 0,
        alchemy: 0,
        cooking: 30,
        leatherworking: 0,
        tailoring: 0,
        inscription: 0,
        enchanting: 0,
        jewelcrafting: 60,
        weaponcrafting: 25,
        armorcrafting: 49,
      },
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'leatherworking',
      attunedPairs: ['weaponcrafting+armorcrafting'],
      switchCount: 2,
      amendsProgress: 1,
      amendsRequired: 11,
    },
    gathering: [{ professionId: 'mining', skill: 30, maxSkill: 300 }],
  };
}

function makeWindow(
  state: WorldState,
  depsOver: Partial<ProfessionsWindowDeps> = {},
): { w: ProfessionsWindow; el: HTMLElement } {
  const el = document.createElement('div');
  el.id = 'professions-window';
  document.body.appendChild(el);
  const deps: ProfessionsWindowDeps = {
    root: () => el,
    world: () =>
      ({
        craftingIdentity: state.identity,
        professionsState: { skills: state.gathering },
        gatheringProficiency: Object.fromEntries(
          state.gathering.map((row) => [row.professionId, row.skill]),
        ),
        toolEffectSlots: state.toolEffects ?? [],
        inventory: state.inventory ?? [],
        player: { name: 'Testchar' },
      }) as never,
    closeOthers: () => {},
    hideTooltip: () => {},
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: () => {},
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
    ...depsOver,
  };
  const w = new ProfessionsWindow(deps);
  w.open();
  return { w, el };
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('ProfessionsWindow: focus and scroll survive rebuilds', () => {
  it('focuses the Close button on cold open so a keyboard user enters the dialog', () => {
    const { el } = makeWindow(baseState());
    expect(document.activeElement).toBe(el.querySelector('[data-close]'));
  });

  it('re-opening while open re-renders in place without re-running the open bookkeeping', () => {
    const captureFocus = vi.fn(() => null);
    const closeOthers = vi.fn();
    const { w, el } = makeWindow(baseState(), { captureFocus, closeOthers });
    expect(captureFocus).toHaveBeenCalledTimes(1);
    expect(closeOthers).toHaveBeenCalledTimes(1);

    w.open();

    // Still open and rendered, but the original opener-focus capture and the
    // close-others sweep did not re-run: re-running would clobber the focus
    // restore target with an element inside the window itself.
    expect(w.isOpen).toBe(true);
    expect(el.style.display).toBe('flex');
    expect(el.querySelector('[data-close]')).not.toBeNull();
    expect(captureFocus).toHaveBeenCalledTimes(1);
    expect(closeOthers).toHaveBeenCalledTimes(1);
  });

  it('rebuilds on a data change and restores focus to the fresh Close button', () => {
    const state = baseState();
    const { w, el } = makeWindow(state);
    w.refreshIfChanged(); // settle the post-open catch-up repaint
    const before = el.querySelector<HTMLElement>('[data-close]');
    if (!before) throw new Error('missing [data-close]');
    before.focus();
    state.identity.craftSkills.cooking = 40;
    w.refreshIfChanged();
    const fresh = el.querySelector<HTMLElement>('[data-close]');
    expect(fresh).not.toBe(before);
    expect(document.activeElement).toBe(fresh);
  });

  it('keeps Close the only focusable control on the CHARM-LESS surface', () => {
    // The pre-craft default: with no charms and no slot the window has no
    // action buttons, so Close is the whole refocus story for that state.
    // The acquisition craft's buttons are the inner controls the old version
    // of this pin predicted; their own refocus behavior is the two arms
    // below.
    const { el } = makeWindow(baseState());
    const focusables = [
      ...el.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ];
    expect(focusables).toHaveLength(1);
    expect(focusables[0].hasAttribute('data-close')).toBe(true);
  });

  it('carries focus across a rebuild to the SAME action button by its key', () => {
    // The #2377 family's remedy: a repaint under a focused slot/recharge
    // button restores that button, not Close, or the next Enter would shut
    // the window instead of repeating the action. Deleting the keyed lookup
    // in render() and falling straight to [data-close] must fail here.
    const state = baseState();
    state.inventory = [
      { itemId: 'copper_mining_pick', count: 1 },
      { itemId: 'gatherers_cache', count: 1 },
      { itemId: 'artisans_eye', count: 1 },
    ];
    const { w, el } = makeWindow(state);
    w.refreshIfChanged(); // settle the post-open catch-up repaint
    const eye = el.querySelector<HTMLElement>('[data-slot-effect="artisans_eye"]');
    if (!eye) throw new Error('slot button rendered');
    eye.focus();
    expect(document.activeElement).toBe(eye);
    w.render();
    const after = document.activeElement as HTMLElement | null;
    expect(after?.getAttribute('data-slot-effect')).toBe('artisans_eye');
    expect(after?.hasAttribute('data-close')).toBe(false);
  });

  it('carries focus across a rebuild to the SAME live effect row by its key', () => {
    // The live effect row is the restore ladder's sanctioned non-spending
    // middle rung: it is tabbable only so its hover card is keyboard
    // reachable, so a repaint under a focused row must land back on the
    // fresh row. Without the row's data-focus-key the ladder parks focus on
    // Close and the next Enter shuts the window (the #2377 family).
    const state = baseState();
    state.toolEffects = [
      {
        professionId: 'mining',
        effectId: 'gatherers_cache',
        charges: 12,
        maxCharges: 30,
        confirmMode: 'always',
      },
    ];
    const { w, el } = makeWindow(state);
    w.refreshIfChanged(); // settle the post-open catch-up repaint
    const row = el.querySelector<HTMLElement>('[data-effect-tip]');
    if (!row) throw new Error('live effect row rendered');
    expect(row.getAttribute('data-focus-key')).toBe('effect:mining');
    row.focus();
    expect(document.activeElement).toBe(row);
    w.render();
    const after = document.activeElement as HTMLElement | null;
    expect(after?.getAttribute('data-effect-tip')).toBe('gatherers_cache');
    expect(after?.hasAttribute('data-close')).toBe(false);
  });

  it('falls back to CLOSE, never a different action button, when the focused one vanished', () => {
    // The adversarial round's held-Enter finding: every action button in a
    // gathering row SPENDS (a slot burns a charm, a recharge consumes
    // materials), and input.ts leaves a focused button's Enter default
    // alone, so re-parking focus on a DIFFERENT action button hands an
    // Enter activation to an action the player never aimed at (a recharge
    // success repaint used to feed the stream into a charm-burning re-slot;
    // with default binds the chat composer usually absorbs the repeats, but
    // the hazard is live for a rebound chat key). Close is the one control
    // whose accidental activation costs nothing, so it is the ONLY fallback
    // rung.
    const state = baseState();
    state.inventory = [
      { itemId: 'copper_mining_pick', count: 1 },
      { itemId: 'gatherers_cache', count: 1 },
      { itemId: 'artisans_eye', count: 1 },
    ];
    const { w, el } = makeWindow(state);
    w.refreshIfChanged();
    const cache = el.querySelector<HTMLElement>('[data-slot-effect="gatherers_cache"]');
    if (!cache) throw new Error('slot button rendered');
    cache.focus();
    // The charm leaves the bags between paints (its slot succeeded); the
    // sibling action button survives the rebuild and must NOT inherit focus.
    state.inventory = [
      { itemId: 'copper_mining_pick', count: 1 },
      { itemId: 'artisans_eye', count: 1 },
    ];
    w.render();
    const after = document.activeElement as HTMLElement | null;
    expect(after?.hasAttribute('data-close')).toBe(true);
    expect(after?.getAttribute('data-slot-effect')).toBeNull();
  });

  it('preserves the scroll offset across a data-driven rebuild', () => {
    const state = baseState();
    const { w, el } = makeWindow(state);
    w.refreshIfChanged(); // settle the post-open catch-up repaint
    const scroll = el.querySelector<HTMLElement>('.prof-scroll');
    if (!scroll) throw new Error('contract: .prof-scroll is the window scroll container');
    scroll.scrollTop = 120;
    state.identity.craftSkills.cooking = 55;
    w.refreshIfChanged();
    const fresh = el.querySelector<HTMLElement>('.prof-scroll');
    expect(fresh).not.toBe(scroll);
    expect(fresh?.scrollTop).toBe(120);
  });

  it('performs no DOM writes when the refresh signature is unchanged', () => {
    const { w, el } = makeWindow(baseState());
    // open() leaves lastSig empty (the deeds open contract), so the first
    // refresh is a one-time catch-up repaint; settle it before asserting.
    w.refreshIfChanged();
    // Node identity is the decisive check: a rebuild would replace every
    // child even if the markup came back byte-identical.
    const closeBtn = el.querySelector('[data-close]');
    const firstChild = el.firstElementChild;
    const html = el.innerHTML;
    w.refreshIfChanged();
    w.refreshIfChanged();
    expect(el.querySelector('[data-close]')).toBe(closeBtn);
    expect(el.firstElementChild).toBe(firstChild);
    expect(el.innerHTML).toBe(html);
  });
});

describe('ProfessionsWindow: mode and row gating', () => {
  it('renders the simplified syncing surface over the pre-sync ClientWorld shape', () => {
    // The tests/professions_contracts.test.ts pin: a fresh ClientWorld serves
    // synced false, an empty craftSkills record, and professionsState
    // { skills: [] }. The painter must map that empty array and paint the
    // graceful syncing surface (identity paragraph plus one CTA), never the
    // full ring, craft rows, or gathering section.
    const state = baseState();
    state.identity.synced = false;
    state.identity.craftSkills = {};
    state.gathering = [];
    const { el } = makeWindow(state);
    expect(el.querySelector('.prof-identity-paragraph')).not.toBeNull();
    expect(el.querySelector('.prof-cta')).not.toBeNull();
    expect(el.querySelector('.prof-ring')).toBeNull();
    expect(el.querySelector('.prof-crafts')).toBeNull();
    expect(el.querySelector('.prof-gathering')).toBeNull();
  });

  it('renders no gathering row for an unknown profession id', () => {
    // Fishing joined the name table with Professions 2.0, so the unknown-id
    // example is skinning (documented in gathering.ts as deliberately NOT a
    // gathering profession): an id with no GATHERING_PROFESSION_NAME_KEYS
    // entry (src/ui/gathering_profession_name.ts, the extracted shared
    // table) renders no row BY DESIGN, while the known ids beside it still
    // render.
    const state = baseState();
    state.gathering = [
      { professionId: 'mining', skill: 30, maxSkill: 300 },
      { professionId: 'skinning', skill: 10, maxSkill: 300 },
    ];
    const { el } = makeWindow(state);
    expect(el.querySelectorAll('.prof-gather-row')).toHaveLength(1);
    expect(el.querySelector('.prof-gathering')).not.toBeNull();
    expect(
      el.querySelector<HTMLImageElement>('.prof-gather-row .prof-craft-icon')?.getAttribute('src'),
    ).toBe('/test-professions/gather_mining.webp');
  });

  it('omits the gathering section entirely when every injected id is unknown', () => {
    const state = baseState();
    state.gathering = [{ professionId: 'skinning', skill: 10, maxSkill: 300 }];
    const { el } = makeWindow(state);
    expect(el.querySelectorAll('.prof-gather-row')).toHaveLength(0);
    expect(el.querySelector('.prof-gathering')).toBeNull();
  });

  it('promotes the raise CTA once the trending craft has any skill', () => {
    // The two simplified CTA arms: zero skill everywhere renders the start
    // copy; any trending skill renders the raise copy with the interpolated
    // points to the next boundary (15 here), plus the promoted tutorial line.
    const startState = baseState();
    startState.identity.synced = false;
    startState.identity.craftSkills = {};
    startState.gathering = [];
    const start = makeWindow(startState).el.querySelector('.prof-cta-line')?.textContent ?? '';
    const raiseState = baseState();
    raiseState.identity.craftSkills = { cooking: 10 };
    raiseState.identity.activeArchetype = null;
    raiseState.identity.pairedMajor = null;
    raiseState.identity.hobbyCraft = null;
    raiseState.identity.attunedPairs = [];
    raiseState.gathering = [];
    const { el } = makeWindow(raiseState);
    const raise = el.querySelector('.prof-cta-line')?.textContent ?? '';
    expect(raise).toContain('15');
    expect(raise).not.toBe(start);
    expect(el.querySelector('.prof-tutorial')).not.toBeNull();
  });

  it('renders ten ring nodes, with arc and chord only while attuned', () => {
    // The RingLayout math is unit-pinned in professions_view.test.ts; this
    // pins the painter's conditional SVG emission on top of it.
    const attuned = makeWindow(baseState());
    const crest = attuned.el.querySelector<HTMLImageElement>('.prof-archetype-crest');
    expect(crest?.getAttribute('src')).toBe('/ui/professions/archetype_smith.webp');
    expect(crest?.getAttribute('alt')).toBe('');
    expect(
      [...attuned.el.querySelectorAll<HTMLImageElement>('.prof-ring-node img')].map((image) =>
        image.getAttribute('src'),
      ),
    ).toEqual([
      '/test-professions/prof_engineering.webp',
      '/test-professions/prof_alchemy.webp',
      '/test-professions/prof_cooking.webp',
      '/test-professions/prof_leatherworking.webp',
      '/test-professions/prof_tailoring.webp',
      '/test-professions/prof_inscription.webp',
      '/test-professions/prof_enchanting.webp',
      '/test-professions/prof_jewelcrafting.webp',
      '/test-professions/prof_weaponcrafting.webp',
      '/test-professions/prof_armorcrafting.webp',
    ]);
    expect(
      [...attuned.el.querySelectorAll<HTMLImageElement>('.prof-crafts .prof-craft-icon')].map(
        (image) => image.getAttribute('src'),
      ),
    ).toEqual([
      '/test-professions/prof_engineering.webp',
      '/test-professions/prof_alchemy.webp',
      '/test-professions/prof_cooking.webp',
      '/test-professions/prof_leatherworking.webp',
      '/test-professions/prof_tailoring.webp',
      '/test-professions/prof_inscription.webp',
      '/test-professions/prof_enchanting.webp',
      '/test-professions/prof_jewelcrafting.webp',
      '/test-professions/prof_weaponcrafting.webp',
      '/test-professions/prof_armorcrafting.webp',
    ]);
    expect(attuned.el.querySelectorAll('.prof-ring-node')).toHaveLength(10);
    expect(attuned.el.querySelector('.prof-ring-arc')).not.toBeNull();
    expect(attuned.el.querySelector('.prof-ring-chord')).not.toBeNull();
    document.body.innerHTML = '';
    const bare = baseState();
    bare.identity.activeArchetype = null;
    bare.identity.pairedMajor = null;
    bare.identity.hobbyCraft = null;
    bare.identity.attunedPairs = [];
    const unattuned = makeWindow(bare);
    expect(unattuned.el.querySelectorAll('.prof-ring-node')).toHaveLength(10);
    expect(unattuned.el.querySelector('.prof-ring-arc')).toBeNull();
    expect(unattuned.el.querySelector('.prof-ring-chord')).toBeNull();
    expect(unattuned.el.querySelector('.prof-archetype-crest')).toBeNull();
  });

  it('restores the captured opener focus on close, and only once', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    const restored: (HTMLElement | null)[] = [];
    const { w } = makeWindow(baseState(), {
      captureFocus: () => opener,
      restoreFocus: (target) => restored.push(target),
    });
    w.close();
    expect(restored).toEqual([opener]);
    w.close();
    expect(restored).toEqual([opener]);
  });

  it('lists the specialized perk line once a craft crosses the threshold', () => {
    // baseState tops out at skill 60, so every other full render exercises
    // only the threshold explainer; this pins the perk-list arm and the ONE
    // perkSpecializedLine key with its interpolated discount percent.
    const state = baseState();
    state.identity.craftSkills.engineering = 80;
    const { el } = makeWindow(state);
    expect(el.querySelector('.prof-perk-list')).not.toBeNull();
    const lines = el.querySelectorAll('.prof-perk-line');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain('20');
  });
});
