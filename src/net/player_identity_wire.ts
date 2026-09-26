// Wire decode for a full identity record's player identity lines: the guild
// (or a pledge to one), the guild colour tier, the Book of Deeds title and
// nameplate border, and the chosen talent spec. The encode half is
// server/player_identity_wire.ts; tests/player_identity_wire.test.ts round-trips
// the pair so a renamed key cannot drift on one side only.
//
// Extracted from the online.ts identity block (the wire-decode sibling idiom,
// src/net/CLAUDE.md), DOM-free and ClientWorld-free so it is unit-testable
// without a socket. An identity record is authoritative and complete, so every
// field resets to its "none" default when the record omits it. The five fields
// that predate the extraction keep their exact inline semantics; the spec is
// new and re-validated, since a non-string spec id could only ever be a
// malformed record.

export interface PlayerIdentityWire {
  guild: string;
  pledgeGuild: string;
  guildTier: number;
  title: string | null;
  border: string | null;
  specId: string | null;
}

export function decodePlayerIdentityWire(w: Record<string, unknown>): PlayerIdentityWire {
  return {
    guild: (w.gd as string | undefined) ?? '',
    pledgeGuild: (w.pg as string | undefined) ?? '',
    guildTier: (w.gt as number | undefined) ?? 0,
    title: (w.title as string | null | undefined) ?? null, // Book of Deeds active title (a deed id)
    border: (w.border as string | null | undefined) ?? null, // Book of Deeds nameplate border (a deed id)
    specId: typeof w.spc === 'string' && w.spc !== '' ? w.spc : null, // chosen talent spec id
  };
}
