// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { DeathRecapDialog } from '../src/ui/death_recap_dialog';
import {
  buildDeathRecapCards,
  buildDeathRecapSummary,
  formatRecapHp,
  formatRecapTime,
} from '../src/ui/death_recap_view';
import type { DeathRecapEvent, DeathRecapRecord } from '../src/ui/meters_death_recap';

describe('death_recap_view (pure presentation core)', () => {
  it('formats relative timestamps accurately', () => {
    expect(formatRecapTime(-3200)).toBe('-3.2s');
    expect(formatRecapTime(-150)).toBe('-0.1s');
    expect(formatRecapTime(-20)).toBe(' 0.0s');
    expect(formatRecapTime(0)).toBe(' 0.0s');
    expect(formatRecapTime(25)).toBe(' 0.0s');
  });

  it('formats HP values and percentages correctly', () => {
    const full = formatRecapHp(1000, 1000);
    expect(full.hpPercent).toBe(100);
    expect(full.hpStr).toBe('1000 / 1000 (100%)');

    const half = formatRecapHp(450, 1000);
    expect(half.hpPercent).toBe(45);
    expect(half.hpStr).toBe('450 / 1000 (45%)');

    const dead = formatRecapHp(0, 1000);
    expect(dead.hpPercent).toBe(0);
    expect(dead.hpStr).toContain('0 / 1000 (0%)');

    const noMax = formatRecapHp(250, undefined);
    expect(noMax.hpPercent).toBe(100);
    expect(noMax.hpStr).toContain('250 HP');

    const undefinedHp = formatRecapHp(undefined, 1000);
    expect(undefinedHp.hpPercent).toBe(0);
    expect(undefinedHp.hpStr).toBe('');
  });

  it('builds combat event cards with damage, heals, crits, and lethal hit', () => {
    const events: DeathRecapEvent[] = [
      {
        timestamp: 1000,
        type: 'damage',
        ability: 'Melee',
        abilityId: 'attack',
        sourceName: 'Defias Bandit',
        sourceId: 10,
        amount: 300,
        hpBefore: 1000,
        hpAfter: 700,
        maxHp: 1000,
        school: 'physical',
        crit: false,
      },
      {
        timestamp: 2500,
        type: 'heal',
        ability: 'Flash Heal',
        abilityId: 'flash_heal',
        sourceName: 'Allied Priest',
        sourceId: 2,
        amount: 250,
        hpBefore: 700,
        hpAfter: 950,
        maxHp: 1000,
        crit: true,
      },
      {
        timestamp: 3200,
        type: 'absorb',
        ability: 'Shield Absorbed',
        sourceName: 'Power Word: Shield',
        sourceId: 0,
        amount: 150,
        hpBefore: 950,
        hpAfter: 950,
        maxHp: 1000,
      },
      {
        timestamp: 4000,
        type: 'damage',
        ability: 'Fireball',
        abilityId: 'fireball',
        sourceName: 'Defias Pillager',
        sourceId: 12,
        amount: 950,
        hpBefore: 950,
        hpAfter: 0,
        maxHp: 1000,
        school: 'fire',
        crit: true,
        lethal: true,
      },
    ];

    const record: DeathRecapRecord = {
      pid: 1,
      playerName: 'Hero',
      deathTime: 4000,
      killerName: 'Defias Pillager',
      killerAbility: 'Fireball',
      events,
    };

    const cards = buildDeathRecapCards(record);
    expect(cards).toHaveLength(4);

    // Card 0: initial melee
    expect(cards[0].ability).toBe('Melee');
    expect(cards[0].sourceName).toBe('Defias Bandit');
    expect(cards[0].amountStr).toBe('-300');
    expect(cards[0].timeRel).toBe('-3.0s');
    expect(cards[0].hpPercent).toBe(70);
    expect(cards[0].lethal).toBe(false);
    expect(cards[0].school).toBe('physical');

    // Card 1: incoming heal
    expect(cards[1].ability).toBe('Flash Heal');
    expect(cards[1].sourceName).toBe('Allied Priest');
    expect(cards[1].amountStr).toBe('+250');
    expect(cards[1].type).toBe('heal');
    expect(cards[1].crit).toBe(true);
    expect(cards[1].hpPercent).toBe(95);

    // Card 2: absorb
    expect(cards[2].type).toBe('absorb');
    expect(cards[2].amountStr).toContain('150 abs');

    // Card 3: lethal fireball
    expect(cards[3].ability).toBe('Fireball');
    expect(cards[3].sourceName).toBe('Defias Pillager');
    expect(cards[3].amountStr).toBe('-950');
    expect(cards[3].timeRel).toBe(' 0.0s');
    expect(cards[3].hpPercent).toBe(0);
    expect(cards[3].lethal).toBe(true);
    expect(cards[3].school).toBe('fire');
    expect(cards[3].crit).toBe(true);
  });

  it('caps card count to maxCards while preserving the final sequence', () => {
    const events: DeathRecapEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push({
        timestamp: 1000 + i * 200,
        type: 'damage',
        ability: `Attack ${i}`,
        sourceName: 'Enemy',
        sourceId: 5,
        amount: 50,
        hpBefore: 1000 - i * 50,
        hpAfter: 950 - i * 50,
        maxHp: 1000,
      });
    }

    const record: DeathRecapRecord = {
      pid: 1,
      playerName: 'Hero',
      deathTime: 1000 + 19 * 200,
      events,
    };

    const cards = buildDeathRecapCards(record, 5);
    expect(cards).toHaveLength(5);
    // Should contain the last 5 events (Attack 15 to Attack 19)
    expect(cards[0].ability).toBe('Attack 15');
    expect(cards[4].ability).toBe('Attack 19');
    expect(cards[4].lethal).toBe(true);
  });

  it('computes death recap summary totals accurately', () => {
    const record: DeathRecapRecord = {
      pid: 1,
      playerName: 'Hero',
      deathTime: 5000,
      killerName: 'Ignivar',
      killerAbility: 'Magma Burst',
      events: [
        {
          timestamp: 3000,
          type: 'damage',
          ability: 'Melee',
          sourceName: 'Ignivar',
          sourceId: 99,
          amount: 600,
        },
        {
          timestamp: 4000,
          type: 'heal',
          ability: 'Greater Heal',
          sourceName: 'Priest',
          sourceId: 2,
          amount: 400,
        },
        {
          timestamp: 5000,
          type: 'damage',
          ability: 'Magma Burst',
          sourceName: 'Ignivar',
          sourceId: 99,
          amount: 1200,
          lethal: true,
        },
      ],
    };

    const summary = buildDeathRecapSummary(record);
    expect(summary.killerName).toBe('Ignivar');
    expect(summary.killerAbility).toBe('Magma Burst');
    expect(summary.totalDamage).toBe(1800);
    expect(summary.totalHeal).toBe(400);
    expect(summary.cards).toHaveLength(3);
  });
});

describe('DeathRecapDialog (DOM dialog controller)', () => {
  it('opens, populates HTML with WoW-style components, and attaches tooltips', () => {
    const rootEl = document.createElement('div');
    rootEl.id = 'death-recap-dialog';
    rootEl.className = 'window panel';
    document.body.appendChild(rootEl);

    const attachedTooltips = new Map<HTMLElement, () => string>();
    const attachTooltip = vi.fn((el: HTMLElement, htmlFn: () => string) => {
      attachedTooltips.set(el, htmlFn);
    });
    const hideTooltip = vi.fn();

    const sampleRecord: DeathRecapRecord = {
      pid: 1,
      playerName: 'Player1',
      deathTime: 3000,
      killerName: 'Grave Creeper',
      killerAbility: 'Shadow Bolt',
      events: [
        {
          timestamp: 1000,
          type: 'damage',
          ability: 'Melee',
          abilityId: 'attack',
          sourceName: 'Grave Creeper',
          sourceId: 20,
          amount: 400,
          hpBefore: 1200,
          hpAfter: 800,
          maxHp: 1200,
          school: 'physical',
        },
        {
          timestamp: 2000,
          type: 'heal',
          ability: 'Holy Light',
          abilityId: 'holy_light',
          sourceName: 'PaladinBot',
          sourceId: 3,
          amount: 300,
          hpBefore: 800,
          hpAfter: 1100,
          maxHp: 1200,
          crit: true,
        },
        {
          timestamp: 3000,
          type: 'damage',
          ability: 'Shadow Bolt',
          abilityId: 'shadow_bolt',
          sourceName: 'Grave Creeper',
          sourceId: 20,
          amount: 1100,
          hpBefore: 1100,
          hpAfter: 0,
          maxHp: 1200,
          school: 'shadow',
          crit: true,
          lethal: true,
        },
      ],
    };

    const dialog = new DeathRecapDialog({
      root: () => rootEl,
      getLatestRecap: () => sampleRecord,
      attachTooltip,
      hideTooltip,
      previewResolvedAbility: () => null,
      abilityTooltip: () => '',
    });

    expect(dialog.isOpen()).toBe(false);

    dialog.open();
    expect(dialog.isOpen()).toBe(true);
    expect(rootEl.style.display).toBe('flex');

    // Title and close button
    const title = rootEl.querySelector('#death-recap-title');
    expect(title).not.toBeNull();

    // Summary line with killer name
    expect(rootEl.innerHTML).toContain('Grave Creeper');
    expect(rootEl.innerHTML).toContain('Shadow Bolt');

    // Cards rendered
    const cards = rootEl.querySelectorAll('.recap-card');
    expect(cards).toHaveLength(3);

    // Lethal card check
    const lethalCard = rootEl.querySelector('.recap-card-lethal');
    expect(lethalCard).not.toBeNull();
    expect(lethalCard?.textContent).toContain('Shadow Bolt');
    expect(lethalCard?.textContent).toMatch(/-1,?100/);

    // Healing card check
    const healCard = rootEl.querySelector('.recap-card-heal');
    expect(healCard).not.toBeNull();
    expect(healCard?.textContent).toContain('Holy Light');
    expect(healCard?.textContent).toContain('+300');

    // Tooltip attached to all cards
    expect(attachTooltip).toHaveBeenCalledTimes(3);

    // Verify generated tooltip content for the shadow bolt card
    const lethalCardEl = cards[2] as HTMLElement;
    const tooltipFn = attachedTooltips.get(lethalCardEl);
    expect(tooltipFn).toBeDefined();
    const tooltipHtml = tooltipFn?.() ?? '';
    expect(tooltipHtml).toContain('Shadow Bolt');
    expect(tooltipHtml).toContain('SHADOW');
    expect(tooltipHtml).toContain('Grave Creeper');
    expect(tooltipHtml).toMatch(/-1,?100/);

    // Close dialog
    dialog.close();
    expect(dialog.isOpen()).toBe(false);
    expect(rootEl.style.display).toBe('none');
    expect(hideTooltip).toHaveBeenCalled();

    // Toggle back on
    dialog.toggle();
    expect(dialog.isOpen()).toBe(true);

    dialog.close();
    rootEl.remove();
  });

  it('handles empty death recap record gracefully', () => {
    const rootEl = document.createElement('div');
    rootEl.id = 'death-recap-dialog';
    document.body.appendChild(rootEl);

    const dialog = new DeathRecapDialog({
      root: () => rootEl,
      getLatestRecap: () => null,
      attachTooltip: vi.fn(),
      hideTooltip: vi.fn(),
    });

    dialog.open();
    expect(dialog.isOpen()).toBe(true);
    expect(rootEl.querySelector('.death-recap-empty')).not.toBeNull();

    dialog.close();
    rootEl.remove();
  });
});
