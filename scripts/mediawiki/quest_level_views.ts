import { CLASSES, QUEST_ORDER, QUESTS, ZONES } from '../../src/sim/data';
import type { QuestDef } from '../../src/sim/types';
import type { ArticleTools } from './entity_format';
import { questZoneName } from './quest_articles';
import { questClosed } from './quest_closed';

// Two cross-zone quest views for the Quests hub: every quest by the level it opens at,
// and every quest chain from its first quest to its last. A quest's own minLevel and
// maxLevel are the whole level rule (computeQuestState in src/sim/quests/quest_commands.ts):
// a quest with no minLevel has no lowest level, so it is open at any level.

type Writer = Pick<ArticleTools, 'add' | 'titleBy' | 'link' | 'bullets' | 'section'> & {
  reserve(title: string): string;
};

export const ANY_LEVEL = 'Any level';
const BAND = 5;
const categories = ['Portals', 'Quest directories'];
const order = new Map(QUEST_ORDER.map((id, i) => [id, i]));

/** The level group a quest is listed under: "Any level" or "Levels 6 to 10". */
export function questLevelBand(q: QuestDef): string {
  if (!q.minLevel) return ANY_LEVEL;
  const top = Math.ceil(q.minLevel / BAND) * BAND;
  return 'Levels ' + (top - BAND + 1) + ' to ' + top;
}

/** The Level cell: the quest's own level limits. */
export function questLevelText(q: QuestDef): string {
  if (q.minLevel && q.maxLevel) return q.minLevel + ' to ' + q.maxLevel;
  if (q.maxLevel) return 'Up to ' + q.maxLevel;
  return q.minLevel ? String(q.minLevel) : 'Any';
}

const byLevel = (a: QuestDef, b: QuestDef) =>
  (a.minLevel ?? 0) - (b.minLevel ?? 0) ||
  (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
  a.name.localeCompare(b.name, 'en');

/** The quests each quest opens (quests whose requiresQuest names it), in level order. */
export function questFollowUps(): Map<string, QuestDef[]> {
  const out = new Map<string, QuestDef[]>();
  for (const q of Object.values(QUESTS))
    if (q.requiresQuest && QUESTS[q.requiresQuest])
      out.set(q.requiresQuest, [...(out.get(q.requiresQuest) ?? []), q]);
  for (const list of out.values()) list.sort(byLevel);
  return out;
}

/**
 * Every chain, start to end: a quest that needs no earlier quest but opens at least one,
 * then each quest after it (a quest that opens two is followed by both branches).
 */
export function questChains(): { quest: QuestDef; step: number }[][] {
  const next = questFollowUps();
  const starts = Object.values(QUESTS)
    .filter((q) => !q.requiresQuest && next.has(q.id))
    .sort(byLevel);
  return starts.map((start) => {
    const out: { quest: QuestDef; step: number }[] = [];
    const walk = (q: QuestDef, step: number) => {
      out.push({ quest: q, step });
      for (const child of next.get(q.id) ?? []) walk(child, step + 1);
    };
    walk(start, 1);
    return out;
  });
}

export function addQuestLevelViews(w: Writer): string[] {
  const quest = (q: QuestDef) => {
    const title = w.titleBy.quest.get(q.id);
    return title ? w.link(title, q.name) : q.name;
  };
  const notes = (q: QuestDef, sayClosed = true) => {
    const out: string[] = [];
    if (q.requiredClass?.length)
      out.push(q.requiredClass.map((c) => CLASSES[c].name).join(', ') + ' only');
    if (q.requiresUsableHealAbility) out.push('needs a healing spell');
    if (q.seasonalEvent) out.push('seasonal event');
    if (sayClosed && questClosed(q)) out.push('closed to new players');
    return out.length ? ' (' + out.join(', ') + ')' : '';
  };
  // Quests whose giver has no post out in the world are handed out inside a raid.
  const zoneName = (q: QuestDef) => {
    const name = questZoneName(q);
    return name === 'Other locations' ? 'Inside a raid' : name;
  };
  const zone = (q: QuestDef) => {
    const z = ZONES.find((z) => z.name === questZoneName(q));
    const title = z && w.titleBy.zone.get(z.id);
    return title ? w.link(title, z.name) : zoneName(q);
  };
  const after = (q: QuestDef) =>
    q.requiresQuest && QUESTS[q.requiresQuest] ? quest(QUESTS[q.requiresQuest]) : 'None';
  const table = (headings: string[], rows: string[][]) =>
    '{| class="wikitable"\n|-\n! ' +
    headings.join(' !! ') +
    '\n' +
    rows.map((cells) => '|-\n| ' + cells.join(' || ')).join('\n') +
    '\n|}';

  // Quests by level: one page, one table per level group.
  const all = Object.values(QUESTS).sort(byLevel);
  const open = all.filter((q) => !questClosed(q));
  const bands = new Map<string, QuestDef[]>();
  for (const q of open) bands.set(questLevelBand(q), [...(bands.get(questLevelBand(q)) ?? []), q]);
  const row = (q: QuestDef, sayClosed = true) => [
    quest(q) + notes(q, sayClosed),
    zone(q),
    questLevelText(q),
    after(q),
  ];
  const heads = ['Quest', 'Zone', 'Level', 'After'];
  const closed = all.filter(questClosed);
  const levelTitle = w.reserve('Quests by level');
  w.add(
    levelTitle,
    w.link('Quests', 'Back to quests') +
      '\n\n' +
      'Every quest in every zone, by the lowest level you can take it at. ' +
      ANY_LEVEL +
      ' means the quest has no level limit of its own. A quest can still need you to finish another quest first. The After column names that quest.\n\n' +
      [...bands]
        .map(([band, quests]) =>
          w.section(
            band,
            table(
              heads,
              quests.map((q) => row(q)),
            ),
          ),
        )
        .join('') +
      (closed.length
        ? w.section(
            'Closed to new players',
            table(
              heads,
              closed.map((q) => row(q, false)),
            ),
          )
        : ''),
    categories,
  );

  // Quest chains: one table per chain, in the order you do the quests.
  const chains = questChains();
  const chainTitle = w.reserve('Quest chains');
  w.add(
    chainTitle,
    w.link('Quests', 'Back to quests') +
      '\n\n' +
      'A quest chain is a run of quests where each one opens the next. Each table starts with the first quest of a chain and goes to the end. Step 2 opens when you finish step 1, and so on. When one quest opens two, both come next and share the same step number.\n\n' +
      chains
        .map((chain) => {
          const start = chain[0].quest;
          return w.section(
            start.name + ' (' + zoneName(start) + ')',
            table(
              ['Step', 'Quest', 'Zone', 'Level', 'After'],
              chain.map(({ quest: q, step }) => [String(step), ...row(q)]),
            ),
          );
        })
        .join(''),
    categories,
  );

  const count = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);
  return [
    w.link(levelTitle, 'By level') + ' · ' + count(open.length, 'quest', 'quests'),
    w.link(chainTitle, 'Quest chains') + ' · ' + count(chains.length, 'chain', 'chains'),
  ];
}
