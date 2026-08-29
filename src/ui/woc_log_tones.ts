// The three chat-log tones the $WOC money surfaces write with, named once.
//
// The trade arm's controller passed these hex literals at 34 call sites (the
// fourth copy of the same triple across extracted controllers), so a retune
// meant a sweep and a miss read as a deliberate difference. The log API takes a
// colour string, so this is presentation vocabulary rather than a token: the
// values match the HUD's own success / error / notice log tones.
//
// DOM-free and deterministic (registered in tests/architecture.test.ts
// UI_PURE_CORES): three constants, no behavior.

/** A money action that landed (an offer sent, a payment confirmed, a sale). */
export const WOC_LOG_GOOD = '#7fdc4f';
/** A refusal the player must read (a server error, a wallet failure). */
export const WOC_LOG_BAD = '#ff6b6b';
/** A neutral money notice (a quote staged, a deal still waiting). */
export const WOC_LOG_NOTE = '#ffd100';
