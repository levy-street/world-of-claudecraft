// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TalentAllocation } from '../src/sim/content/talents';
import type { ResolvedAbility } from '../src/sim/sim';
import { AuraOverlayConfigStore, defaultAuraOverlayConfig } from '../src/ui/aura_overlay_config';
import { AuraOverlayController } from '../src/ui/aura_overlay_controller';
import type { PainterHostWriters } from '../src/ui/painter_host';

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

const known = (...ids: string[]): ResolvedAbility[] =>
  ids.map((id) => ({ def: { id } }) as ResolvedAbility);

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
    let currentTalents: TalentAllocation = {
      spec: 'elemental',
      rows: { 5: 'sha_r5_concussion' },
    };
    const controller = new AuraOverlayController({
      doc: document,
      writers,
      playerClass: 'shaman',
      playerName: 'Thrall',
      known: () => known('lightning_bolt'),
      talents: () => currentTalents,
      iconUrl: (id) => `/icons/${id}.png`,
    });

    expect(document.querySelector('[data-proc="sha_fault_line"]')).not.toBeNull();
    currentTalents = {
      spec: 'elemental',
      rows: { 5: 'sha_r5_improved_lightning_shield' },
    };
    controller.paint([]);

    expect(
      document.querySelector('[data-proc="sha_fault_line"]')?.classList.contains('loadout-hidden'),
    ).toBe(true);
    expect(document.querySelector('[data-proc="sha_ward_surge"]')).not.toBeNull();
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
