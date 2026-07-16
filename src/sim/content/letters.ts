// Authored mail content for the Ravenpost (the in-game mail service): the
// welcome letter every character receives once, and the NPC thank-you letters
// select quests send after their turn-in. Data-as-code, merged nowhere: the
// PostOffice (src/sim/mail/post_office.ts) reads these tables directly.
//
// English here is the source of truth; the client localizes each letter by its
// stable `letterId` through the entity dictionary (src/ui/entity_i18n.ts kind
// 'letter', sourced from src/ui/world_entity_i18n.ts). Keep ids append-only: a delivered
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

// World Market auction outcomes: the Merchant writes when the affected player
// is OFFLINE (online players get the structured market events instead). The
// letters carry NO coin or items: every refund, payout, and returned lot moves
// through the Merchant's collection box, never the mail. Ids are append-only
// like every letterId above.
export const AUCTION_LETTERS: Record<
  'outbid' | 'won' | 'sold' | 'expired' | 'sold_wallet' | 'sold_account',
  LetterDef
> = {
  outbid: {
    letterId: 'market_outbid',
    senderName: 'The Merchant',
    subject: 'You have been outbid',
    body:
      'Another buyer has raised the bidding on a lot you wanted. Your copper ' +
      'waits in your collection box at the World Market; come see me to take ' +
      'it back or bid again.\n\n- The Merchant',
  },
  won: {
    letterId: 'market_won',
    senderName: 'The Merchant',
    subject: 'Your winning bid',
    body:
      'The hammer has fallen and the lot is yours. Your goods wait in your ' +
      'collection box at the World Market; come see me to claim them.\n\n' +
      '- The Merchant',
  },
  sold: {
    letterId: 'market_sold',
    senderName: 'The Merchant',
    subject: 'Your lot has sold',
    body:
      'A buyer has taken your goods off my hands. Your proceeds wait in your ' +
      'collection box at the World Market; come see me to collect them.\n\n' +
      '- The Merchant',
  },
  // External-denomination sales: the buyer paid the seller directly (wallet to
  // wallet, or Claudium account to account), so the body must NOT claim copper
  // waits at the Merchant. Only the listing deposit refund sits in collection.
  sold_wallet: {
    letterId: 'market_sold_wallet',
    senderName: 'The Merchant',
    subject: 'Your lot has sold',
    body:
      'A buyer has taken your goods off my hands. The payment went straight to ' +
      'your linked wallet, as you asked; only your listing deposit waits in ' +
      'your collection box at the World Market. Come see me to take it back.\n\n' +
      '- The Merchant',
  },
  sold_account: {
    letterId: 'market_sold_account',
    senderName: 'The Merchant',
    subject: 'Your lot has sold',
    body:
      'A buyer has taken your goods off my hands. The payment went straight to ' +
      'your Claudium balance; only your listing deposit waits in your ' +
      'collection box at the World Market. Come see me to take it back.\n\n' +
      '- The Merchant',
  },
  expired: {
    letterId: 'market_expired',
    senderName: 'The Merchant',
    subject: 'Your listing expired',
    body:
      'No buyer came for your goods before the listing ran out. They wait in ' +
      'your collection box at the World Market; come see me to take them ' +
      'back.\n\n- The Merchant',
  },
};

// G2b trade settlement (server-driven, src/sim/sim.ts sendTradeLetter): the
// two escrow-release letters, keyed by letterId (not by quest id, hence a
// separate table from QUEST_LETTERS). senderName is the courier, not the
// trading partner, matching the welcome letter's convention (a stable,
// canonical sender the client localizes via letterId) rather than a
// per-delivery dynamic name, which the letterId-driven client pipeline has
// no seam for (mailbox_window.ts resolves sender/subject/body from this
// table whenever row.letterId is set, ignoring the DB-stored literal). The
// canonical English here must stay byte-identical to sim.ts's inline
// sendTradeLetter payload: that literal is what a non-localized (or
// pre-i18n-pipeline) consumer of the raw mail row would see, and the two
// must never drift.
export const TRADE_LETTERS: Record<string, LetterDef> = {
  delivery: {
    letterId: 'trade_delivery',
    senderName: 'The Ravenpost',
    subject: 'Trade delivery',
    body: 'Goods from your trade have arrived. The raven carried what your bags could not.',
    delaySeconds: 5,
  },
  refund: {
    letterId: 'trade_refund',
    senderName: 'The Ravenpost',
    subject: 'Trade goods returned',
    body: 'Your trade did not complete. Everything you offered has been returned.',
    delaySeconds: 5,
  },
};
