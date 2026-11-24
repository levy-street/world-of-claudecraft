// Which encyclopedia pages still lack their captured pictures. The text of every page
// regenerates from the game data on each build; the pictures do not, because they are
// rendered from the live game on a machine with a GPU (docs/wiki-encyclopedia.md,
// "Refreshing the pictures"). A new creature or boss shows its icon until then; this
// report lists what to capture next.
//
//   node scripts/wiki_site/art_coverage.mjs [--seed pages.xml] [--json]
import { resolve } from 'node:path';
import { sectionFor } from './paths.mjs';
import { readSeed } from './seed.mjs';

/** Pages that should have a picture and do not. */
export function artGaps(pages) {
  const models = [];
  const attacks = [];
  for (const page of pages.values()) {
    const section = sectionFor(page);
    if ((section === 'creature' || section === 'npc') && !page.model) models.push(page.title);
    // A boss page lists its attacks under Mechanics. The ones with a cast are the ones a
    // player sees coming, and those are what the snapshot capture photographs.
    if (/^== Mechanics ==$/m.test(page.text)) {
      const lines = page.text.split('\n== Mechanics ==')[1]?.split('\n== ')[0] ?? '';
      const cast = lines
        .split('\n')
        .filter((line) => line.startsWith('* ') && /cast time/.test(line));
      const listed = cast.length;
      const shot = cast.filter((line) => line.includes('size="attack"')).length;
      if (listed && shot < listed) attacks.push({ title: page.title, listed, shot });
    }
  }
  return { models: models.sort(), attacks: attacks.sort((a, b) => (a.title < b.title ? -1 : 1)) };
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('art_coverage.mjs')) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--seed');
  const { pages } = readSeed(resolve(at >= 0 ? args[at + 1] : 'mediawiki/seed/pages.xml'));
  const gaps = artGaps(pages);
  if (args.includes('--json')) console.log(JSON.stringify(gaps, null, 1));
  else {
    console.log(`${gaps.models.length} creature and NPC pages without a model picture`);
    for (const title of gaps.models) console.log('  ' + title);
    console.log(`${gaps.attacks.length} boss pages with attacks still missing a snapshot`);
    for (const { title, listed, shot } of gaps.attacks)
      console.log(`  ${title}: ${shot} of ${listed}`);
  }
}
