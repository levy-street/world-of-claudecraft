// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSportKit } from '../src/sim/content/vale_cup';
import type { AbilityDef } from '../src/sim/types';
import { Hud } from '../src/ui/hud';
import type {
  ActionBarPainter,
  ActionBarSlotElements,
} from '../src/ui/hud/action_bar/action_bar_painter';
import {
  ABILITY_ICON_PREFIX,
  type ActionBarAbility,
  type ActionBarDeps,
  type ActionBarSlotDescriptor,
  type ActionBarState,
  type ActionBarView,
  type ActionBarWorldInput,
  ATTACK_ICON_KEY,
  createActionBarView,
} from '../src/ui/hud/action_bar/action_bar_view';
import { MobileActionRingPainter } from '../src/ui/hud/action_bar/mobile_action_ring_painter';
import { setLanguage } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  onPortraitUpdate: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

const MOBILE_HUD_CSS = readFileSync(join(__dirname, '../src/styles/hud.mobile.css'), 'utf8');

interface SportHudHarness {
  sim: {
    cupInfo: { match: object } | null;
    known: ActionBarAbility[];
    player: {
      spellPower: number;
      rangedPower: number;
      attackPower: number;
      resourceType: 'rage';
      spellHaste: number;
      auras: [];
    };
    talents: { spec: null };
  };
  firstSportAbility(): ActionBarAbility | null;
  abilityTooltip(ability: ActionBarAbility): string;
  actionBarIconBg(iconKey: string): string;
}

interface ProductionDesktopHudHarness extends SportHudHarness {
  abilityButtons: ActionBarSlotElements[];
  actionbarEl: HTMLElement;
  writerFacet: ReturnType<typeof makeWriterFacet>;
  keybinds: { primaryLabel(action: string): string };
  actionBarController: {
    actionForSlot(slot: number): null;
    isAttackSlotFixed(): boolean;
    isAssignableAction(): boolean;
  };
  actionBarView: ActionBarView;
  actionBarPainter: ActionBarPainter;
  attachTooltip(element: HTMLElement, html: () => string): void;
  buildActionBar(): void;
}

function sportHud(shoot: ActionBarAbility): SportHudHarness {
  const hud = Object.create(Hud.prototype) as unknown as SportHudHarness;
  hud.sim = {
    cupInfo: { match: {} },
    known: [shoot],
    player: {
      spellPower: 0,
      rangedPower: 0,
      attackPower: 0,
      resourceType: 'rage',
      spellHaste: 0,
      auras: [],
    },
    talents: { spec: null },
  };
  return hud;
}

function productionDesktopHud(shoot: ActionBarAbility): {
  hud: ProductionDesktopHudHarness;
  tooltips: Map<HTMLElement, () => string>;
} {
  document.body.innerHTML = `
    <div id="actionbar"></div>
    <div id="actionbar2"></div>
    <div id="actionbar3"></div>
  `;
  const hud = sportHud(shoot) as ProductionDesktopHudHarness;
  const tooltips = new Map<HTMLElement, () => string>();
  hud.abilityButtons = [];
  hud.actionbarEl = document.getElementById('actionbar') as HTMLElement;
  hud.writerFacet = writers();
  hud.keybinds = { primaryLabel: (action) => (action === 'slot0' ? '1' : '') };
  hud.actionBarController = {
    actionForSlot: () => null,
    isAttackSlotFixed: () => true,
    isAssignableAction: () => true,
  };
  hud.attachTooltip = (element, html) => tooltips.set(element, html);
  hud.buildActionBar();
  return { hud, tooltips };
}

function actionBarDeps(): ActionBarDeps {
  return {
    t: (key, values) => (values ? `${key}|${JSON.stringify(values)}` : key),
    abilityName: (def: AbilityDef) => def.name,
    itemName: (item) => item.name,
    slotLabel: (slotIndex) => String(slotIndex + 1),
    formatCount: String,
  };
}

function idleWorld(): ActionBarWorldInput {
  return {
    player: {
      id: 1,
      autoAttack: false,
      dead: false,
      resource: 100,
      cooldowns: new Map(),
      gcdRemaining: 0,
      potionCdRemaining: 0,
      queuedOnSwing: null,
      auras: [],
      pos: { x: 0, y: 0, z: 0 },
    },
    target: null,
    inventory: [],
    stealthed: false,
    entities: [],
  };
}

function fixedSeatDescriptor(
  current: { ability: ActionBarAbility | null },
  slotCount: number,
): ActionBarSlotDescriptor[] {
  return Array.from({ length: slotCount }, (_, slotIndex) =>
    slotIndex === 0
      ? {
          slotIndex,
          isAttack: () => current.ability === null,
          hasAction: () => current.ability !== null,
          ability: () => current.ability,
          item: () => null,
          keybindLabel: () => (slotIndex === 0 ? '1' : ''),
        }
      : {
          slotIndex,
          isAttack: () => false,
          hasAction: () => false,
          ability: () => null,
          item: () => null,
          keybindLabel: () => '',
        },
  );
}

function slotElements(button?: HTMLButtonElement): ActionBarSlotElements {
  const btn = button ?? document.createElement('button');
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K) => document.createElement(tag);
  return {
    btn,
    label: make('span'),
    countEl: make('span'),
    keybindEl: make('span'),
    cdOverlay: make('div'),
    cdText: make('div'),
    rechargeOverlay: make('div'),
  };
}

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

beforeEach(() => {
  setLanguage('en');
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('Vale Cup fixed primary action UI', () => {
  it('builds the real desktop HUD seat with the sport move, painted art, and live tooltip', () => {
    const shoot = resolveSportKit('striker')[0];
    expect(shoot.def.id).toBe('sport_shoot');
    const { hud, tooltips } = productionDesktopHud(shoot);
    const state: ActionBarState = hud.actionBarView.tick(idleWorld());
    hud.actionBarPainter.paint(state);
    const primary = hud.abilityButtons[0];

    expect(state.slots[0]).toMatchObject({
      kind: 'ability',
      abilityId: 'sport_shoot',
      iconKey: `${ABILITY_ICON_PREFIX}sport_shoot`,
    });
    expect(primary.btn.classList.contains('ability')).toBe(true);
    expect(primary.label.style.backgroundImage).toContain('/ui/skills/warrior/sport_shoot.webp');
    expect(primary.btn.getAttribute('aria-label')).toContain('Shoot');

    const tooltip = tooltips.get(primary.btn)?.();
    expect(tooltip).toContain('<div class="tt-title">Shoot</div>');
    expect(tooltip).toContain('Hold to build power, release to shoot at goal.');
    expect(tooltip).toContain('Too much power sails over.');
    expect(tooltip).toContain('34');
  });

  it('suppresses the hydrated mobile sword only while the painted sport move occupies the seat', () => {
    const cssRule = MOBILE_HUD_CSS.match(
      /body\.mobile-touch #mobile-action-attack\.ability \.ui-icon \{([^}]+)\}/,
    );
    expect(cssRule, 'mobile sport sword-suppression rule').not.toBeNull();
    const style = document.createElement('style');
    style.textContent = `body.mobile-touch #mobile-action-attack.ability .ui-icon {${cssRule?.[1] ?? ''}}`;
    document.head.appendChild(style);
    document.body.classList.add('mobile-touch');

    const ring = document.createElement('div');
    ring.id = 'mobile-action-ring';
    document.body.appendChild(ring);
    const attackButton = document.createElement('button');
    attackButton.id = 'mobile-action-attack';
    const sword = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sword.classList.add('ui-icon');
    attackButton.appendChild(sword);
    ring.appendChild(attackButton);

    const shoot = resolveSportKit('striker')[0];
    const hud = sportHud(shoot);
    const current = { ability: hud.firstSportAbility() };
    const view = createActionBarView({ slots: fixedSeatDescriptor(current, 6) }, actionBarDeps());
    const elements = [
      slotElements(attackButton),
      ...Array.from({ length: 5 }, () => slotElements()),
    ];
    for (const element of elements) element.btn.appendChild(element.label);
    const painter = new MobileActionRingPainter(
      writers(),
      {
        bar: { container: ring, slots: elements },
        pageToggle: document.createElement('button'),
        pageIndicator: document.createElement('span'),
      },
      (iconKey) => (iconKey === ATTACK_ICON_KEY ? '' : hud.actionBarIconBg(iconKey)),
      actionBarDeps().t,
    );

    painter.paint(view.tick(idleWorld()), 0, 1);
    expect(attackButton.classList.contains('ability')).toBe(true);
    expect(elements[0].label.style.backgroundImage).toContain(
      '/ui/skills/warrior/sport_shoot.webp',
    );
    expect(getComputedStyle(sword).display).toBe('none');

    hud.sim.cupInfo = null;
    current.ability = hud.firstSportAbility();
    expect(current.ability).toBeNull();
    painter.paint(view.tick(idleWorld()), 0, 1);
    expect(attackButton.classList.contains('ability')).toBe(false);
    expect(elements[0].label.style.backgroundImage).toBe('');
    expect(attackButton.querySelector(':scope > .ui-icon')).toBe(sword);
    expect(getComputedStyle(sword).display).not.toBe('none');
  });
});
