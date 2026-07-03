// Authored mail content for the Ravenpost (the in-game mail service): the
// welcome letter every character receives once, and the NPC thank-you letters
// select quests send after their turn-in. Data-as-code, merged nowhere: the
// PostOffice (src/sim/mail/post_office.ts) reads these tables directly.
//
// English here is the source of truth; the client localizes each letter by its
// stable `letterId` (src/ui/mail_i18n.ts). Keep ids append-only: a delivered
// letter persists in the mail JSONB with its letterId, so renaming one orphans
// the localized copy of every letter already sitting in a mailbox.

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
