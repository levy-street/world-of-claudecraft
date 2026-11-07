// @vitest-environment happy-dom
// The island coach's press-this-next glow on the touch ring's two layouts.
// The ring reuses the same data-mobile-index for combat slots and utility
// shortcuts, so an unqualified index selector lit Mount for a lesson about
// auto-attacking the effigy. These pin the layout-aware routing: combat asks
// move to the layout switch on the utility layout, and the bag ask points at
// the utility ring's own Bags shortcut.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The coach only needs the Talking Head's DOM wiring here; importing the real
// portrait pipeline starts GLB fetches that outlive happy-dom teardown.
vi.mock('../src/render/characters/portrait', () => ({
  modularPortraitDataUrl: vi.fn(() => null),
  onPortraitsReady: vi.fn(),
  onPortraitUpdate: vi.fn(),
  playerPortraitDataUrl: vi.fn(() => null),
  portraitsReady: vi.fn(() => false),
  visualPortraitDataUrl: vi.fn(() => null),
}));

import { BootcampOverlay } from '../src/ui/bootcamp';

type PromptButtonGlow =
  | 'mobile-interact'
  | 'mobile-jump'
  | 'mobile-action-attack'
  | 'mobile-slot-primary'
  | null;

interface CoachInternals {
  applyUiGlow(world: { bags: readonly (string | null)[] }): void;
  glowTick: number;
  lastFocus: null;
  ringPhase: 'equip' | 'admire' | null;
  promptButtonGlow: PromptButtonGlow;
  deathPhase: 'alive';
  ensureDom(): void;
  glowPainted: string;
  glowEl: HTMLElement;
  paintObjectiveGlow(world: unknown, renderer: unknown): void;
}

const MODE = '#mobile-action-mode';
const PAGE_TOGGLE = '#mobile-utility-page-toggle';
const ATTACK = '#mobile-action-attack';
const PRIMARY_SLOT =
  '#mobile-action-ring .mobile-action-slot:not(.mobile-utility-action)[data-mobile-index="0"]';
const UTILITY_BAGS = '#mobile-utility-actions .mobile-utility-action[data-utility-action="bags"]';
const UTILITY_CHAR = '#mobile-utility-actions .mobile-utility-action[data-utility-action="char"]';
const UTILITY_MOUNT = '#mobile-utility-actions .mobile-utility-action[data-utility-action="mount"]';
const ANCHOR = '#mobile-menu-anchor';

function isGlowing(selector: string): boolean {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element.classList.contains('qd-coach');
}

function runGlow(coach: CoachInternals, surface: 'combat' | 'utility'): void {
  const ring = document.getElementById('mobile-action-ring');
  if (!ring) throw new Error('missing #mobile-action-ring');
  ring.dataset.actionSurface = surface;
  // applyUiGlow runs once every ten frames; land on the tick it fires.
  coach.glowTick = 9;
  coach.applyUiGlow({ bags: [] });
}

beforeEach(() => {
  document.body.className = 'mobile-touch';
  document.body.innerHTML = `
    <div id="ui">
      <div id="mobile-action-ring" data-action-surface="utility">
        <button id="mobile-action-mode"></button>
        <button id="mobile-utility-page-toggle"></button>
        <button id="mobile-action-attack"></button>
        <button class="mobile-action-slot" data-mobile-index="0"></button>
        <button class="mobile-action-slot" data-mobile-index="1"></button>
        <div id="mobile-utility-actions">
          <button class="mobile-action-slot mobile-utility-action" data-mobile-index="0" data-utility-action="mount"></button>
          <button class="mobile-action-slot mobile-utility-action" data-mobile-index="1" data-utility-action="map"></button>
          <button class="mobile-action-slot mobile-utility-action" data-mobile-index="2" data-utility-action="bags"></button>
          <button class="mobile-action-slot mobile-utility-action" data-mobile-index="3" data-utility-action="char"></button>
        </div>
      </div>
      <button id="mobile-menu-anchor" aria-expanded="false"></button>
      <button id="mobile-menu-bags"></button>
      <button id="mobile-menu-char"></button>
    </div>`;
});

describe('the island coach glow on the touch action ring', () => {
  it('moves the auto-attack ask to the layout switch while the utility layout is up', () => {
    const coach = new BootcampOverlay() as unknown as CoachInternals;
    coach.promptButtonGlow = 'mobile-action-attack';

    runGlow(coach, 'utility');

    expect(isGlowing(MODE), 'the Combat switch is the next press').toBe(true);
    expect(isGlowing(ATTACK), 'the hidden combat attack is not the lesson').toBe(false);
    expect(isGlowing(UTILITY_MOUNT), 'Mount is not the lesson').toBe(false);
  });

  it('moves the primary-slot ask to the layout switch on the utility layout', () => {
    const coach = new BootcampOverlay() as unknown as CoachInternals;
    coach.promptButtonGlow = 'mobile-slot-primary';

    runGlow(coach, 'utility');

    expect(isGlowing(MODE), 'the Combat switch is the next press').toBe(true);
    expect(isGlowing(PRIMARY_SLOT), 'the combat slot is hidden').toBe(false);
    expect(isGlowing(UTILITY_MOUNT), 'data-mobile-index 0 is Mount here').toBe(false);
  });

  it('keeps the auto-attack ask on the attack button on the combat layout', () => {
    const coach = new BootcampOverlay() as unknown as CoachInternals;
    coach.promptButtonGlow = 'mobile-action-attack';

    runGlow(coach, 'combat');

    expect(isGlowing(ATTACK)).toBe(true);
    expect(isGlowing(MODE)).toBe(false);
    expect(isGlowing(UTILITY_MOUNT)).toBe(false);
  });

  it('lights the utility ring Bags shortcut for the equip ask', () => {
    const coach = new BootcampOverlay() as unknown as CoachInternals;
    coach.ringPhase = 'equip';

    runGlow(coach, 'utility');

    expect(isGlowing(UTILITY_BAGS), 'Bags is one tap away on the ring').toBe(true);
    expect(isGlowing(MODE)).toBe(false);
    expect(isGlowing(ANCHOR), 'Quick Actions is no longer the path').toBe(false);
  });

  it('lights the layout switch first for the equip ask on the combat layout', () => {
    const coach = new BootcampOverlay() as unknown as CoachInternals;
    coach.ringPhase = 'equip';

    runGlow(coach, 'combat');

    expect(isGlowing(MODE), 'switch to Utility, then Bags').toBe(true);
    expect(isGlowing(ANCHOR)).toBe(false);
    expect(isGlowing(UTILITY_BAGS)).toBe(false);
  });

  it('lights the page toggle when the current utility page has no Bags', () => {
    const coach = new BootcampOverlay() as unknown as CoachInternals;
    coach.ringPhase = 'equip';
    const bagsButton = document.querySelector<HTMLElement>(UTILITY_BAGS);
    expect(bagsButton, 'the page-1 Bags shortcut').not.toBeNull();
    bagsButton?.setAttribute('data-utility-action', 'chat');

    runGlow(coach, 'utility');

    expect(isGlowing(PAGE_TOGGLE), 'one tap flips to the page with Bags').toBe(true);
    expect(isGlowing(ANCHOR), 'Quick Actions is no longer the path').toBe(false);
    expect(isGlowing(MODE)).toBe(false);
    expect(bagsButton?.classList.contains('qd-coach'), 'the repurposed slot stays dark').toBe(
      false,
    );
  });

  it('lights the utility Character shortcut for the character-sheet ask', () => {
    const coach = new BootcampOverlay() as unknown as CoachInternals;
    coach.ringPhase = 'admire';

    runGlow(coach, 'utility');

    expect(isGlowing(UTILITY_CHAR), 'the sheet is one tap away on the ring').toBe(true);
    expect(isGlowing(ANCHOR), 'Quick Actions is no longer the path').toBe(false);
    expect(isGlowing('#mobile-menu-char')).toBe(false);
    expect(isGlowing(MODE)).toBe(false);
  });

  it('lights the layout switch first for the character-sheet ask on the combat layout', () => {
    const coach = new BootcampOverlay() as unknown as CoachInternals;
    coach.ringPhase = 'admire';

    runGlow(coach, 'combat');

    expect(isGlowing(MODE), 'switch to Utility, then Character').toBe(true);
    expect(isGlowing(ANCHOR)).toBe(false);
    expect(isGlowing(UTILITY_CHAR)).toBe(false);
  });

  it('lights the page toggle when Character waits on the other utility page', () => {
    const coach = new BootcampOverlay() as unknown as CoachInternals;
    coach.ringPhase = 'admire';
    const charButton = document.querySelector<HTMLElement>(UTILITY_CHAR);
    expect(charButton, 'the page-1 Character shortcut').not.toBeNull();
    charButton?.setAttribute('data-utility-action', 'crafting');

    runGlow(coach, 'utility');

    expect(isGlowing(PAGE_TOGGLE), 'one tap flips to the page with Character').toBe(true);
    expect(isGlowing(ANCHOR)).toBe(false);
    expect(isGlowing(MODE)).toBe(false);
  });

  it('keeps the Quick Actions path when the ring markup is absent', () => {
    const coach = new BootcampOverlay() as unknown as CoachInternals;
    coach.ringPhase = 'admire';
    document.getElementById('mobile-action-ring')?.remove();

    coach.glowTick = 9;
    coach.applyUiGlow({ bags: [] });

    expect(isGlowing(ANCHOR), 'an older shell still has the strip').toBe(true);
    expect(isGlowing('#mobile-menu-char')).toBe(true);
  });
});

// The full-width wash down the bottom edge (`.tut-glow-bottom`) was the cue for
// the desktop bag row. On touch the ring answers the ask itself, so the wash is
// a second, vaguer highlight across the whole screen instead of one control.
describe('the island coach edge bloom during a bag lesson', () => {
  function paint(overlay: CoachInternals): void {
    overlay.ensureDom();
    overlay.ringPhase = 'equip';
    // Seed the memo so the first paint is not skipped as unchanged.
    overlay.glowPainted = 'seed';
    overlay.paintObjectiveGlow({ player: null, bags: [] }, {});
  }

  it('skips the bottom wash on touch, where the ring pulses the exact control', () => {
    const coach = new BootcampOverlay() as unknown as CoachInternals;

    paint(coach);

    expect(coach.glowEl.classList.contains('tut-glow-bottom')).toBe(false);
    expect(coach.glowEl.style.opacity).toBe('0');
  });

  it('keeps the bottom wash on desktop, where the bag slots line the bottom bar', () => {
    document.body.className = '';
    const coach = new BootcampOverlay() as unknown as CoachInternals;

    paint(coach);

    expect(coach.glowEl.classList.contains('tut-glow-bottom')).toBe(true);
    expect(coach.glowEl.style.opacity).toBe('0.72');
  });
});
