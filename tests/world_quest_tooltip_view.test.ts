import { beforeEach, describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import type { ItemDef, WorldQuestDef } from '../src/sim/types';
import {
  withItemLevelLine,
  worldQuestTooltipHtml,
} from '../src/ui/hud/map/world_quest_tooltip_html';
import {
  buildWorldQuestTooltip,
  type WorldQuestTooltipItemReward,
  type WorldQuestTooltipModel,
} from '../src/ui/hud/map/world_quest_tooltip_view';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import {
  worldQuestFactionCurrencyRewardText,
  worldQuestFactionLine,
  worldQuestStandingRewardText,
} from '../src/ui/world_quest_view';

const NOW = Date.UTC(2026, 7, 31, 12, 0);
const TEN_HOURS = NOW + 10 * 60 * 60_000;

function tooltip(
  quest: WorldQuestDef,
  options: { level?: number; progress?: number; expiresAtMs?: number } = {},
): WorldQuestTooltipModel {
  return buildWorldQuestTooltip({
    quest,
    progressCount: options.progress ?? 0,
    playerLevel: options.level ?? 20,
    expiresAtMs: options.expiresAtMs ?? TEN_HOURS,
    nowMs: NOW,
  });
}

function itemReward(model: WorldQuestTooltipModel): WorldQuestTooltipItemReward {
  const reward = model.rewards.find((row) => row.kind === 'item');
  if (reward?.kind !== 'item') throw new Error('no item reward');
  return reward;
}

beforeEach(() => {
  setLanguage('en');
});

describe('world quest tooltip model', () => {
  it('reads the classic layout: title, faction, time left, objective progress', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const model = tooltip(quest, { progress: 2 });
    expect(model.title).toBe('Eastbrook Vale: Load freight into the wagon');
    expect(model.factionId).toBe('church_order');
    expect(model.factionName).toBe('Church Order');
    expect(model.timeRemaining).toBe('10 hours');
    expect(model.objective).toEqual({
      label: 'Load freight into the wagon',
      current: 2,
      total: quest.count,
      text: `Load freight into the wagon: 2/${quest.count}`,
    });
  });

  it('clamps progress to the objective total and drops the time line with no deadline', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const model = tooltip(quest, { progress: 99, expiresAtMs: 0 });
    expect(model.objective.current).toBe(quest.count);
    expect(model.timeRemaining).toBe('');
    expect(worldQuestTooltipHtml(model)).not.toContain('Time remaining:');
  });

  it('pays an XP quest as experience after standing and currency with their icons', () => {
    const model = tooltip(WORLD_QUESTS_BY_ID.wq_eastbrook_bandits, { level: 20 });
    expect(model.rewards.map((row) => row.kind)).toEqual(['standing', 'currency', 'xp']);
    const [standing, currency, xp] = model.rewards;
    expect(standing).toMatchObject({
      kind: 'standing',
      factionId: 'church_order',
      amount: 80,
      text: '80 Church Order',
      iconUrl: '/ui/currency/church_order_crest.webp',
    });
    expect(currency).toMatchObject({
      kind: 'currency',
      currencyId: 'church_order_crest',
      amount: 10,
      text: '10 Order Crest',
      iconUrl: '/ui/currency/church_order_crest.webp',
    });
    expect(xp).toEqual({ kind: 'xp', amount: 2784, text: '2,784 experience' });
  });

  it('uses each faction its own art (Rift Watch and Automatons)', () => {
    const rift = tooltip(WORLD_QUESTS_BY_ID.wq_farshore_salvage);
    expect(rift.rewards[0]).toMatchObject({
      kind: 'standing',
      text: '80 Rift Watch',
      iconUrl: '/ui/currency/rift_watch_mark.webp',
    });
    expect(rift.rewards[1]).toMatchObject({ text: '10 Rift Watch Mark' });
    const auto = tooltip(WORLD_QUESTS_BY_ID.wq_drakelands_brood);
    expect(auto.rewards[0]).toMatchObject({
      text: '100 Automatons',
      iconUrl: '/ui/currency/automaton_cog.webp',
    });
    expect(auto.rewards[1]).toMatchObject({ text: '10 Automaton Cog' });
  });

  it('splits a copper reward into gold, silver and copper parts', () => {
    const quest: WorldQuestDef = {
      ...WORLD_QUESTS_BY_ID.wq_mirefen_gravecallers,
      reward: { type: 'copper', base: 9_893_682, perLevel: 0 },
    };
    const money = tooltip(quest).rewards.at(-1);
    expect(money).toEqual({
      kind: 'money',
      copper: 9_893_682,
      parts: { gold: 989, silver: 36, copper: 82 },
      text: '989 gold 36 silver 82 copper',
    });
    const html = worldQuestTooltipHtml(tooltip(quest));
    expect(html).toContain('<span class="coin-amount">989</span><span class="coin g"');
    expect(html).toContain('<span class="coin-amount">36</span><span class="coin s"');
    expect(html).toContain('<span class="coin-amount">82</span><span class="coin c"');
  });

  it('scales the shipped copper quest with the character level', () => {
    const money = tooltip(WORLD_QUESTS_BY_ID.wq_mirefen_gravecallers, { level: 10 }).rewards.at(-1);
    expect(money).toMatchObject({ kind: 'money', copper: 4250 });
    expect(money?.kind === 'money' && money.parts).toEqual({ gold: 0, silver: 42, copper: 50 });
  });

  it('names an item reward with its id, quality, and item level', () => {
    const quest: WorldQuestDef = {
      ...WORLD_QUESTS_BY_ID.wq_palmreach_confections,
      reward: { type: 'item', itemId: 'boundstone_helm', count: 1 },
    };
    const reward = itemReward(tooltip(quest));
    expect(reward.itemId).toBe('boundstone_helm');
    expect(reward.item?.id).toBe('boundstone_helm');
    expect(reward.quality).toBe('rare');
    expect(reward.itemLevel).toBe(23);
    expect(reward.itemLevelText).toBe('Item Level 23');
  });

  it('gives a non-gear item reward no item level', () => {
    const reward = itemReward(tooltip(WORLD_QUESTS_BY_ID.wq_palmreach_confections));
    expect(reward.itemId).toBe('rift_essence');
    expect(reward.itemLevel).toBeNull();
    expect(reward.itemLevelText).toBeNull();
  });

  it('keeps an unknown item id renderable (a newer server item)', () => {
    const quest: WorldQuestDef = {
      ...WORLD_QUESTS_BY_ID.wq_palmreach_confections,
      reward: { type: 'item', itemId: 'from_a_future_server', count: 2 },
    };
    const reward = itemReward(tooltip(quest));
    expect(reward).toMatchObject({ item: null, name: 'from_a_future_server', itemLevel: null });
    expect(worldQuestTooltipHtml(tooltip(quest))).toContain('from_a_future_server');
  });
});

describe('world quest tooltip html', () => {
  it('paints the header, the Rewards head, and every reward row', () => {
    const html = worldQuestTooltipHtml(tooltip(WORLD_QUESTS_BY_ID.wq_eastbrook_bandits));
    expect(html).toContain(
      '<div class="tt-title">Eastbrook Vale: Load freight into the wagon</div>',
    );
    expect(html).toContain('<div class="wq-tt-faction">Church Order</div>');
    expect(html).toContain('<span class="wq-tt-label">Time remaining:</span><span>10 hours</span>');
    expect(html).toContain('<div class="wq-tt-rewards-head">Rewards</div>');
    expect(html).toContain('src="/ui/currency/church_order_crest.webp"');
    expect(html).toContain('<span class="wq-tt-crest">');
    expect(html).toContain('80 Church Order');
    expect(html).toContain('10 Order Crest');
    expect(html).toContain('wq-tt-xp-orb');
    expect(html).toContain('2,784 experience');
  });

  it('never adds a warband-style one-time bonus line', () => {
    for (const quest of Object.values(WORLD_QUESTS_BY_ID)) {
      const html = worldQuestTooltipHtml(tooltip(quest)).toLowerCase();
      expect(html).not.toContain('warband');
      expect(html).not.toContain('one-time');
    }
  });

  it('embeds the shared item card and slots the item level under its title', () => {
    const quest: WorldQuestDef = {
      ...WORLD_QUESTS_BY_ID.wq_palmreach_confections,
      reward: { type: 'item', itemId: 'boundstone_helm', count: 1 },
    };
    const seen: ItemDef[] = [];
    const html = worldQuestTooltipHtml(tooltip(quest), {
      itemTooltip: (item) => {
        seen.push(item);
        return '<div class="tt-title" style="color:blue">Boundstone Helm</div><div class="tt-sub">Rare Armor</div>';
      },
    });
    expect(seen.map((item) => item.id)).toEqual(['boundstone_helm']);
    expect(html).toContain('class="item-icon q-rare"');
    expect(html).toContain(
      '<div class="tt-title" style="color:blue">Boundstone Helm</div><div class="tt-stat wq-tt-ilvl">Item Level 23</div><div class="tt-sub">Rare Armor</div>',
    );
  });

  it('keeps a card that already shows the item level unchanged', () => {
    const card = '<div class="tt-title">Helm</div><div class="tt-stat">Item Level 23</div>';
    expect(withItemLevelLine(card, 'Item Level 23')).toBe(card);
    expect(withItemLevelLine('<div class="tt-sub">x</div>', 'Item Level 23')).toBe(
      '<div class="tt-stat wq-tt-ilvl">Item Level 23</div><div class="tt-sub">x</div>',
    );
    expect(withItemLevelLine(card, null)).toBe(card);
  });

  it('falls back to the quality-colored name without a host item card', () => {
    const quest: WorldQuestDef = {
      ...WORLD_QUESTS_BY_ID.wq_palmreach_confections,
      reward: { type: 'item', itemId: 'boundstone_helm', count: 3 },
    };
    const html = worldQuestTooltipHtml(tooltip(quest));
    expect(html).toMatch(/<div class="tt-title" style="color:[^"]+">Boundstone Helm<\/div>/);
    expect(html).toContain('Item Level 23');
    expect(html).toContain('<span class="wq-tt-item-count">3</span>');
  });

  it('localizes every line (Spanish)', async () => {
    await ensureLocaleLoaded('es');
    setLanguage('es');
    const html = worldQuestTooltipHtml(tooltip(WORLD_QUESTS_BY_ID.wq_eastbrook_bandits));
    expect(html).toContain('Tiempo restante:');
    expect(html).not.toContain('Time remaining');
    expect(html).not.toContain('>Rewards<');
  });

  it('localizes the plain faction and reward texts instead of hard-coded English', async () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    expect(worldQuestFactionLine(quest)).toBe('Faction: Church Order');
    expect(worldQuestStandingRewardText(quest, 20)).toBe('+80 Church Order Standing');
    expect(worldQuestFactionCurrencyRewardText(quest, 20)).toBe('+10 Order Crest');
    await ensureLocaleLoaded('es');
    setLanguage('es');
    expect(worldQuestFactionLine(quest)).toMatch(/^Facción: /);
    expect(worldQuestStandingRewardText(quest, 20)).toMatch(/^\+80 de reputación con /);
    expect(worldQuestStandingRewardText(quest, 20)).not.toContain('Standing');
  });
});
