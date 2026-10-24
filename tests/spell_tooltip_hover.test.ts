// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '../src/game/settings';
import { Hud } from '../src/ui/hud';
import type { HotbarAction } from '../src/ui/hud/action_bar/hotbar';
import { SharedTooltipOwner } from '../src/ui/tooltip_owner';
import { TouchPeekGuard } from '../src/ui/touch_peek';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  onPortraitUpdate: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

interface TooltipHud {
  optionsHooks?: { settings: Settings };
  tooltipEl: HTMLElement;
  tooltipOwner: SharedTooltipOwner<HTMLElement>;
  peekGuard: TouchPeekGuard;
  paintTooltipAt(content: string, x: number, y: number): { w: number; h: number };
  tooltipViewport(): { w: number; h: number; scale: number };
  attachTooltip(el: HTMLElement, html: () => string, isSpell?: () => boolean): void;
}

function tooltipHud(settings?: Settings) {
  const tooltipEl = document.createElement('div');
  document.body.append(tooltipEl);
  const paint = vi.fn((_content: string, _x: number, _y: number) => ({ w: 120, h: 80 }));
  const hud = Object.assign(Object.create(Hud.prototype) as TooltipHud, {
    tooltipEl,
    tooltipOwner: new SharedTooltipOwner<HTMLElement>(),
    peekGuard: new TouchPeekGuard(),
    paintTooltipAt: paint,
    tooltipViewport: () => ({ w: 800, h: 600, scale: 1 }),
    optionsHooks: settings ? { settings } : undefined,
  });
  return { hud, paint };
}

function hover(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent('mouseenter'));
  el.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 300 }));
}

beforeEach(() => {
  document.body.replaceChildren();
  document.body.className = '';
  localStorage.clear();
});

describe('Hud spell tooltip hover preference', () => {
  it('disables spell hover through the real Settings hook while keeping item tooltips', () => {
    const settings = new Settings();
    settings.set('spellTooltipOnHover', false);
    const { hud, paint } = tooltipHud(settings);
    const spell = document.createElement('button');
    const item = document.createElement('button');
    const spellHtml = vi.fn(() => 'spell tooltip');
    hud.attachTooltip(spell, spellHtml, () => true);
    hud.attachTooltip(
      item,
      () => 'item tooltip',
      () => false,
    );
    hover(spell);
    expect(spellHtml).not.toHaveBeenCalled();
    expect(paint).not.toHaveBeenCalled();
    hover(item);
    expect(paint).toHaveBeenCalledWith('item tooltip', expect.any(Number), expect.any(Number));
  });

  it('applies setting changes to spell controls already bound to the Hud', () => {
    const settings = new Settings();
    const { hud, paint } = tooltipHud(settings);
    const spell = document.createElement('button');
    hud.attachTooltip(
      spell,
      () => 'spell tooltip',
      () => true,
    );
    settings.set('spellTooltipOnHover', false);
    hover(spell);
    expect(paint).not.toHaveBeenCalled();
    settings.set('spellTooltipOnHover', true);
    hover(spell);
    expect(paint).toHaveBeenCalledTimes(1);
    settings.set('spellTooltipOnHover', false);
    hover(spell);
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it('keeps spell tooltips enabled before options hooks are attached', () => {
    const { hud, paint } = tooltipHud();
    const spell = document.createElement('button');
    hud.attachTooltip(
      spell,
      () => 'early spell tooltip',
      () => true,
    );
    hover(spell);
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it('classifies live bindings on primary, secondary, and third action rows', () => {
    document.body.innerHTML =
      '<div id="actionbar"></div><div id="actionbar2"></div><div id="actionbar3"></div>';
    const settings = new Settings();
    settings.set('spellTooltipOnHover', false);
    const { hud, paint } = tooltipHud(settings);
    const actions = new Map<number, HotbarAction>();
    let attack = true;
    let freedAbility = false;
    const callbacks = new Map<number, () => boolean>();
    const known = { def: { id: 'heroic_strike' } };
    const item = { id: 'healing_potion' };
    const host = Object.assign(hud, {
      abilityButtons: [] as { btn: HTMLElement }[],
      actionbarEl: document.getElementById('actionbar'),
      keybinds: { primaryLabel: () => '' },
      sim: { equipment: { trinket: null } },
      bindEmpoweredActionHold: vi.fn(),
      actionForSlot: (slot: number) => actions.get(slot) ?? null,
      attackSlotIsAttack: () => attack,
      freedAttackSlotAbility: () => (freedAbility ? known : null),
      abilityForSlot: (slot: number) =>
        actions.get(slot)?.type === 'ability' && !(slot === 0 && freedAbility) ? known : null,
      itemForSlot: (slot: number) => (actions.get(slot)?.type === 'item' ? item : null),
      abilityTooltip: () => 'spell details',
      itemTooltip: () => 'item details',
      inventoryCount: () => 1,
      buildMobileActionRing: vi.fn(),
      buildMobileConsumableSeat: vi.fn(),
      buildStanceBar: vi.fn(),
      attachTooltip: (el: HTMLElement, html: () => string, isSpell?: () => boolean) => {
        if (el.dataset.hotbarSlot !== undefined && isSpell) {
          callbacks.set(Number(el.dataset.hotbarSlot), isSpell);
        }
        Hud.prototype.attachTooltip.call(hud as unknown as Hud, el, html, isSpell);
      },
    });
    const build = Hud.prototype as unknown as { buildActionBar(this: TooltipHud): void };
    build.buildActionBar.call(host);

    for (const slot of [1, 12, 23]) {
      const btn = host.abilityButtons[slot].btn;
      expect(btn.parentElement?.id).toBe(
        slot === 1 ? 'actionbar' : slot === 12 ? 'actionbar2' : 'actionbar3',
      );
      actions.set(slot, { type: 'ability', id: 'heroic_strike' });
      expect(callbacks.get(slot)?.()).toBe(true);
      paint.mockClear();
      hover(btn);
      expect(paint).not.toHaveBeenCalled();
      actions.set(slot, { type: 'item', id: 'healing_potion' });
      expect(callbacks.get(slot)?.()).toBe(false);
      hover(btn);
      expect(paint).toHaveBeenCalledTimes(1);
      actions.delete(slot);
      expect(callbacks.get(slot)?.()).toBe(false);
    }

    expect(callbacks.get(0)?.()).toBe(true);
    attack = false;
    actions.set(0, { type: 'item', id: 'healing_potion' });
    expect(callbacks.get(0)?.()).toBe(false);
    actions.set(0, { type: 'ability', id: 'heroic_strike' });
    expect(callbacks.get(0)?.()).toBe(true);
    freedAbility = true;
    expect(host.abilityForSlot(0)).toBeNull();
    expect(callbacks.get(0)?.()).toBe(true);
    paint.mockClear();
    hover(host.abilityButtons[0].btn);
    expect(paint).not.toHaveBeenCalled();
  });
});
