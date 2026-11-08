import type { QuestObjective } from '../../src/sim/types';

const introductions: Record<string, string> = {
  Combat:
    'Combat uses attacks and abilities to deal damage, heal allies and control enemies. Your stats, resources, positioning and timing affect the outcome.',
  'Crafting recipes':
    'Crafting recipes describe what you can make, the materials you need and the requirements for making it.',
  'Delve companions':
    'Delve companions accompany you in delves. Each companion has its own combat role and abilities.',
  'Equipment enchants':
    'Equipment enchants add bonuses to eligible gear. Check the enchant and equipment requirements before applying one.',
  'Equipment sets':
    'Equipment sets are groups of related items that grant bonuses when you equip enough pieces together.',
  'Farm crops':
    'Farm crops grow in farming plots and provide materials when harvested. Each crop has its own seeds, growing requirements and harvest rewards.',
  Ferries:
    'Ferries carry you between fixed stops in the world. The routes below list where to board and where each ferry goes.',
  'Hoard encounters':
    'Hoard encounters guard buried treasure. The encounter and rewards depend on the hoard you uncover.',
  'Mount appearances':
    'Mount appearances change the look of your mount. This page lists the available appearances and how to unlock them.',
  'Rift floors':
    'Rifts contain floors with different enemies and objectives. Complete the current floor objective to progress through the rift.',
  'Weapon appearances':
    'Weapon appearances change how your weapon looks. This page lists the appearances you can collect and their unlock requirements.',
};

/** Keep the explanation ahead of the walkthrough without duplicating it. */
export function systemIntroduction(body: string, name = ''): { lead: string; rest: string } {
  if (introductions[name]) return { lead: introductions[name] + '\n\n', rest: body };
  const text = body.trim();
  const boundary = text.search(/\n\s*\n|\n(?===)/);
  const first = boundary < 0 ? text : text.slice(0, boundary);
  if (!first || /^(?:==|\* |# |\{\|)/.test(first)) return { lead: '', rest: body };
  return { lead: first + '\n\n', rest: boundary < 0 ? '' : text.slice(boundary).trimStart() };
}

/** Use verbs and counts, while preserving the game's names and dynamic requirements. */
export function questObjectiveText(o: QuestObjective, target: string, count: string): string {
  switch (o.type) {
    case 'kill':
      return 'Defeat ' + target + (count === '1' ? '.' : ' ' + count + ' times.');
    case 'collect':
      return 'Collect ' + count + ' × ' + target + '.';
    case 'craft':
      return 'Craft ' + target + ' ' + count + (count === '1' ? ' time.' : ' times.');
    case 'gather':
      if (o.nodeType === 'ore' && !o.itemId)
        return 'Mine ore veins ' + count + (count === '1' ? ' time.' : ' times.');
      return 'Gather ' + target + ' for ' + count + ' gathering credits.';
    default:
      return o.label.replace(/[.!]$/, '') + (count === '1' ? '.' : ': ' + count + ' required.');
  }
}
