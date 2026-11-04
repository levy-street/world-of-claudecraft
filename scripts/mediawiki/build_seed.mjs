import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const outDir = resolve('mediawiki/seed');
await mkdir(resolve('tmp'), { recursive: true });
const tmpDir = await mkdtemp(resolve('tmp/mediawiki-seed-'));
const sourcePath = resolve(tmpDir, 'seed-source.ts');
const bundlePath = resolve(tmpDir, 'seed-source.mjs');
// MEDIAWIKI_SEED_OUT lets a caller build the seed somewhere else (the visibility
// test rebuilds into a temp dir so it can check the GENERATOR without requiring
// the committed deploy artifact to be regenerated in every content PR).
const outputPath = process.env.MEDIAWIKI_SEED_OUT
  ? resolve(process.env.MEDIAWIKI_SEED_OUT)
  : resolve(outDir, 'pages.xml');
const execFileAsync = promisify(execFile);

await mkdir(outDir, { recursive: true });

const css = (await readFile('mediawiki/theme/Common.css', 'utf8')).replaceAll('\r\n', '\n');

await writeFile(
  sourcePath,
  `
import { ABILITIES, CLASSES, DUNGEON_LIST, ITEMS, MOBS, NPCS, QUESTS, ZONES, zoneContaining, BUILTIN_WORLD } from '../../src/sim/data';
import { addCatalogPortals } from '../../scripts/mediawiki/catalog_portals';
import { addQuestDirectory } from '../../scripts/mediawiki/quest_directory';
import { subjects } from '../../mediawiki/reader/browse';
import { abilityIndexGroup } from '../../scripts/mediawiki/ability_access';
import { articleArt } from '../../scripts/mediawiki/article_art';
import { abilityArticle } from '../../scripts/mediawiki/ability_article';
import { addTalentPages } from '../../scripts/mediawiki/talent_articles';
import { addSystemArticles } from '../../scripts/mediawiki/system_articles';
import { addEntityArticles, questZoneName } from '../../scripts/mediawiki/entity_articles';
import { npcArticle } from '../../scripts/mediawiki/npc_article';
import { dungeonDetails } from '../../scripts/mediawiki/dungeon_article';
import { coreSystemRules } from '../../scripts/mediawiki/core_system_rules';
import { questMap } from '../../scripts/mediawiki/quest_map';
import { addRotatingQuests } from '../../scripts/mediawiki/rotating_quest_articles';

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

function kindWording(kind) {
  // kind 'recipe' is the physical PATTERN item (it teaches a recipe when
  // used), so prose, facts, and categories say 'pattern': an item page must
  // never read as the recipe it teaches. Every other kind is its own word.
  return kind === 'recipe' ? 'pattern' : kind;
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
  text = text.replaceAll('$N', 'adventurer').replaceAll('$C', 'champion').split('\\n').map(line => line.trimEnd()).join('\\n');
  pages.push({ title, text: text.trim() + '\\n\\n' + coreSystemRules(title, section, table) + categories(cats) });
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
const visibleAbilities = Object.entries(ABILITIES).filter(([, ability]) => ability.hiddenFromPlayer !== true);

for (const [id, cls] of Object.entries(CLASSES)) titleBy.class.set(id, unique(cls.name, usedTitles));
for (const [id, ability] of visibleAbilities) titleBy.ability.set(id, unique(ability.name + ' (Ability)', usedTitles));
for (const zone of ZONES) titleBy.zone.set(zone.id, unique(zone.name, usedTitles));
for (const dungeon of DUNGEON_LIST) titleBy.dungeon.set(dungeon.id, unique(dungeon.name, usedTitles));
for (const [id, npc] of Object.entries(NPCS)) titleBy.npc.set(id, unique(npc.name + ' (NPC)', usedTitles));
for (const [id, quest] of Object.entries(QUESTS)) titleBy.quest.set(id, unique(quest.name, usedTitles));
for (const [id, mob] of Object.entries(MOBS)) titleBy.mob.set(id, unique(mob.name + ' (Mob)', usedTitles));
for (const [id, item] of Object.entries(ITEMS)) titleBy.item.set(id, unique(item.name, usedTitles));

const writer = { questMap, titleBy, section, link, bullets, table, add, unique, usedTitles };
const dungeonWriter = {section, bullets, table, mob: id => link(titleBy.mob.get(id),MOBS[id]?.name ?? id)};
const zoneForQuest = id => questZoneName(QUESTS[id]);
const reserve = title => unique(title, usedTitles);
add('MediaWiki:Common.css', css, []);
add('Main Page', section('World of ClaudeCraft', 'Look up a reward, plan a build, or read an encounter before you enter. Each article describes the rules in this edition of the game.') +
  subjects.map(([name,entries])=>section(name,bullets(entries.map(([title,label,description])=>link(title,label)+' · '+description)))).join('')+
  section('Reference', link('Quick Start') + ' · ' + link('All Pages','A to Z index')), ['Wiki']);

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
  link(titleBy.zone.get('eastbrook_vale'), 'Eastbrook Vale') + ': Morthen the Gravecaller and ' + link(titleBy.dungeon.get('hollow_crypt'), 'The Hollow Crypt') + '.',
  link(titleBy.zone.get('mirefen_marsh'), 'Mirefen Marsh') + ': Vael the Fogbinder and ' + link(titleBy.dungeon.get('sunken_bastion'), 'The Sunken Bastion') + '.',
  link(titleBy.zone.get('thornpeak_heights'), 'Thornpeak Heights') + ': Broodsworn zealots, Highwatch, and ' + link(titleBy.dungeon.get('gravewyrm_sanctum'), 'Gravewyrm Sanctum') + '.',
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

add('Sources Used', section('Game mechanics', bullets([
  'The simulation content in src/sim/data.ts supplies the item, quest, creature and NPC catalogs. The quest maps use the standard world placements after the built-in world touchup.',
  'Ability articles use the spellbook resolver and combat scaling formulas. Dungeon encounters use the Normal and Heroic encounter journals. Crafting and collection articles read their respective simulation registries.',
  'Personal corpses, procedurally selected targets and custom maps can change where an objective appears. The walkthroughs distinguish fixed coordinates from search areas and activity-dependent locations.',
])) + section('Launch history sources', bullets([
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

addTalentPages(writer);
addSystemArticles({ add, unique: reserve, titleBy });
addRotatingQuests({ ...writer, reserve });
addCatalogPortals({ ...writer, reserve });
const zoneDirectories = addQuestDirectory({ ...writer, reserve });

const sortedZones = [...ZONES].sort((a,b) => a.levelRange[0]-b.levelRange[0] || a.levelRange[1]-b.levelRange[1] || a.name.localeCompare(b.name,'en'));
add('Zones', section('Regions by level',bullets(sortedZones.map(z=>link(titleBy.zone.get(z.id)) + ' · '+(z.levelRange[0]===z.levelRange[1]?'Level '+z.levelRange[0]:'Levels '+z.levelRange.join(' to '))+' · '+z.hub.name))),['Portals']);
add('Classes',section('Playable classes',bullets(Object.keys(CLASSES).sort().map(id=>link(titleBy.class.get(id))))),['Portals']);
const groupRooms = (rooms) => bullets(rooms.map(d=>link(titleBy.dungeon.get(d.id))+' · '+d.suggestedPlayers+' suggested players'));
const rooms = [...DUNGEON_LIST].sort((a,b)=>a.name.localeCompare(b.name,'en'));
const dungeonSections = [
  ['Dungeon entrances', rooms.filter(d=>d.overworldDoor!==false && d.suggestedPlayers<=5)],
  ['Raid entrances', rooms.filter(d=>d.overworldDoor!==false && d.suggestedPlayers>5)],
  ['Connected rooms',rooms.filter(d=>d.overworldDoor===false)],
];
add('Dungeons',dungeonSections.filter(([,ds])=>ds.length).map(([name,ds])=>section(name,groupRooms(ds))).join(''),['Portals']);

for (const zone of ZONES) {
  const npcs = Object.entries(BUILTIN_WORLD.npcs).filter(([, npc]) => (!npc.dynamic || npc.fixedPost) && zoneContaining(npc.pos.x,npc.pos.z)?.id === zone.id).map(([id]) => titleBy.npc.get(id));
  const quests = Object.keys(QUESTS).filter((id) => zoneForQuest(id) === zone.name).map((id) => titleBy.quest.get(id));
  add(titleBy.zone.get(zone.id), section('Overview', zone.welcome) + section('Facts', table([
    ['Level range', zone.levelRange[0] + '-' + zone.levelRange[1]], ['Hub', zone.hub.name], ['Biome', zone.biome], ['Graveyard', zone.graveyard.x + ', ' + zone.graveyard.z],
  ])) + section('Points of interest', bullets(zone.pois.map((poi) => poi.label))) + section('NPCs', bullets(npcs.map((title) => link(title)))) + section('Quests starting here', (zoneDirectories.has(zone.name) ? link(zoneDirectories.get(zone.name), 'Browse quests in ' + zone.name) + '\\n\\n' : '') + bullets(quests.map((title) => link(title)))), ['Zones', zone.biome]);
}

for (const [id, cls] of Object.entries(CLASSES)) {
  const abilities = cls.abilities
    .filter((abilityId) => titleBy.ability.has(abilityId))
    .map((abilityId) => link(titleBy.ability.get(abilityId), ABILITIES[abilityId]?.name ?? abilityId));
  add(titleBy.class.get(id), section('Overview', cls.name + ' starts with ' + (ITEMS[cls.startWeapon]?.name ?? cls.startWeapon) + ' and uses ' + cls.resourceType + '.') + section('Starting weapon', link(titleBy.item.get(cls.startWeapon), ITEMS[cls.startWeapon]?.name ?? cls.startWeapon)) + section('Build choices', link('Specializations') + ' · ' + link('Talent choices')) + section('Stats', table(Object.entries(cls.baseStats).map(([k, v]) => [k.toUpperCase(), String(v)]))) + section('Abilities', bullets(abilities)), ['Classes']);
}

for (const dungeon of DUNGEON_LIST) {
  const bosses = dungeon.spawns.map((s) => MOBS[s.mobId]).filter((mob) => mob?.boss);
  add(titleBy.dungeon.get(dungeon.id), section('Overview', dungeon.enterText) + dungeonDetails(dungeon,dungeonWriter) + section('Bosses', bullets(bosses.map((mob) => link(titleBy.mob.get(mob.id), mob.name)))) + section('Spawn list', bullets(dungeon.spawns.map((spawn) => link(titleBy.mob.get(spawn.mobId), MOBS[spawn.mobId]?.name ?? spawn.mobId) + ' at ' + spawn.x + ', ' + spawn.z))), ['Dungeons']);
}

for (const [id,npc] of Object.entries(NPCS)) {
  add(titleBy.npc.get(id),npcArticle(npc,{...writer,money,kindWording}),['NPCs']);
}

addEntityArticles({ ...writer, money, kindWording });
for (const [id, ability] of visibleAbilities) {
  add(titleBy.ability.get(id), abilityArticle(ability, writer), ['Abilities', abilityIndexGroup(ability)]);
}

const letters = new Map();
for (const page of pages.filter(p=>!p.title.startsWith('MediaWiki:')).sort((a,b)=>a.title.localeCompare(b.title,'en'))) {
  const letter = page.title[0].toUpperCase();
  if(!letters.has(letter))letters.set(letter,[]);
  letters.get(letter).push(link(page.title));
}
add('All Pages',[...letters].map(([letter,titles])=>section(letter,bullets(titles))).join(''),['Wiki']);

const illustrations = articleArt(titleBy);
for(const page of pages) {
  const path = illustrations.get(page.title);
  if(path) page.text = '<woc-art path="' + path + '" />\\n' + page.text;
}
const seedTimestamp = process.env.MEDIAWIKI_SEED_TIMESTAMP ?? '2026-11-04T01:00:00Z';
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
  define: { 'import.meta.env.PROD': 'true' },
});

const { stdout } = await execFileAsync(process.execPath, [bundlePath], {
  maxBuffer: 50 * 1024 * 1024,
});
await writeFile(outputPath, stdout);
await rm(tmpDir, { recursive: true, force: true });
console.log(`wrote ${outputPath}`);
