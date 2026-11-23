// The fill each part of a nameplate's tag takes: the name, the level, the
// guild line and the deed title. Pure: the canvas surface (nameplate_canvas.ts)
// asks these for its fills, so the colour rules read and test without a canvas.
//
// The World PvP bounty: a player whose kill streak earned a bounty
// (src/sim/pvp/world_pvp_bounty.ts, mirrored on `Entity.bounty`) wears the
// whole name tag in blood red (the name row with its `<Bounty>`, `<PvP>` and
// `<AFK>` tags, the guild or pledge line and the deed title), so the mark reads
// at a glance from any angle and stands apart from the lighter hostile-name red
// every enemy player wears. The chips that carry their own meaning keep their
// own colour: the AI chip, the Cheater sanction and the image badges. The
// level badge is a mob-only con colour, so the bounty never reaches it in
// practice. The `<Bounty>` text tag is the non-colour cue (forced colours
// flatten every fill to CanvasText). The paint gate diffs the `bounty` bit,
// so a bounty placed or ended repaints the plate on the next pass.

/** Blood red, darker than the hostile-name red (#ff5555) so the two never read
 *  as the same mark. The black outline every plate text carries keeps it
 *  legible over a bright sky. */
export const NAMEPLATE_BOUNTY_FILL = '#c41e1e';

/** Guild colour tiers (sim/guild_tier.ts): the guild line's fill by the
 *  guild's collective lifetime XP. Index IS the tier; 0 keeps the classic
 *  fill every fresh guild has always had. Cosmetic only. */
export const GUILD_TIER_FILLS: readonly string[] = [
  '#c9dcfb', // 0: the classic guild blue
  '#9fe8a8', // 1: spring green, a few actives
  '#5fd3e8', // 2: cyan, an established roster
  '#e8b45f', // 3: amber, a serious guild
  '#ffcf40', // 4: gold, the realm's elite
];

/** Does this entity wear the bounty mark? Players only: the sim writes the bit
 *  on players alone, and a stray bit on anything else must never paint. */
export function nameplateHasBounty(entity: { readonly kind: string; readonly bounty?: boolean }) {
  return entity.kind === 'player' && entity.bounty === true;
}

/** The fill a part of the tag takes: blood red under a bounty, else its own. */
export function bountyFill(bounty: boolean, fill: string): string {
  return bounty ? NAMEPLATE_BOUNTY_FILL : fill;
}

/** The guild line's fill: blood red under a bounty, else its tier's colour (an
 *  unknown tier reads as the classic tier 0). */
export function nameplateGuildFill(bounty: boolean, tier: number): string {
  return bountyFill(bounty, GUILD_TIER_FILLS[tier] ?? GUILD_TIER_FILLS[0]);
}

/** The name's fill, in priority order: a dead enemy's corpse grey (a body is no
 *  longer a target), the bounty's blood red, the hostile red, then the plate's
 *  own colour. */
export function nameplateNameFill(state: {
  readonly deadEnemy: boolean;
  readonly bounty: boolean;
  readonly hostile: boolean;
  readonly nameColor: string;
}): string {
  if (state.deadEnemy) return '#bbb';
  if (state.bounty) return NAMEPLATE_BOUNTY_FILL;
  return state.hostile ? '#ff5555' : state.nameColor;
}
