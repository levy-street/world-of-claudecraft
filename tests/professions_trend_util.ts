// Shared helpers for the professions Guild-letter suite split
// (professions_trend_*.test.ts). Not a test file: nothing here runs on its
// own. Split from the original single-file tests/professions_trend.test.ts
// along describe boundaries for CI shard balance (a pure move).

import type { LetterDef } from '../src/sim/content/letters';
import { GUILD_TREND_LETTERS } from '../src/sim/content/letters';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { SimEvent } from '../src/sim/types';

// The ten canonical adjacent-pair ids over the locked CRAFT_RING order,
// pinned literally: a ring reorder or pair-id format change must fail here.
export const RING_PAIR_IDS = [
  'engineering+alchemy',
  'alchemy+cooking',
  'cooking+leatherworking',
  'leatherworking+tailoring',
  'tailoring+inscription',
  'inscription+enchanting',
  'enchanting+jewelcrafting',
  'jewelcrafting+weaponcrafting',
  'weaponcrafting+armorcrafting',
  'armorcrafting+engineering',
] as const;

export const makeWorld = () => new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });

export function tickFor(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.ceil(seconds * 20); i++) out.push(...sim.tick());
  return out;
}

export const guildLetters = (events: SimEvent[], pid: number) =>
  events.filter(
    (e) =>
      e.type === 'mailArrived' && e.pid === pid && (e.letterId ?? '').startsWith('guild_trend_'),
  );

// The raven's flight for this pair's letter, mirroring the PostOffice booking
// rule (sendLetter): an authored letter with no delaySeconds of its own flies
// for the standard 90 second NPC delivery delay (MAIL_NPC_DELIVERY_SECONDS,
// module-private in src/sim/mail/post_office.ts).
export const letterDelay = (pairId: string): number =>
  GUILD_TREND_LETTERS[pairId]?.delaySeconds ?? 90;

// These drive full mail-delivery windows through sim.tick(); give them real
// headroom under worker-pool CPU contention (the mail.test.ts precedent).
export const GUILD_DELIVERY_TEST_TIMEOUT_MS = 40_000;

// A synthetic PlayerMeta carrying exactly the fields the predicate reads, plus
// a spy ctx. Each of the three eligibility clauses gets a negative where ONLY
// that clause disqualifies, so deleting any single guard line in
// maybeSendGuildTrendLetter fails exactly one test here (the attuned/amends
// delivery tests above each flip two fields at once and cannot isolate them).
export function unitMeta(overrides: {
  guildLetterSent?: boolean;
  activeArchetype?: string | null;
  attunedPairs?: string[];
  craftSkills?: Record<string, number>;
}): PlayerMeta {
  return {
    guildLetterSent: overrides.guildLetterSent ?? false,
    archetype: {
      activeArchetype: overrides.activeArchetype ?? null,
      attunedPairs: overrides.attunedPairs ?? [],
    },
    craftSkills: overrides.craftSkills ?? { engineering: 15, alchemy: 15 },
  } as unknown as PlayerMeta;
}

export function spyCtx(): {
  ctx: SimContext;
  booked: { letter: LetterDef; flagAtCall: boolean }[];
} {
  const booked: { letter: LetterDef; flagAtCall: boolean }[] = [];
  const ctx = {
    mailAuthoredLetter: (meta: PlayerMeta, letter: LetterDef) => {
      booked.push({ letter, flagAtCall: meta.guildLetterSent === true });
    },
  } as unknown as SimContext;
  return { ctx, booked };
}
