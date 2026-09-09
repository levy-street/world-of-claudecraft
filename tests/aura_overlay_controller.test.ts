// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import type { TalentAllocation } from '../src/sim/content/talents';
import type { ResolvedAbility } from '../src/sim/sim';
import { AuraOverlayConfigStore, defaultAuraOverlayConfig } from '../src/ui/aura_overlay_config';
import { type AuraGroundRingState, AuraOverlayController } from '../src/ui/aura_overlay_controller';
import type { PainterHostWriters } from '../src/ui/painter_host';

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const known = (...ids: string[]): ResolvedAbility[] =>
  // A known ability with no effects: enough for every AUTHORED proc def (which keys
  // off ability ids), and deliberately not watchlist-eligible. The watchlist suites
  // below build their own defs from real ABILITIES entries.
  ids.map((id) => ({ def: { id, effects: [] } }) as unknown as ResolvedAbility);

const writers = {
  toggleClass: (el: HTMLElement, cls: string, on: boolean) => el.classList.toggle(cls, on),
  setText: (el: HTMLElement, text: string) => {
    el.textContent = text;
  },
  setStyleProp: (el: HTMLElement, prop: string, value: string) => {
    el.style.setProperty(prop, value);
  },
} as unknown as PainterHostWriters;

describe('AuraOverlayController setup preview', () => {
  it('builds Mage frames from the current specialization and matches shared aura kinds by id', () => {
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'mage',
      playerName: 'Merlin',
      known: () => known('hot_streak'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    controller.setAll(true);

    expect(
      Array.from(document.querySelectorAll<HTMLElement>('.aura-overlay-frame')).map(
        (frame) => frame.dataset.proc,
      ),
    ).toEqual(['heating_up', 'hot_streak']);
    expect(
      document.querySelector('[data-proc="hot_streak"]')?.classList.contains('aura-overlay-fire'),
    ).toBe(true);
    expect(document.querySelector('[data-proc="hot_streak"] img')?.getAttribute('src')).toBe(
      '/icons/hot_streak.png',
    );

    controller.paint([{ id: 'other_free_cast', kind: 'next_cast_free' } as never]);
    expect(document.querySelector('[data-proc="hot_streak"]')?.classList.contains('active')).toBe(
      false,
    );
    controller.paint([{ id: 'hot_streak', kind: 'next_cast_free' } as never]);
    expect(document.querySelector('[data-proc="hot_streak"]')?.classList.contains('active')).toBe(
      true,
    );
  });

  it('renders the Hunter Counterfang dodge window from reactive player state', () => {
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'hunter',
      playerName: 'Rexxar',
      known: () => known('mongoose_bite'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    controller.setAll(true);
    const frame = document.querySelector<HTMLElement>('[data-proc="counterfang_window"]');

    controller.paint([], 5);
    expect(frame?.classList.contains('active')).toBe(true);
    expect(frame?.querySelector('.aura-overlay-timer')?.textContent).toBe('5');

    controller.paint([], 0);
    expect(frame?.classList.contains('active')).toBe(false);
  });

  it('shows every relevant frame in placement mode with its final appearance vars', () => {
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('mortal_strike', 'heroic_strike', 'overpower', 'execute', 'sudden_death'),
      iconUrl: (id) => `/icons/${id}.png`,
    });

    controller.beginPlacement('battle_trance', 'arcs');
    const root = document.querySelector('#aura-overlays');
    expect(root?.classList.contains('placement')).toBe(true);
    expect(root?.querySelectorAll('.aura-overlay-frame')).toHaveLength(3);
    const revenge = root?.querySelector<HTMLElement>('[data-proc="battle_trance"]');
    expect(revenge?.classList.contains('placement-target')).toBe(true);
    expect(revenge?.classList.contains('placement-arcs')).toBe(true);
    expect(revenge?.classList.contains('placement-icon')).toBe(false);
    expect(
      root?.querySelector('[data-proc="sudden_death"]')?.classList.contains('placement-target'),
    ).toBe(false);
    expect(
      root?.querySelector('[data-proc="sudden_death"]')?.classList.contains('placement-preview'),
    ).toBe(true);
    expect(revenge?.style.getPropertyValue('--aura-opacity')).toBe('0.7');
    expect(revenge?.querySelector('img')?.getAttribute('src')).toBe('/icons/mortal_strike.png');
    expect(revenge?.querySelector('.aura-overlay-icon')).not.toBeNull();
    expect(revenge?.querySelector('.aura-overlay-arcs-shell')).not.toBeNull();
    const handle = revenge?.querySelector<HTMLElement>('.aura-overlay-move-handle');
    expect(handle?.getAttribute('aria-hidden')).toBe('true');

    const beforeGroundNudge = controller.get('battle_trance');
    controller.beginPlacement('battle_trance', 'ground');
    controller.nudge('battle_trance', 'ground', 0, 1);
    expect(revenge?.classList.contains('placement-ground')).toBe(true);
    expect(controller.get('battle_trance')).toEqual(beforeGroundNudge);
  });

  it('selects another visible spell part directly from its placement preview', () => {
    const onPlacement = vi.fn();
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge', 'raised_guard'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    controller.onPlacementChange(onPlacement);
    controller.beginPlacement('revenge_free', 'icon');
    const root = document.querySelector<HTMLElement>('#aura-overlays');
    const raisedGuard = document.querySelector<HTMLElement>('[data-proc="raised_guard"]');
    const crescents = raisedGuard?.querySelector<HTMLElement>('.aura-overlay-arcs-shell');
    Object.defineProperty(root, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1_000, height: 800 }),
    });
    Object.defineProperty(crescents, 'setPointerCapture', { value: vi.fn() });

    root?.dispatchEvent(
      Object.assign(
        new MouseEvent('pointerdown', {
          button: 0,
          bubbles: true,
          clientX: 370,
          clientY: 448,
        }),
        { pointerId: 4 },
      ),
    );

    expect(raisedGuard?.classList.contains('placement-target')).toBe(true);
    expect(raisedGuard?.classList.contains('placement-arcs')).toBe(true);
    expect(
      document.querySelector('[data-proc="revenge_free"]')?.classList.contains('placement-target'),
    ).toBe(false);
    expect(onPlacement).toHaveBeenLastCalledWith('raised_guard', 'arcs');
  });

  it('keeps frames inactive outside setup until their aura kind is present', () => {
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('bloodthirst', 'enrage_passive'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    const frame = document.querySelector<HTMLElement>('[data-proc="enrage"]');

    controller.setPlacement(false);
    controller.paint([]);
    expect(frame?.classList.contains('active')).toBe(false);
    controller.paint([{ kind: 'buff_ap_pct' } as never]);
    expect(frame?.classList.contains('active')).toBe(false);
    controller.paint([{ kind: 'enrage' } as never]);
    expect(frame?.classList.contains('active')).toBe(true);
  });

  it('renders the matched aura remaining duration and radial progress over its icon', () => {
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    controller.setAll(true);
    const timer = document.querySelector<HTMLElement>(
      '[data-proc="revenge_free"] .aura-overlay-timer',
    );

    controller.paint([
      { id: 'revenge_free', kind: 'revenge_free', remaining: 9.2, duration: 10 } as never,
    ]);

    expect(timer?.textContent).toBe('10');
    expect(timer?.style.getPropertyValue('--aura-remaining-ratio')).toBe('92.0000%');

    controller.paint([
      { id: 'revenge_free', kind: 'revenge_free', remaining: 5, duration: 10 } as never,
    ]);
    expect(timer?.textContent).toBe('5');
    expect(timer?.style.getPropertyValue('--aura-remaining-ratio')).toBe('50.0000%');
  });

  it('enables and disables every available aura without losing staggered defaults', () => {
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge', 'raised_guard', 'iron_resolve'),
      iconUrl: (id) => `/icons/${id}.png`,
    });

    expect(controller.get('revenge_free')).toMatchObject({ enabled: false, arcsScale: 0.8 });
    expect(controller.get('raised_guard')).toMatchObject({ enabled: false, arcsScale: 1 });
    expect(controller.get('iron_resolve')).toMatchObject({ enabled: false, arcsScale: 1.1 });

    controller.setAll(true);
    expect(controller.get('revenge_free').enabled).toBe(true);
    expect(controller.get('raised_guard').enabled).toBe(true);
    expect(controller.get('iron_resolve').enabled).toBe(true);
    expect(
      document.querySelector('[data-proc="revenge_free"]')?.classList.contains('disabled'),
    ).toBe(false);

    controller.setAll(false);
    expect(controller.get('revenge_free').enabled).toBe(false);
    expect(controller.get('raised_guard').enabled).toBe(false);
  });

  it('matches Ironguard defensive buffs by aura id without lighting on another absorb', () => {
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('raised_guard', 'iron_resolve'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    const raisedGuard = document.querySelector<HTMLElement>('[data-proc="raised_guard"]');
    const ironResolve = document.querySelector<HTMLElement>('[data-proc="iron_resolve"]');

    controller.paint([
      { id: 'another_physical_wall', kind: 'buff_dr_phys' } as never,
      { id: 'another_absorb', kind: 'absorb' } as never,
    ]);
    expect(raisedGuard?.classList.contains('active')).toBe(false);
    expect(ironResolve?.classList.contains('active')).toBe(false);

    controller.paint([
      { id: 'raised_guard_dr', kind: 'absorb' } as never,
      { id: 'iron_resolve', kind: 'buff_dr_phys' } as never,
    ]);
    expect(raisedGuard?.classList.contains('active')).toBe(false);
    expect(ironResolve?.classList.contains('active')).toBe(false);

    controller.paint([
      { id: 'raised_guard_dr', kind: 'buff_dr_phys' } as never,
      { id: 'iron_resolve', kind: 'absorb' } as never,
    ]);
    expect(raisedGuard?.classList.contains('active')).toBe(true);
    expect(ironResolve?.classList.contains('active')).toBe(true);
  });

  it('refreshes frames immediately when the known loadout changes', () => {
    let currentKnown = known('revenge');
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => currentKnown,
      iconUrl: (id) => `/icons/${id}.png`,
    });
    expect(document.querySelector('[data-proc="revenge_free"]')).not.toBeNull();

    currentKnown = known('bloodthirst', 'enrage_passive');
    controller.paint([]);
    expect(
      document.querySelector('[data-proc="revenge_free"]')?.classList.contains('loadout-hidden'),
    ).toBe(true);
    expect(document.querySelector('[data-proc="enrage"]')).not.toBeNull();
  });

  it('refreshes frames when a same-length loadout changes ability ids', () => {
    let currentKnown = known('revenge');
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => currentKnown,
      iconUrl: (id) => `/icons/${id}.png`,
    });

    currentKnown = known('bloodthirst');
    controller.paint([]);

    expect(
      document.querySelector('[data-proc="revenge_free"]')?.classList.contains('loadout-hidden'),
    ).toBe(true);
    expect(document.querySelector('[data-proc="enrage"]')).not.toBeNull();
  });

  it('refreshes selected talent proc frames when the row choice changes', () => {
    // Druid carries the drawable talent procs in the reworked trees: row 8's
    // improved_roots emits dru_ironhide_reflex and row 11's furor emits
    // dru_gripping_ambush (no class has two drawable procs on one row now, so
    // the swap crosses both rows: deselecting hides one frame while the other
    // row's new selection adds one).
    let currentTalents: TalentAllocation = {
      spec: 'feral',
      rows: { 8: 'dru_r8_improved_roots', 11: 'dru_r11_improved_mark' },
    };
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'druid',
      playerName: 'Runetotem',
      known: () => known('wrath'),
      talents: () => currentTalents,
      iconUrl: (id) => `/icons/${id}.png`,
    });

    expect(document.querySelector('[data-proc="dru_ironhide_reflex"]')).not.toBeNull();
    currentTalents = {
      spec: 'feral',
      rows: { 8: 'dru_r8_brutal_bash', 11: 'dru_r11_furor' },
    };
    controller.paint([]);

    expect(
      document
        .querySelector('[data-proc="dru_ironhide_reflex"]')
        ?.classList.contains('loadout-hidden'),
    ).toBe(true);
    expect(document.querySelector('[data-proc="dru_gripping_ambush"]')).not.toBeNull();
  });

  it('applies persisted appearance and position to rebuilt frames', () => {
    localStorage.setItem(
      'woc_aura_overlays:warrior:Raido',
      JSON.stringify({
        __layoutVersion: 8,
        revenge_free: {
          ...defaultAuraOverlayConfig('revenge_free'),
          iconPosX: 0.2,
          opacity: 0.55,
          scale: 1.4,
        },
      }),
    );
    new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    const frame = document.querySelector<HTMLElement>('[data-proc="revenge_free"]');
    expect(frame?.style.getPropertyValue('--aura-icon-x')).toBe('20%');
    expect(frame?.style.getPropertyValue('--aura-arcs-x')).toBe('50%');
    expect(frame?.style.getPropertyValue('--aura-opacity')).toBe('0.55');
    expect(frame?.style.getPropertyValue('--aura-icon-scale')).toBe('1.4');
    expect(frame?.style.getPropertyValue('--aura-arcs-scale')).toBe('0.8');
    expect(frame?.style.getPropertyValue('--aura-color')).toBe('#ffe14d');
  });

  it('drags setup frames inside the app viewport and persists the normalized position', () => {
    const onPosition = vi.fn();
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    controller.onPositionChange(onPosition);
    controller.beginPlacement('revenge_free', 'icon');
    const root = document.querySelector<HTMLElement>('#aura-overlays');
    const frame = root?.querySelector<HTMLElement>('[data-proc="revenge_free"]');
    const icon = frame?.querySelector<HTMLElement>('.aura-overlay-icon');
    const arcs = frame?.querySelector<HTMLElement>('.aura-overlay-arcs-shell');
    Object.defineProperty(root, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 50, width: 800, height: 500 }),
    });
    Object.defineProperty(icon, 'setPointerCapture', { value: vi.fn() });

    icon?.dispatchEvent(
      Object.assign(new MouseEvent('pointerdown', { button: 0, bubbles: true }), { pointerId: 7 }),
    );
    icon?.dispatchEvent(new MouseEvent('pointermove', { clientX: 1_000, clientY: 0 }));

    expect(frame?.style.getPropertyValue('--aura-icon-x')).toBe('100%');
    expect(frame?.style.getPropertyValue('--aura-icon-y')).toBe('0%');
    expect(frame?.style.getPropertyValue('--aura-arcs-x')).toBe('50%');
    expect(frame?.style.getPropertyValue('--aura-arcs-y')).toBe('56%');
    expect(onPosition).toHaveBeenLastCalledWith(
      'revenge_free',
      expect.objectContaining({ iconPosX: 1, iconPosY: 0, arcsPosX: 0.5, arcsPosY: 0.56 }),
    );
    icon?.dispatchEvent(new MouseEvent('pointerup'));
    controller.beginPlacement('revenge_free', 'arcs');
    root?.dispatchEvent(
      Object.assign(
        new MouseEvent('pointerdown', {
          button: 0,
          bubbles: true,
          clientX: 396,
          clientY: 330,
        }),
        { pointerId: 8 },
      ),
    );
    arcs?.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 550 }));
    expect(frame?.style.getPropertyValue('--aura-icon-x')).toBe('100%');
    expect(frame?.style.getPropertyValue('--aura-icon-y')).toBe('0%');
    expect(frame?.style.getPropertyValue('--aura-arcs-x')).toBe('50%');
    expect(frame?.style.getPropertyValue('--aura-arcs-y')).toBe('56%');
    expect(
      JSON.parse(localStorage.getItem('woc_aura_overlays:warrior:Raido') ?? '{}'),
    ).toMatchObject({
      revenge_free: { iconPosX: 1, iconPosY: 0, arcsPosX: 0.5, arcsPosY: 0.56 },
    });
  });

  it('snaps pointer placement to the same one-percent grid used by nudges', () => {
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    controller.beginPlacement('revenge_free', 'icon');
    const root = document.querySelector<HTMLElement>('#aura-overlays');
    const frame = root?.querySelector<HTMLElement>('[data-proc="revenge_free"]');
    const icon = frame?.querySelector<HTMLElement>('.aura-overlay-icon');
    Object.defineProperty(root, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1_000, height: 800 }),
    });
    Object.defineProperty(icon, 'setPointerCapture', { value: vi.fn() });

    icon?.dispatchEvent(
      Object.assign(new MouseEvent('pointerdown', { button: 0, bubbles: true }), { pointerId: 5 }),
    );
    icon?.dispatchEvent(new MouseEvent('pointermove', { clientX: 333, clientY: 287 }));

    expect(controller.get('revenge_free')).toMatchObject({
      iconPosX: 0.33,
      iconPosY: 0.36,
    });
  });

  it('does not drag outside setup or with a non-primary pointer button', () => {
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    const frame = document.querySelector<HTMLElement>('[data-proc="revenge_free"]');
    const icon = frame?.querySelector<HTMLElement>('.aura-overlay-icon');
    Object.defineProperty(icon, 'setPointerCapture', { value: vi.fn() });

    icon?.dispatchEvent(
      Object.assign(new MouseEvent('pointerdown', { button: 0 }), { pointerId: 1 }),
    );
    icon?.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }));
    controller.beginPlacement('revenge_free', 'icon');
    icon?.dispatchEvent(
      Object.assign(new MouseEvent('pointerdown', { button: 1 }), { pointerId: 2 }),
    );
    icon?.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }));

    expect(frame?.style.getPropertyValue('--aura-icon-x')).toBe('44%');
    expect(frame?.style.getPropertyValue('--aura-icon-y')).toBe('70%');
  });

  it('drags only the selected aura part from the four-arrow move handle', () => {
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    controller.beginPlacement('revenge_free', 'icon');
    const root = document.querySelector<HTMLElement>('#aura-overlays');
    const frame = root?.querySelector<HTMLElement>('[data-proc="revenge_free"]');
    const handle = frame?.querySelector<HTMLElement>('.aura-overlay-move-handle');
    Object.defineProperty(root, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1_000, height: 800 }),
    });
    Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });

    handle?.dispatchEvent(
      Object.assign(new MouseEvent('pointerdown', { button: 0, bubbles: true }), { pointerId: 9 }),
    );
    handle?.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 480 }));

    expect(frame?.style.getPropertyValue('--aura-arcs-x')).toBe('50%');
    expect(frame?.style.getPropertyValue('--aura-arcs-y')).toBe('56%');
    expect(frame?.style.getPropertyValue('--aura-icon-x')).toBe('40%');
    expect(frame?.style.getPropertyValue('--aura-icon-y')).toBe('60%');
  });

  it('selects the visually nearest crescent when concentric hit areas overlap', () => {
    const onPlacement = vi.fn();
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge', 'raised_guard', 'iron_resolve'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    controller.onPlacementChange(onPlacement);
    controller.beginPlacement('iron_resolve', 'icon');
    const root = document.querySelector<HTMLElement>('#aura-overlays');
    const revengeArcs = document.querySelector<HTMLElement>(
      '[data-proc="revenge_free"] .aura-overlay-arcs-shell',
    );
    Object.defineProperty(root, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1_000, height: 800 }),
    });
    Object.defineProperty(revengeArcs, 'setPointerCapture', { value: vi.fn() });

    root?.dispatchEvent(
      Object.assign(
        new MouseEvent('pointerdown', {
          button: 0,
          bubbles: true,
          clientX: 396,
          clientY: 448,
        }),
        { pointerId: 12 },
      ),
    );

    expect(onPlacement).toHaveBeenLastCalledWith('revenge_free', 'arcs');
    expect(
      document.querySelector('[data-proc="revenge_free"]')?.classList.contains('placement-target'),
    ).toBe(true);
  });

  it('nudges only icons geometrically', () => {
    const onPosition = vi.fn();
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    controller.onPositionChange(onPosition);

    controller.nudge('revenge_free', 'icon', -1, 1);

    expect(controller.get('revenge_free')).toMatchObject({
      iconPosX: 0.43,
      iconPosY: 0.71,
      arcsPosX: 0.5,
      arcsPosY: 0.56,
    });
    expect(onPosition).toHaveBeenCalledWith(
      'revenge_free',
      expect.objectContaining({ iconPosX: 0.43, arcsPosX: 0.5 }),
    );

    controller.patch('revenge_free', {
      iconPosX: 0.99,
      arcsPosX: 0.95,
      iconPosY: 0.02,
      arcsPosY: 0.26,
    });
    controller.nudge('revenge_free', 'icon', 1, -10);
    expect(controller.get('revenge_free')).toMatchObject({
      iconPosX: 1,
      arcsPosX: 0.95,
      iconPosY: 0,
      arcsPosY: 0.26,
    });
  });

  it('publishes enabled ground rings using exact proc matching and setup preview', () => {
    const paintGroundRings = vi.fn();
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge', 'raised_guard'),
      iconUrl: (id) => `/icons/${id}.png`,
      paintGroundRings,
    });
    controller.setAll(true);
    controller.patch('raised_guard', { color: '#33ccff', opacity: 0.55 });
    controller.patchLayout({ groundRingBlockScale: 1.4 });

    controller.paint([{ id: 'raised_guard_dr', kind: 'buff_dr_phys' } as never]);

    expect(paintGroundRings).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'revenge_free', visible: false }),
      {
        id: 'raised_guard',
        visible: true,
        color: '#33ccff',
        opacity: 0.55,
        scale: 1.4,
      },
    ]);

    controller.setPlacement(true);
    controller.paint([]);
    expect(paintGroundRings.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ id: 'revenge_free', visible: true }),
      expect.objectContaining({ id: 'raised_guard', visible: true }),
    ]);
    controller.nudge('raised_guard', 'ground', -1, 0);
    controller.paint([]);
    expect(paintGroundRings.mock.calls.at(-1)?.[0].map((ring: { id: string }) => ring.id)).toEqual([
      'raised_guard',
      'revenge_free',
    ]);
    expect(controller.get('raised_guard').groundOrder).toBe(0);
    expect(controller.get('revenge_free').groundOrder).toBe(1);
    const recreatedPaintGroundRings = vi.fn();
    const recreated = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge', 'raised_guard'),
      iconUrl: (id) => `/icons/${id}.png`,
      paintGroundRings: recreatedPaintGroundRings,
    });
    recreated.setPlacement(true);
    recreated.paint([]);
    expect(
      recreatedPaintGroundRings.mock.calls.at(-1)?.[0].map((ring: { id: string }) => ring.id),
    ).toEqual(['raised_guard', 'revenge_free']);
    controller.nudge('raised_guard', 'ground', 1, 0);
    controller.paint([]);
    expect(paintGroundRings.mock.calls.at(-1)?.[0].map((ring: { id: string }) => ring.id)).toEqual([
      'revenge_free',
      'raised_guard',
    ]);
    expect(controller.get('revenge_free').groundOrder).toBe(0);
    expect(controller.get('raised_guard').groundOrder).toBe(1);
    controller.nudge('revenge_free', 'ground', 1, 0);
    controller.reset('revenge_free');
    controller.paint([]);
    expect(paintGroundRings.mock.calls.at(-1)?.[0].map((ring: { id: string }) => ring.id)).toEqual([
      'revenge_free',
      'raised_guard',
    ]);
    expect(
      new Set([
        controller.get('revenge_free').groundOrder,
        controller.get('raised_guard').groundOrder,
      ]).size,
    ).toBe(2);
    controller.patch('raised_guard', { showGroundRing: false });
    controller.paint([{ id: 'raised_guard_dr', kind: 'buff_dr_phys' } as never]);
    expect(paintGroundRings.mock.calls.at(-1)?.[0][1]).toMatchObject({
      id: 'raised_guard',
      visible: false,
    });
  });

  it('does not republish unchanged ground-ring state on every frame', () => {
    const paintGroundRings = vi.fn();
    const getConfig = vi.spyOn(AuraOverlayConfigStore.prototype, 'get');
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge'),
      iconUrl: (id) => `/icons/${id}.png`,
      paintGroundRings,
    });
    getConfig.mockClear();

    controller.paint([]);
    expect(paintGroundRings).toHaveBeenCalledTimes(1);
    expect(getConfig).not.toHaveBeenCalled();
    controller.paint([]);
    expect(paintGroundRings).toHaveBeenCalledTimes(1);
    expect(getConfig).not.toHaveBeenCalled();

    controller.setAll(true);
    controller.patch('revenge_free', { showGroundRing: true });
    controller.paint([{ id: 'revenge_free', kind: 'revenge_free' } as never]);
    expect(paintGroundRings).toHaveBeenCalledTimes(2);
    controller.paint([{ id: 'revenge_free', kind: 'revenge_free' } as never]);
    expect(paintGroundRings).toHaveBeenCalledTimes(2);
  });

  it('moves spells between visual ring and crescent slots when reordered', () => {
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge', 'raised_guard'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    controller.patch('revenge_free', {
      enabled: true,
      showIcon: false,
      showArcs: true,
      showGroundRing: false,
      iconPosX: 0.11,
      iconPosY: 0.12,
      scale: 0.7,
      opacity: 0.45,
      color: '#ff3300',
      arcsPosX: 0.31,
      arcsPosY: 0.41,
      arcsScale: 0.65,
      groundScale: 0.75,
    });
    controller.patch('raised_guard', {
      enabled: false,
      showIcon: true,
      showArcs: false,
      showGroundRing: true,
      iconPosX: 0.81,
      iconPosY: 0.82,
      scale: 1.5,
      opacity: 0.95,
      color: '#0066ff',
      arcsPosX: 0.63,
      arcsPosY: 0.73,
      arcsScale: 1.45,
      groundScale: 1.35,
    });

    controller.nudge('raised_guard', 'ground', -1, 0);

    expect(controller.get('raised_guard')).toMatchObject({
      groundOrder: 0,
      arcsScale: 0.65,
      enabled: false,
      showIcon: true,
      showArcs: false,
      showGroundRing: true,
      iconPosX: 0.81,
      iconPosY: 0.82,
      scale: 1.5,
      opacity: 0.95,
      color: '#0066ff',
    });
    expect(controller.get('revenge_free')).toMatchObject({
      groundOrder: 1,
      arcsScale: 1.45,
      enabled: true,
      showIcon: false,
      showArcs: true,
      showGroundRing: false,
      iconPosX: 0.11,
      iconPosY: 0.12,
      scale: 0.7,
      opacity: 0.45,
      color: '#ff3300',
    });
    const raisedFrame = document.querySelector<HTMLElement>('[data-proc="raised_guard"]');
    const revengeFrame = document.querySelector<HTMLElement>('[data-proc="revenge_free"]');
    expect(raisedFrame?.style.getPropertyValue('--aura-arcs-x')).toBe('50%');
    expect(raisedFrame?.style.getPropertyValue('--aura-arcs-y')).toBe('56%');
    expect(raisedFrame?.style.getPropertyValue('--aura-arcs-scale')).toBe('0.65');
    expect(raisedFrame?.style.getPropertyValue('--aura-half-width')).toBe('109.5px');
    expect(raisedFrame?.style.getPropertyValue('--aura-half-height')).toBe('83.5px');
    expect(revengeFrame?.style.getPropertyValue('--aura-arcs-x')).toBe('50%');
    expect(revengeFrame?.style.getPropertyValue('--aura-arcs-y')).toBe('56%');
    expect(revengeFrame?.style.getPropertyValue('--aura-arcs-scale')).toBe('1.45');
    expect(revengeFrame?.style.getPropertyValue('--aura-half-width')).toBe('229.5px');
    expect(revengeFrame?.style.getPropertyValue('--aura-half-height')).toBe('171.5px');

    controller.patchLayout({ crescentBlockScale: 1.2 });
    expect(raisedFrame?.style.getPropertyValue('--aura-arcs-scale')).toBe('0.78');
    expect(revengeFrame?.style.getPropertyValue('--aura-arcs-scale')).toBe('1.74');

    const recreated = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () => known('revenge', 'raised_guard'),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    expect(recreated.get('raised_guard')).toMatchObject({
      groundOrder: 0,
      arcsScale: 0.65,
    });
    expect(recreated.get('revenge_free')).toMatchObject({
      groundOrder: 1,
      arcsScale: 1.45,
    });
    expect(recreated.getLayout().crescentBlockScale).toBe(1.2);

    controller.nudge('raised_guard', 'arcs', 1, 0);
    expect(controller.get('revenge_free')).toMatchObject({
      groundOrder: 0,
      arcsScale: 0.65,
    });
    expect(controller.get('raised_guard')).toMatchObject({
      groundOrder: 1,
      arcsScale: 1.45,
    });
    const beforeVerticalNudge = controller.get('raised_guard');
    controller.nudge('raised_guard', 'arcs', 0, -1);
    expect(controller.get('raised_guard')).toEqual(beforeVerticalNudge);
    controller.nudge('raised_guard', 'arcs', -1, 0);
    expect(controller.get('raised_guard')).toMatchObject({
      groundOrder: 0,
      arcsScale: 0.65,
    });
    expect(controller.get('revenge_free')).toMatchObject({
      groundOrder: 1,
      arcsScale: 1.45,
    });
    controller.nudge('raised_guard', 'arcs', 1, 0);

    const beforeLeftBoundary = controller.get('revenge_free');
    const beforeRightBoundary = controller.get('raised_guard');
    controller.nudge('revenge_free', 'ground', -1, 0);
    controller.nudge('raised_guard', 'ground', 1, 0);
    expect(controller.get('revenge_free')).toEqual(beforeLeftBoundary);
    expect(controller.get('raised_guard')).toEqual(beforeRightBoundary);
  });
});

describe('AuraOverlayController watchlist', () => {
  // Real shipped defs, so the derived aura signature is the one the sim applies.
  const warriorKnown = (): ResolvedAbility[] =>
    ['revenge', 'recklessness', 'raised_guard', 'sinister_strike'].map(
      (id) => ({ def: ABILITIES[id] }) as ResolvedAbility,
    );
  const makeController = (): AuraOverlayController =>
    new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: warriorKnown,
      iconUrl: (id) => `/icons/${id}.png`,
    });
  const frameIds = (): (string | undefined)[] =>
    Array.from(document.querySelectorAll<HTMLElement>('.aura-overlay-frame'))
      .filter((frame) => !frame.classList.contains('loadout-hidden'))
      .map((frame) => frame.dataset.proc);

  it('offers only the self-aura spells an authored proc does not already cover', () => {
    const controller = makeController();
    // recklessness buffs the caster and has no authored proc, so it is offered.
    // raised_guard also buffs the caster but IS authored (revenge/raised_guard
    // defs), and sinister_strike parks nothing, so neither is offered.
    expect(controller.watchOptions().map((option) => option.abilityId)).toEqual(['recklessness']);
    expect(controller.watchOptions()[0]).toMatchObject({
      procId: 'watch:recklessness',
      auraKind: 'buff_reckless',
      auraId: 'recklessness',
      watched: false,
    });
    expect(frameIds()).toEqual(['revenge_free', 'raised_guard']);
  });

  it('picking a spell adds an enabled frame ordered after every authored proc', () => {
    const controller = makeController();
    controller.setWatched('watch:recklessness', true);

    expect(controller.watchOptions()[0].watched).toBe(true);
    expect(controller.defs().map((def) => def.id)).toEqual([
      'revenge_free',
      'raised_guard',
      'watch:recklessness',
    ]);
    expect(frameIds()).toContain('watch:recklessness');
    // Picking IS the request to see it, so the overlay comes on...
    expect(controller.get('watch:recklessness').enabled).toBe(true);
    // ...and lands last in the spell order instead of on top of an authored proc.
    const orders = controller.defs().map((def) => controller.get(def.id).groundOrder);
    expect(orders[2]).toBeGreaterThan(Math.max(orders[0], orders[1]));
    const frame = document.querySelector<HTMLElement>('[data-proc="watch:recklessness"]');
    expect(frame?.classList.contains('aura-overlay-warrior')).toBe(true);
    expect(frame?.querySelector('img')?.getAttribute('src')).toBe('/icons/recklessness.png');
  });

  it('parks a second picked spell on its own order slot and icon position', () => {
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: () =>
        ['recklessness', 'avatar', 'die_by_sword'].map(
          (id) => ({ def: ABILITIES[id] }) as ResolvedAbility,
        ),
      iconUrl: (id) => `/icons/${id}.png`,
    });
    controller.setWatched('watch:recklessness', true);
    controller.setWatched('watch:avatar', true);
    controller.setWatched('watch:die_by_sword', true);

    const picked = ['watch:recklessness', 'watch:avatar', 'watch:die_by_sword'].map((id) =>
      controller.get(id),
    );
    expect(picked.map((cfg) => cfg.groundOrder)).toEqual([0, 1, 2]);
    // Every watched proc shares one generic default, so an unspread pick would
    // stack all three icons on the same spot.
    expect(new Set(picked.map((cfg) => cfg.iconPosX)).size).toBe(3);
    // Same reason for color: four identical gold rings cannot be told apart, which
    // is the whole point of watching several spells at once.
    expect(new Set(picked.map((cfg) => cfg.color)).size).toBe(3);
  });

  it('lights the watched frame on the aura the sim actually applies, and only that one', () => {
    const controller = makeController();
    controller.setWatched('watch:recklessness', true);
    const frame = () => document.querySelector<HTMLElement>('[data-proc="watch:recklessness"]');

    controller.paint([{ id: 'recklessness', kind: 'buff_ap' } as never]);
    expect(frame()?.classList.contains('active')).toBe(false);
    controller.paint([{ id: 'other', kind: 'buff_reckless' } as never]);
    expect(frame()?.classList.contains('active')).toBe(false);
    controller.paint([{ id: 'recklessness', kind: 'buff_reckless' } as never]);
    expect(frame()?.classList.contains('active')).toBe(true);
  });

  it('unpicking hides the frame but keeps the tuning for the next time', () => {
    const controller = makeController();
    controller.setWatched('watch:recklessness', true);
    controller.patch('watch:recklessness', { color: '#123456', scale: 1.2 });

    controller.setWatched('watch:recklessness', false);
    expect(controller.defs().map((def) => def.id)).toEqual(['revenge_free', 'raised_guard']);
    expect(frameIds()).not.toContain('watch:recklessness');
    expect(
      document
        .querySelector('[data-proc="watch:recklessness"]')
        ?.classList.contains('loadout-hidden'),
    ).toBe(true);

    controller.setWatched('watch:recklessness', true);
    expect(controller.get('watch:recklessness')).toMatchObject({
      color: '#123456',
      scale: 1.2,
      enabled: true,
    });
    expect(frameIds()).toContain('watch:recklessness');
  });

  it('restores the picked spells for the same character on the next session', () => {
    makeController().setWatched('watch:recklessness', true);
    document.body.replaceChildren();

    const reloaded = makeController();
    expect(reloaded.defs().map((def) => def.id)).toContain('watch:recklessness');
    expect(reloaded.watchOptions()[0].watched).toBe(true);
    expect(frameIds()).toContain('watch:recklessness');
  });

  it('ignores a redundant toggle and never writes a duplicate', () => {
    const controller = makeController();
    controller.setWatched('watch:recklessness', true);
    controller.patch('watch:recklessness', { enabled: false });
    controller.setWatched('watch:recklessness', true);

    // Already watched: the call is a no-op, so it does not silently re-enable an
    // overlay the player deliberately switched off from its own card.
    expect(controller.get('watch:recklessness').enabled).toBe(false);
    expect(controller.defs().filter((def) => def.id === 'watch:recklessness')).toHaveLength(1);
    controller.setWatched('watch:recklessness', false);
    controller.setWatched('watch:recklessness', false);
    expect(controller.defs().map((def) => def.id)).toEqual(['revenge_free', 'raised_guard']);
  });

  it('drives the ground ring for a watched spell like any authored proc', () => {
    const rings: AuraGroundRingState[][] = [];
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: warriorKnown,
      iconUrl: (id) => `/icons/${id}.png`,
      paintGroundRings: (next) => rings.push(next.map((ring) => ({ ...ring }))),
    });
    controller.setWatched('watch:recklessness', true);

    controller.paint([{ id: 'recklessness', kind: 'buff_reckless' } as never]);
    const last = rings[rings.length - 1];
    expect(last.find((ring) => ring.id === 'watch:recklessness')?.visible).toBe(true);
    controller.paint([]);
    expect(rings[rings.length - 1].find((ring) => ring.id === 'watch:recklessness')?.visible).toBe(
      false,
    );
  });
});

describe('AuraOverlayController alert cues', () => {
  const warriorKnown = (): ResolvedAbility[] =>
    ['revenge', 'recklessness'].map((id) => ({ def: ABILITIES[id] }) as ResolvedAbility);
  const setup = () => {
    const played: Array<[string, number]> = [];
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: warriorKnown,
      iconUrl: (id) => `/icons/${id}.png`,
      playCue: (cueId, volume) => played.push([cueId, volume]),
    });
    return { controller, played };
  };
  const revengeUp = [{ id: 'revenge', kind: 'revenge_free' } as never];

  it('stays silent by default, however often a proc fires', () => {
    const { controller, played } = setup();
    controller.paint([]);
    controller.paint(revengeUp);
    controller.paint([]);
    controller.paint(revengeUp);
    expect(played).toEqual([]);
  });

  it('plays the chosen cue once on the RISING edge, not every frame it stays up', () => {
    const { controller, played } = setup();
    controller.patch('revenge_free', { soundId: 'ui_aura_hard_bell', soundVolume: 0.4 });
    controller.paint([]);
    controller.paint(revengeUp);
    controller.paint(revengeUp);
    controller.paint(revengeUp);
    expect(played).toEqual([['ui_aura_hard_bell', 0.4]]);

    // It re-announces only after the aura actually falls off and returns.
    controller.paint([]);
    controller.paint(revengeUp);
    expect(played).toHaveLength(2);
  });

  it('never announces an aura that was ALREADY up on the first frame', () => {
    // Logging in with a buff running, or picking a spell whose aura is live, is
    // not a proc: the first paint records state and says nothing.
    const { controller, played } = setup();
    controller.patch('revenge_free', { soundId: 'ui_aura_hard_bell' });
    controller.paint(revengeUp);
    expect(played).toEqual([]);
    controller.paint(revengeUp);
    expect(played).toEqual([]);
  });

  it('sounds a proc whose visual overlay is switched off, the sound-instead-of-aura case', () => {
    const { controller, played } = setup();
    controller.patch('revenge_free', { soundId: 'ui_aura_cat_meow', enabled: false });
    controller.paint([]);
    controller.paint(revengeUp);
    expect(played).toEqual([['ui_aura_cat_meow', 0.7]]);
  });

  it('keeps each proc on its own cue and its own edge', () => {
    const { controller, played } = setup();
    controller.setWatched('watch:recklessness', true);
    controller.patch('revenge_free', { soundId: 'ui_aura_hard_bell' });
    controller.patch('watch:recklessness', { soundId: 'ui_aura_wolf_howl' });
    controller.paint([]);
    controller.paint([{ id: 'recklessness', kind: 'buff_reckless' } as never]);
    expect(played).toEqual([['ui_aura_wolf_howl', 0.7]]);
    controller.paint([
      { id: 'recklessness', kind: 'buff_reckless' } as never,
      { id: 'revenge', kind: 'revenge_free' } as never,
    ]);
    // Recklessness was already up, so only the newly risen proc speaks.
    expect(played).toEqual([
      ['ui_aura_wolf_howl', 0.7],
      ['ui_aura_hard_bell', 0.7],
    ]);
  });

  it('carries the chosen cue and volume across a session', () => {
    setup().controller.patch('revenge_free', {
      soundId: 'ui_aura_temple_gong',
      soundVolume: 0.25,
    });
    document.body.replaceChildren();
    const { controller, played } = setup();
    expect(controller.get('revenge_free')).toMatchObject({
      soundId: 'ui_aura_temple_gong',
      soundVolume: 0.25,
    });
    controller.paint([]);
    controller.paint(revengeUp);
    expect(played).toEqual([['ui_aura_temple_gong', 0.25]]);
  });
});

describe('AuraOverlayController proc signal channels', () => {
  const warriorKnown = (): ResolvedAbility[] =>
    ['revenge', 'recklessness'].map((id) => ({ def: ABILITIES[id] }) as ResolvedAbility);
  const setup = () => {
    const haptics: string[] = [];
    const ticks: Array<{ id: string; active: boolean; angleDeg: number }[]> = [];
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'warrior',
      playerName: 'Raido',
      known: warriorKnown,
      iconUrl: (id) => `/icons/${id}.png`,
      playHaptic: (shape) => haptics.push(shape),
      paintReticleTicks: (state) => {
        const slots = state.slots as { id: string; active: boolean; angleDeg: number }[];
        ticks.push(slots.slice(0, state.count).map((s) => ({ ...s })));
      },
    });
    return { controller, haptics, ticks };
  };
  const revengeUp = [{ id: 'revenge', kind: 'revenge_free' } as never];

  it('lights no hotbar button until the player opts the proc into that channel', () => {
    const { controller } = setup();
    controller.paint(revengeUp);
    expect([...controller.readyGlowAbilityIds()]).toEqual([]);
    controller.patch('revenge_free', { showReadyGlow: true });
    controller.paint(revengeUp);
    expect([...controller.readyGlowAbilityIds()]).toEqual(['revenge']);
  });

  it('drops the glow as soon as the aura falls off', () => {
    const { controller } = setup();
    controller.patch('revenge_free', { showReadyGlow: true });
    controller.paint(revengeUp);
    expect([...controller.readyGlowAbilityIds()]).toEqual(['revenge']);
    controller.paint([]);
    expect([...controller.readyGlowAbilityIds()]).toEqual([]);
  });

  it('gives a reticle slot only to procs routed there, and keeps its angle steady', () => {
    const { controller, ticks } = setup();
    controller.setWatched('watch:recklessness', true);
    controller.patch('revenge_free', { showReticleTick: true });
    controller.patch('watch:recklessness', { showReticleTick: true });
    controller.paint([]);
    const resting = ticks[ticks.length - 1];
    expect(resting.map((t) => t.id)).toEqual(['revenge_free', 'watch:recklessness']);
    expect(resting.every((t) => !t.active)).toBe(true);

    controller.paint(revengeUp);
    const lit = ticks[ticks.length - 1];
    expect(lit.map((t) => t.active)).toEqual([true, false]);
    // The angles must not move when a neighbour fires.
    expect(lit.map((t) => t.angleDeg)).toEqual(resting.map((t) => t.angleDeg));
  });

  it('pulses on the rising edge only, and only for the chosen shape', () => {
    const { controller, haptics } = setup();
    controller.paint([]);
    controller.paint(revengeUp);
    expect(haptics).toEqual([]);

    controller.patch('revenge_free', { haptic: 'double' });
    controller.paint([]);
    controller.paint(revengeUp);
    controller.paint(revengeUp);
    expect(haptics).toEqual(['double']);
  });

  it('keeps the three channels independent of the visual overlay and of each other', () => {
    const { controller, haptics } = setup();
    // Show Aura off, every alternative channel on: the whole point of the feature.
    controller.patch('revenge_free', {
      enabled: false,
      showReadyGlow: true,
      showReticleTick: true,
      haptic: 'tap',
    });
    controller.paint([]);
    controller.paint(revengeUp);
    expect([...controller.readyGlowAbilityIds()]).toEqual(['revenge']);
    expect(haptics).toEqual(['tap']);
  });

  it('carries every channel choice across a session', () => {
    setup().controller.patch('revenge_free', {
      showReadyGlow: true,
      showReticleTick: true,
      haptic: 'long',
    });
    document.body.replaceChildren();
    expect(setup().controller.get('revenge_free')).toMatchObject({
      showReadyGlow: true,
      showReticleTick: true,
      haptic: 'long',
    });
  });
});
