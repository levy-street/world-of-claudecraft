// Authored mail content for the Ravenpost (the in-game mail service): the
// welcome letter every character receives once, the Heroic Marks reward
// letter, the NPC thank-you letters select quests send after their turn-in,
// and the Guild trend letters (one per adjacent craft pair, Professions 2.0).
// Data-as-code, merged nowhere: the PostOffice
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

// The one-time mastery reset notice (Professions 2.0): sent by the
// tick mail phase to every pre-curve character whose load-time normalize just
// zeroed their craft skills and gathering proficiencies (see
// src/sim/professions/mastery_reset.ts; the literal id here is pinned equal
// to its MASTERY_RESET_LETTER_ID). One-shot per character via the
// CharacterState masteryResetApplied flag, the mailWelcomed precedent.
export const MASTERY_RESET_LETTER: LetterDef = {
  letterId: 'mastery_reset_notice',
  senderName: 'The Guildhall',
  subject: 'Your craft, made honest',
  body:
    'Guildmate,\n\n' +
    'The guild has adopted a new reckoning of mastery. Every hand starts the ' +
    'climb again: your craft skills and your gathering proficiencies have ' +
    'been set to zero.\n\n' +
    'Everything else is yours, untouched: your recipes, your tools and ' +
    'materials, your bank and gold, your attunements and titles, your deeds ' +
    'and renown, your quests and mail.\n\n' +
    'The climb is honest now. Cheap work will not carry you. Seek harder ' +
    'recipes, richer veins, and deeper waters.\n\n' +
    'With respect,\nThe Guildhall',
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

// Guild trend letters (Professions 2.0): when an unattuned character's
// leading adjacent craft pair first crosses the letter threshold
// (src/sim/professions/trend.ts), the Crafting Guild sends exactly one of
// these. Keyed by the canonical pair id from ARCHETYPE_PAIR_TARGETS
// (src/sim/professions/archetype.ts); each letterId is 'guild_trend_' plus the
// pair id with its '+' replaced by '_'. delaySeconds stays unset so the
// standard NPC delivery delay applies. Smith Haldren stands in for the pair
// masters.
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

// Master tier-milestone letters (Professions 2.0): when one of a
// character's two attuned majors first reaches a tier milestone, the anchor
// master of that pair sends the matching congratulation. Keyed by the canonical
// archetype pair id (ARCHETYPE_PAIR_TARGETS) so the sender can look the set up
// directly from the active pair, then by tier 1..5 (25/50/75/100/125 skill =
// uncommon/rare/.../mastery work). Only the four wave-one pairs have seated
// masters, so only they carry tier letters. Each letterId derives mechanically
// from the pair, mirroring the GUILD_TREND_LETTERS family: 'prof_tier_' plus the
// canonical pairId with its '+' replaced by '_' plus the tier (e.g.
// prof_tier_weaponcrafting_armorcrafting_3). The module-load loop below pins that
// derivation. Bodies stay craft-generic since each archetype empowers two majors,
// and carry no copper or items. Ids are append-only, like every other letter here.
export const MASTER_TIER_LETTERS: Record<string, Record<number, LetterDef>> = {
  'weaponcrafting+armorcrafting': {
    1: {
      letterId: 'prof_tier_weaponcrafting_armorcrafting_1',
      senderName: 'Forgemistress Darva',
      subject: 'A spark worth noting',
      body: 'Word reaches my forge that one of your majors now holds at uncommon work. It is the smallest rung on a long climb, but you earned it at the anvil, not by asking. Keep the fire hot.',
    },
    2: {
      letterId: 'prof_tier_weaponcrafting_armorcrafting_2',
      senderName: 'Forgemistress Darva',
      subject: 'Rare work, and earned',
      body: 'They tell me a major of yours has reached rare work. That is the rung where sloppy hands fall away and the real smiths are left standing. You are still standing. Good.',
    },
    3: {
      letterId: 'prof_tier_weaponcrafting_armorcrafting_3',
      senderName: 'Forgemistress Darva',
      subject: 'The metal answers you now',
      body: 'A major of yours has climbed past rare into serious work. The metal answers a hand like that, no longer fighting it. Do not let the praise soften your arm.',
    },
    4: {
      letterId: 'prof_tier_weaponcrafting_armorcrafting_4',
      senderName: 'Forgemistress Darva',
      subject: 'Near the top of the ladder',
      body: 'One of your majors stands a single rung below mastery. Few hands I have known reach this height, and fewer keep their edge here. Finish the climb.',
    },
    5: {
      letterId: 'prof_tier_weaponcrafting_armorcrafting_5',
      senderName: 'Forgemistress Darva',
      subject: 'Mastery, at last',
      body: 'A major of yours has reached mastery, the highest a hand can climb. I do not give praise freely, so hear this once: the forge is proud of you. Now go teach the fire something new.',
    },
  },
  'leatherworking+tailoring': {
    1: {
      letterId: 'prof_tier_leatherworking_tailoring_1',
      senderName: 'Weaver Ottilie',
      subject: 'An even first row',
      body: 'The guild notes that one of your majors has reached uncommon work. It is only the first row of many, but it is even and true. Measure the next as carefully.',
    },
    2: {
      letterId: 'prof_tier_leatherworking_tailoring_2',
      senderName: 'Weaver Ottilie',
      subject: 'Rare work, well measured',
      body: 'A major of yours has climbed to rare work. That is where a careless hand shows every dropped stitch, and yours has not. I am quietly pleased.',
    },
    3: {
      letterId: 'prof_tier_leatherworking_tailoring_3',
      senderName: 'Weaver Ottilie',
      subject: 'The pattern comes clear',
      body: 'One of your majors has passed rare into finer work. The pattern comes clear to a hand at this level, no more guessing. Keep measuring twice.',
    },
    4: {
      letterId: 'prof_tier_leatherworking_tailoring_4',
      senderName: 'Weaver Ottilie',
      subject: 'One row from the top',
      body: 'A major of yours sits one row short of mastery. The last row is always the hardest to keep even. Do not rush it now.',
    },
    5: {
      letterId: 'prof_tier_leatherworking_tailoring_5',
      senderName: 'Weaver Ottilie',
      subject: 'The last stitch',
      body: 'A major of yours has reached mastery. I measured your work twice, as I measure everything, and it holds. Few hands ever tie the last stitch this cleanly. I am proud, and I do not say so lightly.',
    },
  },
  'alchemy+cooking': {
    1: {
      letterId: 'prof_tier_alchemy_cooking_1',
      senderName: 'Cook Marlow',
      subject: 'A taste of things to come',
      body: 'Word drifts back to my kitchen that one of your majors has reached uncommon work. It is a first taste, nothing more, but a promising one. Keep the pot moving.',
    },
    2: {
      letterId: 'prof_tier_alchemy_cooking_2',
      senderName: 'Cook Marlow',
      subject: 'Rare work, and no burnt edges',
      body: 'They tell me a major of yours has simmered up to rare work. That is the heat where most cooks scorch the dish, and you did not. Sit, but not for long.',
    },
    3: {
      letterId: 'prof_tier_alchemy_cooking_3',
      senderName: 'Cook Marlow',
      subject: 'Now you are cooking',
      body: 'One of your majors has bubbled past rare into real depth. Now you are cooking, as they say. Season boldly and keep tasting.',
    },
    4: {
      letterId: 'prof_tier_alchemy_cooking_4',
      senderName: 'Cook Marlow',
      subject: 'One course from the feast',
      body: 'A major of yours is a single course short of mastery. The last one is always the richest and the easiest to overdo. Steady hands on the ladle.',
    },
    5: {
      letterId: 'prof_tier_alchemy_cooking_5',
      senderName: 'Cook Marlow',
      subject: 'Mastery, served hot',
      body: 'A major of yours has reached mastery, the top shelf of the whole pantry. I feed everyone, but few ever cook their way up here. Proud of you, truly. Now go make something that makes them weep at the table.',
    },
  },
  'engineering+alchemy': {
    1: {
      letterId: 'prof_tier_engineering_alchemy_1',
      senderName: 'Tinker Gizzel',
      subject: 'FIRST spark, ha',
      body: 'Oi, the numbers say one of your majors just hit uncommon work, small potatoes, tiny, but it POPPED, yes? First spark is always the cutest. More sparks. Go.',
    },
    2: {
      letterId: 'prof_tier_engineering_alchemy_2',
      senderName: 'Tinker Gizzel',
      subject: 'Rare, oh, RARE',
      body: 'They tell me a major of yours climbed to rare work, and rare is where it starts getting properly dangerous (the good kind). Most hands quit before the fun. Not you. HA.',
    },
    3: {
      letterId: 'prof_tier_engineering_alchemy_3',
      senderName: 'Tinker Gizzel',
      subject: 'Now it gets loud',
      body: 'One of your majors blew past rare into the serious stuff, oh this is where it gets LOUD. Do not stop now, whatever you do, momentum is everything, also fuses.',
    },
    4: {
      letterId: 'prof_tier_engineering_alchemy_4',
      senderName: 'Tinker Gizzel',
      subject: 'One rung, ONE, from the top',
      body: 'A major of yours is ONE rung under mastery, one, singular, do you feel it humming? The last step is the biggest bang. Do not blink.',
    },
    5: {
      letterId: 'prof_tier_engineering_alchemy_5',
      senderName: 'Tinker Gizzel',
      subject: 'MASTERY, kaboom',
      body: 'A major of yours hit mastery, the very TOP, kaboom, the whole ladder, done. I do not hand out praise, I hand out fuses, but here, take both: you are brilliant and slightly terrifying. Go make the mountains nervous.',
    },
  },
};

// The four wave-one adjacent pairs that have a seated anchor master, a subset of
// ARCHETYPE_PAIR_TARGETS. Only these carry tier letters.
const MASTER_TIER_PAIRS: readonly string[] = [
  'weaponcrafting+armorcrafting',
  'leatherworking+tailoring',
  'alchemy+cooking',
  'engineering+alchemy',
];

// Guard the tier-letter set against the ring the same way GUILD_TREND_LETTERS is
// guarded: every wave-one pair must be a real ARCHETYPE_PAIR_TARGET, present with
// tiers 1..5, and each letterId must derive from the canonical pairId, so a
// renamed pair or a mistyped id fails loudly at load rather than orphaning a
// letter or its localized copy.
for (const pairId of MASTER_TIER_PAIRS) {
  if (!ARCHETYPE_PAIR_TARGETS.includes(pairId)) {
    throw new Error(`MASTER_TIER_LETTERS names unknown pair ${pairId}`);
  }
  const byTier = MASTER_TIER_LETTERS[pairId];
  if (!byTier) throw new Error(`MASTER_TIER_LETTERS is missing pair ${pairId}`);
  for (let tier = 1; tier <= 5; tier++) {
    const letter = byTier[tier];
    if (!letter) throw new Error(`MASTER_TIER_LETTERS ${pairId} is missing tier ${tier}`);
    const expectedId = `prof_tier_${pairId.replace('+', '_')}_${tier}`;
    if (letter.letterId !== expectedId) {
      throw new Error(`MASTER_TIER_LETTERS ${pairId} tier ${tier} letterId must be ${expectedId}`);
    }
  }
}
for (const pairId of Object.keys(MASTER_TIER_LETTERS)) {
  if (!MASTER_TIER_PAIRS.includes(pairId)) {
    throw new Error(`MASTER_TIER_LETTERS has unexpected pair ${pairId}`);
  }
}
