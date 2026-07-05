import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const outDir = resolve('mediawiki/seed');
const tmpDir = resolve('tmp/mediawiki-seed');
const sourcePath = resolve(tmpDir, 'seed-source.ts');
const bundlePath = resolve(tmpDir, 'seed-source.mjs');
const outputPath = resolve(outDir, 'pages.xml');
const execFileAsync = promisify(execFile);

await mkdir(tmpDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const css = await readFile('mediawiki/theme/Common.css', 'utf8');

await writeFile(
  sourcePath,
  `
import { ABILITIES, CLASSES, DUNGEON_LIST, ITEMS, MOBS, NPCS, QUEST_ORDER, QUESTS, ZONES } from '../../src/sim/data';

const css = ${JSON.stringify(css)};
const pages = [];
const titleBy = {
  class: new Map(),
  ability: new Map(),
  zone: new Map(),
  dungeon: new Map(),
  npc: new Map(),
  quest: new Map(),
  mob: new Map(),
  item: new Map(),
};

function escXml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}

function titleCase(id) {
  return String(id).split('_').map((p) => p ? p[0].toUpperCase() + p.slice(1) : '').join(' ');
}

function money(copper) {
  if (!copper) return 'None';
  const gold = Math.floor(copper / 10000);
  const silver = Math.floor((copper % 10000) / 100);
  const c = copper % 100;
  return [gold ? gold + 'g' : '', silver ? silver + 's' : '', c + 'c'].filter(Boolean).join(' ');
}

function link(title, label = title) {
  return title === label ? '[[' + title + ']]' : '[[' + title + '|' + label + ']]';
}

function section(title, body) {
  return '== ' + title + ' ==\\n' + body.trim() + '\\n\\n';
}

function bullets(items) {
  return items.filter(Boolean).map((item) => '* ' + item).join('\\n');
}

function table(rows) {
  return '{| class="wikitable article-facts"\\n' + rows.map(([k, v]) => '|-\\n! ' + k + '\\n| ' + v).join('\\n') + '\\n|}';
}

function categories(names) {
  return '\\n' + names.filter(Boolean).map((name) => '[[Category:' + name + ']]').join('\\n') + '\\n';
}

function add(title, text, cats = []) {
  pages.push({ title, text: text.trim() + categories(cats) });
}

function unique(base, used) {
  if (!used.has(base)) { used.add(base); return base; }
  let i = 2;
  while (used.has(base + ' (' + i + ')')) i++;
  const title = base + ' (' + i + ')';
  used.add(title);
  return title;
}

const usedTitles = new Set();

for (const [id, cls] of Object.entries(CLASSES)) titleBy.class.set(id, unique(cls.name, usedTitles));
for (const [id, ability] of Object.entries(ABILITIES)) titleBy.ability.set(id, unique(ability.name + ' (Ability)', usedTitles));
for (const zone of ZONES) titleBy.zone.set(zone.id, unique(zone.name, usedTitles));
for (const dungeon of DUNGEON_LIST) titleBy.dungeon.set(dungeon.id, unique(dungeon.name, usedTitles));
for (const [id, npc] of Object.entries(NPCS)) titleBy.npc.set(id, unique(npc.name + ' (NPC)', usedTitles));
for (const [id, quest] of Object.entries(QUESTS)) titleBy.quest.set(id, unique(quest.name, usedTitles));
for (const [id, mob] of Object.entries(MOBS)) titleBy.mob.set(id, unique(mob.name + ' (Mob)', usedTitles));
for (const [id, item] of Object.entries(ITEMS)) titleBy.item.set(id, unique(item.name, usedTitles));

function zoneForQuest(id) {
  const index = QUEST_ORDER.indexOf(id);
  if (index < 0) return 'Unknown';
  if (index < 12) return 'Eastbrook Vale';
  if (index < 24) return 'Mirefen Marsh';
  return 'Thornpeak Heights';
}

add('MediaWiki:Common.css', css, []);

add('Main Page', \`
<div class="woc-main">
<div class="woc-hero">
<div>
<p class="woc-kicker">Community player encyclopedia</p>
<h1>World of Claudecraft Wiki</h1>
World of Claudecraft is a browser-playable, classic-style micro-MMO with online persistence, offline play, deterministic simulation logic, and a launch-week community that quickly turned jokes, dungeon clears, level races, bug reports, and feature requests into game history.

'''Start here:''' [[Quick Start]] · [[All Pages]] · [[Zones]] · [[Classes]] · [[Gameplay Systems]] · [[Community Lore]] · [[Development Timeline]]
</div>
<div class="woc-card"><div class="woc-crest">World of Claudecraft</div></div>
</div>
</div>
\` + section('Featured portals', bullets([
  link('Zones') + ' — Eastbrook Vale, Mirefen Marsh, Thornpeak Heights.',
  link('Classes') + ' — all nine playable class kits.',
  link('Quests') + ' — the full source-defined quest chain.',
  link('Dungeons') + ' — Hollow Crypt, Sunken Bastion, and Gravewyrm Sanctum.',
  link('Community Lore') + ' — launch-week player culture from Discord, Reddit, and X.',
  link('Development Timeline') + ' — issue, PR, and release themes.',
])), ['Wiki']);

add('Quick Start', section('First hour route', bullets([
  'Create an online character for persistence, or use offline play for a quick solo test.',
  'Speak to ' + link(titleBy.npc.get('marshal_redbrook'), 'Marshal Redbrook') + ' for ' + link(titleBy.quest.get('q_wolves'), 'Wolves at the Door') + '.',
  'Collect nearby Eastbrook quests before leaving town so wolf, boar, spider, lake, mine, bandit, and chapel objectives overlap.',
  'Sell poor-quality junk, buy food and water, and keep your action bar filled.',
  'Follow ' + link(titleBy.npc.get('brother_aldric'), 'Brother Aldric') + ' into the Gravecaller story once the Fallen Chapel quests open.',
])) + section('Controls', table([
  ['WASD', 'Move and turn'], ['Q / E', 'Strafe'], ['Space', 'Jump'], ['Tab', 'Target nearest enemy'],
  ['F', 'Interact, loot, talk'], ['1-0, -, =', 'Action bar'], ['C / P / L / M / B / G', 'Character, spellbook, quest log, map, bags, arena'], ['Enter', 'Open chat'],
])), ['Guides']);

add('The Gravecaller Saga', section('Overview', 'The main story follows Brother Aldric from restless bones outside Eastbrook to Korzul the Gravewyrm beneath Thornpeak.') + section('Acts', bullets([
  link(titleBy.zone.get('eastbrook_vale'), 'Eastbrook Vale') + ' — Morthen the Gravecaller and ' + link(titleBy.dungeon.get('hollow_crypt'), 'The Hollow Crypt') + '.',
  link(titleBy.zone.get('mirefen_marsh'), 'Mirefen Marsh') + ' — Vael the Fogbinder and ' + link(titleBy.dungeon.get('sunken_bastion'), 'The Sunken Bastion') + '.',
  link(titleBy.zone.get('thornpeak_heights'), 'Thornpeak Heights') + ' — Wyrmcult zealots, Highwatch, and ' + link(titleBy.dungeon.get('gravewyrm_sanctum'), 'Gravewyrm Sanctum') + '.',
])), ['Lore', 'Quests']);

add('Community Lore', section('Launch-week myths', bullets([
  'Players raced toward level 20 within the first weekend, and Discord mentions multiple level-20 characters plus jokes about level-cap roles.',
  'A community prediction around Bucky becoming world-first level 20 turned the level race into channel folklore.',
  'An early dungeon-clear clip by profitwizard and friends circulated through Discord and X.',
  'The first-guild debate included Cool People Guild and a WOC Pumpfun guild.',
  'Players joked about a future "Wrath of the Claude King" expansion before the first weekend was over.',
])) + section('Community requests', bullets([
  'Fishing, professions, and skilling loops.',
  'Player-facing leaderboards for level, class, arena Elo, boss kills, and guilds.',
  'Discord Rich Presence, public guild discovery, target markers, mobile improvements, mana pacing, and anti-bot handling.',
  'Arena rewards, arena accept/decline prompts, and countdown buff preservation.',
])) + section('Outside reception', 'Recent Reddit threads framed World of Claudecraft as a viral open-source, Fable 5-built MMORPG with thousands of early players and hundreds of GitHub stars. The same discussions mixed excitement, skepticism about generated code quality, nostalgia for Fable, questions about the TypeScript/Three.js stack, and stories of players unexpectedly sticking around to grind.'), ['Community', 'Discord', 'Reddit', 'X']);

add('Development Timeline', section('Release themes', table([
  ['v0.3 baseline', 'Persistent multiplayer, account flow, classes, quests, dungeons, social systems, and classic MMO presentation.'],
  ['v0.4 hardening', 'Moderation, reports, homepage polish, mobile controls, OpenGraph, bug fixes, and database correctness work.'],
  ['v0.5 focus', 'Ashen Coliseum ranked arena, first fishing loop, security fixes, guild/social polish, QoL, and release testing.'],
])) + section('Known active topics', bullets([
  'Arena polish, Elo, leaderboards, and rewards.',
  'Fishing and broader professions.',
  'Guild discovery, /who, friend/guild status clarity, and chat alias behavior.',
  'Security and correctness work around market inputs, rate limits, guild transactions, character names, report handling, and moderation.',
  'Headless environment and agent support for Codex/Claude-driven players.',
])), ['Development', 'GitHub']);

add('Sources Used', section('Local sources', bullets([
  'Repository README, design docs, screenshots, source code, tests, sim content, class definitions, dungeon data, and server routes.',
  'GitHub CLI exports of 45 issues and 141 pull requests.',
  'Discord export of 3,205 messages from the World of Claudecraft community general channel.',
])) + section('External sources', bullets([
  '[https://github.com/levy-street/world-of-claudecraft GitHub repository]',
  '[https://www.reddit.com/r/artificial/comments/1u4h7k1/world_of_claudecraft_the_first_opensource_mmorpg/ r/artificial launch thread]',
  '[https://www.reddit.com/r/ClaudeAI/comments/1u3m6a8/i_vibe_coded_the_first_mmorpg_with_fable_5/ r/ClaudeAI Fable 5 thread]',
  '[https://www.reddit.com/r/vibecoding/comments/1u47wo5/world_of_claudecraft_first_mmorpg_vibecoded_with/ r/vibecoding launch thread]',
  '[https://www.reddit.com/r/AI_Agents/comments/1u4hstu/agents_have_entered_the_world_of_claudecraft_open/ r/AI_Agents thread]',
  '[https://x.com/i/communities/2030944892999135272 World Of Claudecraft X community]',
])), ['Sources']);

const systemRows = [
  ['Combat', 'Classic-era combat math, resources, GCD, threat, leashing, death, food, drink, and recovery.'],
  ['Parties', 'Five-player grouping, shared tap rights, shared kill credit, XP bonuses, party chat, and shared instances.'],
  ['Guilds', 'Guild creation, ranks, roster management, invites, guild chat, and public-discovery roadmap requests.'],
  ['Trading', 'Nearby players stage items and copper; both sides accept; walking apart cancels.'],
  ['World Market', 'The Merchant runs player listings, purchases, cancellations, and collections.'],
  ['Duels', 'Friendly PvP challenges end at 1 HP.'],
  ['Ashen Coliseum', 'Ranked 1v1 arena with matchmaking, private arena instances, Elo, ladder, and leaderboard.'],
  ['Fishing', 'First professions slice: pole purchase, water checks, casting, and starter catch results.'],
  ['Mobile Play', 'Touch controls, joystick fixes, quest-log access, fullscreen polish, and launch-week mobile testing.'],
  ['Agents and Bots', 'Headless training environment, Codex/Claude agent culture, and anti-bot roadmap.'],
];
add('Gameplay Systems', section('Systems index', bullets(systemRows.map(([name, desc]) => link(name) + ' — ' + desc))), ['Systems']);
for (const [name, desc] of systemRows) {
  add(name, section('Overview', desc), ['Systems']);
}

const portals = [
  ['Zones', ZONES.map((z) => titleBy.zone.get(z.id))],
  ['Classes', Object.keys(CLASSES).map((id) => titleBy.class.get(id))],
  ['Dungeons', DUNGEON_LIST.map((d) => titleBy.dungeon.get(d.id))],
  ['NPCs', Object.keys(NPCS).map((id) => titleBy.npc.get(id))],
  ['Quests', QUEST_ORDER.map((id) => titleBy.quest.get(id)).filter(Boolean)],
  ['Mobs', Object.keys(MOBS).map((id) => titleBy.mob.get(id))],
  ['Items', Object.keys(ITEMS).map((id) => titleBy.item.get(id))],
  ['Abilities', Object.keys(ABILITIES).map((id) => titleBy.ability.get(id))],
];

for (const [portal, titles] of portals) {
  add(portal, section('Articles', bullets(titles.sort().map((title) => link(title)))), ['Portals']);
}

for (const zone of ZONES) {
  const npcs = Object.entries(NPCS).filter(([, npc]) => npc.pos.z >= zone.zMin && npc.pos.z < zone.zMax).map(([id]) => titleBy.npc.get(id));
  const quests = Object.keys(QUESTS).filter((id) => zoneForQuest(id) === zone.name).map((id) => titleBy.quest.get(id));
  add(titleBy.zone.get(zone.id), section('Overview', zone.welcome) + section('Facts', table([
    ['Level range', zone.levelRange[0] + '-' + zone.levelRange[1]], ['Hub', zone.hub.name], ['Biome', zone.biome], ['Graveyard', zone.graveyard.x + ', ' + zone.graveyard.z],
  ])) + section('Points of interest', bullets(zone.pois.map((poi) => poi.label))) + section('NPCs', bullets(npcs.map((title) => link(title)))) + section('Quest chain', bullets(quests.map((title) => link(title)))), ['Zones', zone.biome]);
}

for (const [id, cls] of Object.entries(CLASSES)) {
  add(titleBy.class.get(id), section('Overview', cls.name + ' starts with ' + (ITEMS[cls.startWeapon]?.name ?? cls.startWeapon) + ' and uses ' + cls.resourceType + '.') + section('Stats', table(Object.entries(cls.baseStats).map(([k, v]) => [k.toUpperCase(), String(v)]))) + section('Abilities', bullets(cls.abilities.map((abilityId) => link(titleBy.ability.get(abilityId), ABILITIES[abilityId]?.name ?? abilityId)))), ['Classes']);
}

for (const dungeon of DUNGEON_LIST) {
  const bosses = dungeon.spawns.map((s) => MOBS[s.mobId]).filter((mob) => mob?.boss);
  add(titleBy.dungeon.get(dungeon.id), section('Overview', dungeon.name + ' is a private party instance with ' + dungeon.spawns.length + ' source-defined spawns.') + section('Facts', table([
    ['Interior', dungeon.interior], ['Spawn count', String(dungeon.spawns.length)], ['Door position', dungeon.doorPos.x + ', ' + dungeon.doorPos.z],
  ])) + section('Bosses', bullets(bosses.map((mob) => link(titleBy.mob.get(mob.id), mob.name)))) + section('Spawn list', bullets(dungeon.spawns.map((spawn) => link(titleBy.mob.get(spawn.mobId), MOBS[spawn.mobId]?.name ?? spawn.mobId) + ' at ' + spawn.x + ', ' + spawn.z))), ['Dungeons']);
}

for (const [id, npc] of Object.entries(NPCS)) {
  add(titleBy.npc.get(id), section('Greeting', npc.greeting) + section('Facts', table([
    ['Title', npc.title ?? 'NPC'], ['Position', npc.pos.x + ', ' + npc.pos.z], ['Quest count', String(npc.questIds?.length ?? 0)], ['Vendor', npc.vendorItems?.length ? 'Yes' : npc.market ? 'World Market' : 'No'],
  ])) + (npc.questIds?.length ? section('Quests', bullets(npc.questIds.map((qid) => link(titleBy.quest.get(qid), QUESTS[qid]?.name ?? qid)))) : '') + (npc.vendorItems?.length ? section('Vendor stock', bullets(npc.vendorItems.map((itemId) => link(titleBy.item.get(itemId), ITEMS[itemId]?.name ?? itemId)))) : ''), ['NPCs']);
}

for (const [id, quest] of Object.entries(QUESTS)) {
  const objectives = quest.objectives.map((obj) => (obj.label ?? obj.type) + ': ' + (obj.count ?? 1));
  const rewards = Object.values(quest.itemRewards ?? {}).map((itemId) => ITEMS[itemId]).filter(Boolean);
  add(titleBy.quest.get(id), section('Quest text', quest.text) + section('Facts', table([
    ['Zone', zoneForQuest(id)], ['XP reward', String(quest.xpReward)], ['Copper reward', money(quest.copperReward)], ['Minimum level', quest.minLevel ? String(quest.minLevel) : 'None'], ['Requires quest', quest.requiresQuest ? (QUESTS[quest.requiresQuest]?.name ?? quest.requiresQuest) : 'None'],
  ])) + section('Objectives', bullets(objectives)) + section('Completion', quest.completionText) + (rewards.length ? section('Rewards', bullets(rewards.map((item) => link(titleBy.item.get(item.id), item.name)))) : ''), ['Quests', zoneForQuest(id)]);
}

for (const [id, mob] of Object.entries(MOBS)) {
  const mechanics = [mob.boss ? 'Boss' : '', mob.elite ? 'Elite' : '', mob.rare ? 'Rare' : '', mob.aoePulse ? 'AoE: ' + mob.aoePulse.name : '', mob.enrage ? 'Enrage below ' + Math.round(mob.enrage.belowHpPct * 100) + '%' : ''].filter(Boolean);
  const loot = mob.loot.map((entry) => entry.itemId ? ITEMS[entry.itemId] : null).filter(Boolean);
  add(titleBy.mob.get(id), section('Overview', mob.name + ' is a level ' + (mob.minLevel === mob.maxLevel ? mob.minLevel : mob.minLevel + '-' + mob.maxLevel) + ' ' + mob.family + '.') + section('Facts', table([
    ['Family', mob.family], ['Level', mob.minLevel === mob.maxLevel ? String(mob.minLevel) : mob.minLevel + '-' + mob.maxLevel], ['Aggro radius', String(mob.aggroRadius)], ['Attack speed', String(mob.attackSpeed)],
  ])) + (mechanics.length ? section('Mechanics', bullets(mechanics)) : '') + (loot.length ? section('Loot', bullets(loot.map((item) => link(titleBy.item.get(item.id), item.name)))) : ''), ['Mobs', mob.family]);
}

for (const [id, item] of Object.entries(ITEMS)) {
  add(titleBy.item.get(id), section('Overview', item.name + ' is a ' + (item.quality ?? 'common') + ' ' + item.kind + (item.slot ? ' for ' + item.slot : '') + '.') + section('Facts', table([
    ['Kind', item.kind], ['Quality', item.quality ?? 'common'], ['Slot', item.slot ?? 'None'], ['Sell value', money(item.sellValue)], ['Buy value', money(item.buyValue)], ['Required class', item.requiredClass?.join(', ') ?? 'Any'],
  ])) + (item.weapon ? section('Weapon', table([['Damage', item.weapon.min + '-' + item.weapon.max], ['Speed', String(item.weapon.speed)], ['Dagger', item.weapon.dagger ? 'Yes' : 'No']])) : '') + (item.stats ? section('Stats', table(Object.entries(item.stats).map(([k, v]) => [k.toUpperCase(), String(v)]))) : '') + (item.foodHp || item.drinkMana ? section('Consumable', table([['Health restored', String(item.foodHp ?? 0)], ['Mana restored', String(item.drinkMana ?? 0)]])) : ''), ['Items', item.kind, item.quality ?? 'common']);
}

for (const [id, ability] of Object.entries(ABILITIES)) {
  add(titleBy.ability.get(id), section('Description', ability.description) + section('Facts', table([
    ['Class', link(titleBy.class.get(ability.class), CLASSES[ability.class]?.name ?? ability.class)], ['Learn level', String(ability.learnLevel)], ['Cost', String(ability.cost)], ['Cooldown', ability.cooldown + 's'], ['Range', ability.range ? ability.range + ' yd' : 'Melee/self'], ['School', ability.school],
  ])) + section('Base effects', bullets(ability.effects.map((effect) => effect.type))) + (ability.ranks?.length ? section('Ranks', table(ability.ranks.map((rank) => ['Rank ' + rank.rank, 'Level ' + rank.level + ', cost ' + rank.cost]))) : ''), ['Abilities', CLASSES[ability.class]?.name ?? ability.class]);
}

add('All Pages', section('Complete index', bullets(pages.map((page) => link(page.title)).sort())), ['Wiki']);

const seedTimestamp = process.env.MEDIAWIKI_SEED_TIMESTAMP ?? '2026-06-15T23:47:51Z';
const now = new Date(seedTimestamp).toISOString().replace(/\\.\\d{3}Z$/, 'Z');
const body = pages.map((page, index) => \`
  <page>
    <title>\${escXml(page.title)}</title>
    <ns>\${page.title.startsWith('MediaWiki:') ? 8 : page.title.startsWith('Category:') ? 14 : 0}</ns>
    <id>\${index + 1}</id>
    <revision>
      <id>\${index + 1}</id>
      <timestamp>\${now}</timestamp>
      <contributor><username>WikiAdmin</username><id>1</id></contributor>
      <comment>Seed World of Claudecraft wiki content</comment>
      <model>wikitext</model>
      <format>text/x-wiki</format>
      <text xml:space="preserve" bytes="\${Buffer.byteLength(page.text)}">\${escXml(page.text)}</text>
    </revision>
  </page>\`).join('\\n');

const xml = \`<?xml version="1.0" encoding="UTF-8"?>
<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" version="0.11" xml:lang="en">
  <siteinfo>
    <sitename>World of Claudecraft Wiki</sitename>
    <dbname>mediawiki</dbname>
    <base>http://localhost:8080/wiki/index.php/Main_Page</base>
    <generator>MediaWiki seed</generator>
    <case>first-letter</case>
    <namespaces>
      <namespace key="0" case="first-letter" />
      <namespace key="8" case="first-letter">MediaWiki</namespace>
      <namespace key="14" case="first-letter">Category</namespace>
    </namespaces>
  </siteinfo>
\${body}
</mediawiki>
\`;

console.log(xml);
`,
);

await build({
  entryPoints: [sourcePath],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundlePath,
  logLevel: 'silent',
});

const { stdout } = await execFileAsync(process.execPath, [bundlePath], {
  maxBuffer: 50 * 1024 * 1024,
});
await writeFile(outputPath, stdout);
await rm(tmpDir, { recursive: true, force: true });
console.log(`wrote ${outputPath}`);
