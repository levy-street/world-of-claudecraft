import { CLASSES, DUNGEONS, NPCS, QUEST_ORDER, QUESTS, ZONES } from '../../src/sim/data';
import type { QuestDef } from '../../src/sim/types';
import type { ArticleTools } from './entity_format';
import { questZoneName } from './quest_articles';

type Writer = Pick<ArticleTools, 'add' | 'titleBy' | 'link' | 'bullets' | 'section'> & {
  reserve(title: string): string;
};
interface Entry {
  quest: QuestDef;
  zone: string;
  level: number;
  depth: number;
  order: number;
}

const categories = ['Portals', 'Quest directories'];

function progressOf(q: QuestDef) {
  let level = q.minLevel ?? 1;
  let depth = 0;
  const seen = new Set([q.id]);
  let parent = q.requiresQuest;
  while (parent && QUESTS[parent]) {
    if (seen.has(parent)) throw Error('Circular quest prerequisite at ' + parent);
    seen.add(parent);
    const previous = QUESTS[parent];
    level = Math.max(level, previous.minLevel ?? 1);
    depth++;
    parent = previous.requiresQuest;
  }
  return { level, depth };
}

function byProgress(a: Entry, b: Entry) {
  return (
    a.level - b.level ||
    a.depth - b.depth ||
    a.order - b.order ||
    a.quest.name.localeCompare(b.quest.name, 'en')
  );
}

function groupBy(entries: Entry[], key: (e: Entry) => string) {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const title = key(entry);
    const group = groups.get(title) ?? [];
    group.push(entry);
    groups.set(title, group);
  }
  return groups;
}

function unavailable(q: QuestDef) {
  return q.retired || (q.gatedWithDungeon && DUNGEONS[q.gatedWithDungeon]?.guideVisible === false);
}

function professionQuest(q: QuestDef) {
  // The q_prof_ family includes material-delivery work orders as well as hands-on lessons.
  return (
    q.id.startsWith('q_prof_') ||
    !!q.recipeReward ||
    !!q.completionEffect ||
    q.objectives.some((o) => o.type === 'craft' || o.type === 'gather' || o.type === 'farm')
  );
}

export function addQuestDirectory(w: Writer) {
  const order = new Map(QUEST_ORDER.map((id, i) => [id, i]));
  const entries = Object.values(QUESTS)
    .map((quest) => ({
      quest,
      zone: questZoneName(quest),
      ...progressOf(quest),
      order: order.get(quest.id) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort(byProgress);
  const zoneTitles = new Map<string, string>();
  function row({ quest: q }: Entry) {
    const detail = [NPCS[q.giverNpcId]?.name];
    if (q.requiresQuest) detail.push('after ' + QUESTS[q.requiresQuest].name);
    if (q.requiredClass?.length)
      detail.push(q.requiredClass.map((c) => CLASSES[c].name).join(', '));
    if (q.suggestedPlayers && q.suggestedPlayers > 1)
      detail.push(q.suggestedPlayers + ' players suggested');
    if (q.weeklyReset) detail.push('weekly');
    else if (q.dailyReset) detail.push('daily');
    else if (q.repeatable) detail.push('repeatable');
    if (q.seasonalEvent) detail.push('seasonal');
    return [w.link(w.titleBy.quest.get(q.id)!, q.name), ...detail.filter(Boolean)].join(' · ');
  }
  function page(label: string, items: Entry[], intro: string, sections: 'level' | 'zone') {
    const title = w.reserve(label);
    const closed = items.filter((e) => unavailable(e.quest));
    const groups = groupBy(
      items.filter((e) => !unavailable(e.quest)),
      (e) => (sections === 'level' ? 'From level ' + e.level : e.zone),
    );
    const ordered =
      sections === 'level' ? [...groups] : [...groups].sort(([a], [b]) => a.localeCompare(b, 'en'));
    const content = ordered
      .map(([key, values]) => w.section(key, w.bullets(values.map(row))))
      .join('');
    w.add(
      title,
      intro +
        '\n\n' +
        content +
        (closed.length ? w.section('Closed to new players', w.bullets(closed.map(row))) : ''),
      categories,
    );
    return title;
  }
  function counted(title: string, label: string, n: number) {
    return w.link(title, label) + ' · ' + n + ' ' + (n === 1 ? 'quest' : 'quests');
  }
  const byZone = groupBy(entries, (e) => e.zone);
  const orderOfZones = new Map(ZONES.map((z, i) => [z.name, i]));
  function zoneRank(name: string) {
    return ZONES.find((z) => z.name === name)?.levelRange[0] ?? Infinity;
  }
  const zoneLinks: string[] = [];
  for (const [name, items] of [...byZone].sort(
    ([a], [b]) =>
      zoneRank(a) - zoneRank(b) || (orderOfZones.get(a) ?? 999) - (orderOfZones.get(b) ?? 999),
  )) {
    const title = page(
      name === 'Other locations' ? 'Quests with special starting locations' : name + ' quests',
      items,
      'Quests are grouped by the earliest level allowed by the quest and its prerequisites. Within a level, prerequisite quests appear before their follow-ups. Each entry names the quest giver.',
      'level',
    );
    zoneTitles.set(name, title);
    zoneLinks.push(
      counted(
        title,
        name === 'Other locations' ? 'Special starting locations' : name,
        items.length,
      ),
    );
  }
  const activities: [string, string, (q: QuestDef) => boolean][] = [
    ['Profession quests', 'Crafting, gathering, farming and profession training.', professionQuest],
    ['Class quests', 'Quests restricted to specific classes.', (q) => !!q.requiredClass?.length],
    [
      'Group quests',
      'Quests with a recommended group size above one player.',
      (q) => (q.suggestedPlayers ?? 1) > 1,
    ],
    [
      'Repeatable quests',
      'Quest-giver assignments that can be accepted again. Each quest explains its reset or cooldown.',
      (q) => !!q.repeatable,
    ],
    [
      'Seasonal quests',
      'Quest-giver assignments offered during an event.',
      (q) => !!q.seasonalEvent,
    ],
  ];
  const activityLinks: string[] = [];
  for (const [label, intro, match] of activities) {
    const items = entries.filter((e) => match(e.quest));
    if (items.length)
      activityLinks.push(counted(page(label, items, intro, 'zone'), label, items.length));
  }
  w.add(
    'Quests',
    'Choose a starting area to follow its quest chains, or browse by activity. Open a quest for its objectives, route map, turn-in and rewards.\n\n' +
      w.section('Starting areas', w.bullets(zoneLinks)) +
      w.section('Quest activities', w.bullets(activityLinks)) +
      w.section(
        'Rotating assignments',
        w.bullets([
          w.link('World quests') + ' · Daily world rotation',
          w.link('Weekly quests') + ' · Emissary charges',
        ]),
      ),
    ['Portals'],
  );
  return zoneTitles;
}
