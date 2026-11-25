import type { QuestObjective } from '../../src/sim/types';

const introductions: Record<string, string> = {
  Combat:
    'In a fight, you use attacks and abilities to hurt enemies, heal friends and stop enemies from acting. Your stats, your resources, where you stand and when you act all change how the fight goes.',
  'Crafting recipes':
    'A crafting recipe tells you what you can make, which materials you need and what else you need to make it.',
  'Delve companions':
    'Delve companions go into delves with you and fight at your side. Each companion has its own job in a fight and its own abilities.',
  'Equipment enchants':
    'Equipment enchants add bonuses to gear. Each enchant only works on some kinds of gear, so check what it needs before you use it.',
  'Equipment sets':
    'An equipment set is a group of items that belong together. Wear enough pieces of the same set at once to get extra bonuses.',
  'Farm crops':
    'Crops grow in farm plots. When you harvest them, you get materials. Each crop has its own seeds, its own needs for growing and its own harvest rewards.',
  Ferries:
    'Ferries carry you between set stops around the world. The routes below show where to get on and where each ferry goes.',
  'Hoard encounters':
    'Hoard encounters are fights that guard buried treasure. Which fight you get, and what you win, depends on the hoard you dig up.',
  'Mount appearances':
    'Mount appearances change how your mount looks. This page lists each look and how to unlock it.',
  'Rift floors':
    'A rift has several floors, each with its own enemies and goal. Finish the goal on your floor to move on through the rift.',
  'Weapon appearances':
    'Weapon appearances change how your weapon looks. This page lists the looks you can collect and what you need to unlock each one.',
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
      return 'Gather ' + target + ' until you earn ' + count + ' gathering credits.';
    default:
      return o.label.replace(/[.!]$/, '') + (count === '1' ? '.' : ' (' + count + ' needed).');
  }
}
