// Authored mail content for the Ravenpost (the in-game mail service): the
// welcome letter every character receives once, the Heroic Marks reward
// letter, the NPC thank-you letters select quests send after their turn-in,
// and the Guild trend letters (one per adjacent craft pair, Professions 2.0
// Phase 7). Data-as-code, merged nowhere: the PostOffice
// (src/sim/mail/post_office.ts) reads these tables directly.
//
// English here is the source of truth; the client localizes each letter by its
// stable `letterId` through the entity dictionary (src/ui/entity_i18n.ts kind
// 'letter', sourced from src/ui/world_entity_i18n.ts). Keep ids append-only: a delivered
// letter persists in the mail JSONB with its letterId, so renaming one orphans
// the localized copy of every letter already sitting in a mailbox.

import { ARCHETYPE_PAIR_TARGETS } from '../professions/archetype';
import type { InvSlot } from '../types';

export interface LetterDef {
  letterId: string;
  senderName: string; // display name, localized client-side via the letterId
  subject: string;
  body: string;
  copper?: number;
  items?: InvSlot[];
  // Seconds after the trigger before the raven lands (0 = instant).
  delaySeconds?: number;
}

// The one-time service letter. Sent to every character that has never been
// welcomed (new characters right away, pre-mail characters on their next
// login), so it doubles as the feature announcement.
export const WELCOME_LETTER: LetterDef = {
  letterId: 'ravenpost_welcome',
  senderName: 'The Ravenpost',
  subject: 'The ravens now fly for you',
  body:
    'Traveler,\n\n' +
    'The Ravenpost has opened its perches across the vale. Seek the raven ' +
    'pillars in Eastbrook, Fenbridge and Highwatch: from any of them you may ' +
    'send letters, coin and goods to other adventurers, and collect whatever ' +
    'the ravens bring you.\n\n' +
    'Enclosed is a small courtesy for your first stamp.\n\n' +
    'Wings up,\nThe Ravenpost',
  copper: 50,
  delaySeconds: 0,
};

// Heroic Marks reward letter: posted to a heroic final-boss participant who took
// the daily lockout but was not standing at the corpse to loot their marks (a
// back-line healer, a fallen or released raider). The mark stacks ride as the
// attachment; the PostOffice fills `items` per kill (marks vary by dungeon), so
// this base carries none. Body stays count-free so the letterId localizes cleanly.
export const HEROIC_MARK_LETTER: LetterDef = {
  letterId: 'heroic_marks_reward',
  senderName: 'The Heroic Quartermaster',
  subject: 'Your Heroic Marks',
  body:
    'Your warband cleared the heroic trial while you fought from the back, or ' +
    'from the dirt. Your lockout was struck all the same, so your share of ' +
    'Heroic Marks flies to you here rather than being lost. Spend them well.\n\n' +
    '- The Heroic Quartermaster',
  delaySeconds: 0,
};

// Quest follow-up letters: the questgiver writes to you a little while after
// the turn-in. Keyed by quest id; quests without an entry send nothing.
export const QUEST_LETTERS: Record<string, LetterDef> = {
  q_wolves: {
    letterId: 'letter_q_wolves',
    senderName: 'Marshal Redbrook',
    subject: 'The pens are quiet again',
    body:
      'The herders can sleep with both eyes shut for once, and that is your ' +
      'doing. I have told the Ravenpost to carry you a little something from ' +
      'the watch fund.\n\n' +
      'Keep your blade oiled.\n- Marshal Redbrook',
    copper: 15,
    delaySeconds: 90,
  },
  q_greyjaw: {
    letterId: 'letter_q_greyjaw',
    senderName: 'Marshal Redbrook',
    subject: 'Old Greyjaw, at last',
    body:
      'Word travels fast in a town this small. The herders drank to your ' +
      'health last night, and Wilkes swears the wolf was the size of a cart. ' +
      'Let them embellish: you earned it.\n\n' +
      'Share a meal on the watch.\n- Marshal Redbrook',
    items: [{ itemId: 'roasted_boar', count: 2 }],
    delaySeconds: 120,
  },
  q_hollow: {
    letterId: 'letter_q_hollow',
    senderName: 'Brother Aldric',
    subject: 'What you did in the dark',
    body:
      'Few will ever know what was buried in that hollow, and fewer still ' +
      'would believe it. I know, and I will not forget.\n\n' +
      'May your road stay lit.\n- Brother Aldric',
    copper: 250,
    delaySeconds: 150,
  },
};

// Guild trend letters (Professions 2.0 Phase 7): when an unattuned character's
// leading adjacent craft pair first crosses the letter threshold
// (src/sim/professions/trend.ts), the Crafting Guild sends exactly one of
// these. Keyed by the canonical pair id from ARCHETYPE_PAIR_TARGETS
// (src/sim/professions/archetype.ts); each letterId is 'guild_trend_' plus the
// pair id with its '+' replaced by '_'. delaySeconds stays unset so the
// standard NPC delivery delay applies. Smith Haldren stands in for the pair
// masters until Phase 8 seats them.
export const GUILD_TREND_LETTERS: Record<string, LetterDef> = {
  'engineering+alchemy': {
    letterId: 'guild_trend_engineering_alchemy',
    senderName: 'The Crafting Guild',
    subject: 'Your work in Engineering and Alchemy',
    body:
      'Artisan,\n\n' +
      'Word reaches the Guild of your work in Engineering and Alchemy: charges ' +
      'measured and reagents weighed, the two crafts feeding one another. ' +
      'Neighboring crafts worked together mark a hand ready for attunement. ' +
      'Those who bind this pair earn the name of Bombardier in time. Seek out ' +
      'Smith Haldren, the armorer of Eastbrook: he speaks for the masters for ' +
      'now. Prove your craft to him with work of your own hands, and he will ' +
      'see your two majors attuned.\n\n' +
      'In good standing,\nThe Crafting Guild',
  },
  'alchemy+cooking': {
    letterId: 'guild_trend_alchemy_cooking',
    senderName: 'The Crafting Guild',
    subject: 'Your work in Alchemy and Cooking',
    body:
      'Artisan,\n\n' +
      'Word reaches the Guild of your work in Alchemy and Cooking: draughts ' +
      'simmered and dishes seasoned, the two crafts feeding one another. ' +
      'Neighboring crafts worked together mark a hand ready for attunement. ' +
      'Those who bind this pair earn the name of Apothecary in time. Seek out ' +
      'Smith Haldren, the armorer of Eastbrook: he speaks for the masters for ' +
      'now. Prove your craft to him with work of your own hands, and he will ' +
      'see your two majors attuned.\n\n' +
      'In good standing,\nThe Crafting Guild',
  },
  'cooking+leatherworking': {
    letterId: 'guild_trend_cooking_leatherworking',
    senderName: 'The Crafting Guild',
    subject: 'Your work in Cooking and Leatherworking',
    body:
      'Artisan,\n\n' +
      'Word reaches the Guild of your work in Cooking and Leatherworking: ' +
      'meals plated and hides cured, the two crafts feeding one another. ' +
      'Neighboring crafts worked together mark a hand ready for attunement. ' +
      'Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the ' +
      'masters for now. Prove your craft to him with work of your own hands, ' +
      'and he will see your two majors attuned.\n\n' +
      'In good standing,\nThe Crafting Guild',
  },
  'leatherworking+tailoring': {
    letterId: 'guild_trend_leatherworking_tailoring',
    senderName: 'The Crafting Guild',
    subject: 'Your work in Leatherworking and Tailoring',
    body:
      'Artisan,\n\n' +
      'Word reaches the Guild of your work in Leatherworking and Tailoring: ' +
      'leather cut and cloth hemmed, the two crafts feeding one another. ' +
      'Neighboring crafts worked together mark a hand ready for attunement. ' +
      'Those who bind this pair earn the name of Outfitter in time. Seek out ' +
      'Smith Haldren, the armorer of Eastbrook: he speaks for the masters for ' +
      'now. Prove your craft to him with work of your own hands, and he will ' +
      'see your two majors attuned.\n\n' +
      'In good standing,\nThe Crafting Guild',
  },
  'tailoring+inscription': {
    letterId: 'guild_trend_tailoring_inscription',
    senderName: 'The Crafting Guild',
    subject: 'Your work in Tailoring and Inscription',
    body:
      'Artisan,\n\n' +
      'Word reaches the Guild of your work in Tailoring and Inscription: ' +
      'seams stitched and glyphs inked, the two crafts feeding one another. ' +
      'Neighboring crafts worked together mark a hand ready for attunement. ' +
      'Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the ' +
      'masters for now. Prove your craft to him with work of your own hands, ' +
      'and he will see your two majors attuned.\n\n' +
      'In good standing,\nThe Crafting Guild',
  },
  'inscription+enchanting': {
    letterId: 'guild_trend_inscription_enchanting',
    senderName: 'The Crafting Guild',
    subject: 'Your work in Inscription and Enchanting',
    body:
      'Artisan,\n\n' +
      'Word reaches the Guild of your work in Inscription and Enchanting: ' +
      'scrolls lettered and charms woven, the two crafts feeding one another. ' +
      'Neighboring crafts worked together mark a hand ready for attunement. ' +
      'Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the ' +
      'masters for now. Prove your craft to him with work of your own hands, ' +
      'and he will see your two majors attuned.\n\n' +
      'In good standing,\nThe Crafting Guild',
  },
  'enchanting+jewelcrafting': {
    letterId: 'guild_trend_enchanting_jewelcrafting',
    senderName: 'The Crafting Guild',
    subject: 'Your work in Enchanting and Jewelcrafting',
    body:
      'Artisan,\n\n' +
      'Word reaches the Guild of your work in Enchanting and Jewelcrafting: ' +
      'charms bound and stones polished, the two crafts feeding one another. ' +
      'Neighboring crafts worked together mark a hand ready for attunement. ' +
      'Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the ' +
      'masters for now. Prove your craft to him with work of your own hands, ' +
      'and he will see your two majors attuned.\n\n' +
      'In good standing,\nThe Crafting Guild',
  },
  'jewelcrafting+weaponcrafting': {
    letterId: 'guild_trend_jewelcrafting_weaponcrafting',
    senderName: 'The Crafting Guild',
    subject: 'Your work in Jewelcrafting and Weaponcrafting',
    body:
      'Artisan,\n\n' +
      'Word reaches the Guild of your work in Jewelcrafting and ' +
      'Weaponcrafting: gems seated and edges ground, the two crafts feeding ' +
      'one another. Neighboring crafts worked together mark a hand ready for ' +
      'attunement. Seek out Smith Haldren, the armorer of Eastbrook: he ' +
      'speaks for the masters for now. Prove your craft to him with work of ' +
      'your own hands, and he will see your two majors attuned.\n\n' +
      'In good standing,\nThe Crafting Guild',
  },
  'weaponcrafting+armorcrafting': {
    letterId: 'guild_trend_weaponcrafting_armorcrafting',
    senderName: 'The Crafting Guild',
    subject: 'Your work in Weaponcrafting and Armorcrafting',
    body:
      'Artisan,\n\n' +
      'Word reaches the Guild of your work in Weaponcrafting and ' +
      'Armorcrafting: blades tempered and plates fitted, the two crafts ' +
      'feeding one another. Neighboring crafts worked together mark a hand ' +
      'ready for attunement. Those who bind this pair earn the name of Smith ' +
      'in time. Seek out Smith Haldren, the armorer of Eastbrook: he speaks ' +
      'for the masters for now. Prove your craft to him with work of your own ' +
      'hands, and he will see your two majors attuned.\n\n' +
      'In good standing,\nThe Crafting Guild',
  },
  'armorcrafting+engineering': {
    letterId: 'guild_trend_armorcrafting_engineering',
    senderName: 'The Crafting Guild',
    subject: 'Your work in Armorcrafting and Engineering',
    body:
      'Artisan,\n\n' +
      'Word reaches the Guild of your work in Armorcrafting and Engineering: ' +
      'plates riveted and gears trued, the two crafts feeding one another. ' +
      'Neighboring crafts worked together mark a hand ready for attunement. ' +
      'Seek out Smith Haldren, the armorer of Eastbrook: he speaks for the ' +
      'masters for now. Prove your craft to him with work of your own hands, ' +
      'and he will see your two majors attuned.\n\n' +
      'In good standing,\nThe Crafting Guild',
  },
};

// Guard the authored key set against the ring: a reordered or renamed pair id
// must fail loudly at load, never silently orphan a letter or its id scheme.
for (const pairId of ARCHETYPE_PAIR_TARGETS) {
  const letter = GUILD_TREND_LETTERS[pairId];
  if (!letter) throw new Error(`GUILD_TREND_LETTERS is missing pair ${pairId}`);
  const expectedId = `guild_trend_${pairId.replace('+', '_')}`;
  if (letter.letterId !== expectedId) {
    throw new Error(`GUILD_TREND_LETTERS ${pairId} letterId must be ${expectedId}`);
  }
}
for (const pairId of Object.keys(GUILD_TREND_LETTERS)) {
  if (!ARCHETYPE_PAIR_TARGETS.includes(pairId)) {
    throw new Error(`GUILD_TREND_LETTERS has unknown pair ${pairId}`);
  }
}
