// The Highwatch adventurers' guild, Lantern Hall (sim/highwatch_layout.ts, the walk-in hall at
// the old stable yard; the model by scripts/assets/highwatch_guild/): its four residents, where
// they stand in the hall, and what each one does.
//  - Hesper Dunmore, the guildmaster, by her hearth (gossip: the guild's welcome);
//  - Tobias Wren, the contract clerk, behind his desk before the contracts board: talking to
//    him opens the guild window on the week's dungeon contracts (sim/guild_contracts.ts);
//  - Garrick Holt, the quartermaster, behind his counter: the guild window on his stock of
//    cosmetics, paid in Lantern Seals (sim/guild_quartermaster.ts);
//  - Mira Fairweather, the recruiter, at the map table: she opens the Dungeon Finder.
// Gossip, the window and the finder are routed by sim/highwatch_guild.ts.
//
// Every one is `dynamic`, so the world-init NPC loop skips them; ../highwatch_guild.ts spawns
// each under a reserved id in the singleton band (the steward's idiom), outside the sequential
// allocator, so no other entity's id moves and no parity golden changes.

import { HIGHWATCH_BUILDINGS_BY_ID } from '../highwatch_layout';
import { facingToward, localToWorld } from '../placed_town_kit';
import type { NpcDef } from '../types';

export const GUILDMASTER_NPC_ID = 'guildmaster_hesper_dunmore';
export const CONTRACT_CLERK_NPC_ID = 'contract_clerk_tobias_wren';
export const GUILD_QUARTERMASTER_NPC_ID = 'guild_quartermaster_garrick_holt';
export const GUILD_RECRUITER_NPC_ID = 'guild_recruiter_mira_fairweather';

/** Each resident's reserved entity id (types.ts STATIC_WORLD_SERVICE_ENTITY_ID_MIN's note;
 *  the band is pinned by tests/reserved_singleton_entity_ids.test.ts). */
export const HIGHWATCH_GUILD_ENTITY_IDS = {
  [GUILDMASTER_NPC_ID]: 1_000_000_008,
  [CONTRACT_CLERK_NPC_ID]: 1_000_000_009,
  [GUILD_QUARTERMASTER_NPC_ID]: 1_000_000_015,
  [GUILD_RECRUITER_NPC_ID]: 1_000_000_016,
} as const;

/** The residents with a window of their own (contracts, quartermaster, recruiter): the client
 *  sends them the authoritative interact instead of the gossip menu. The guildmaster only talks. */
export function isGuildServiceNpc(templateId: string): boolean {
  return (
    templateId === CONTRACT_CLERK_NPC_ID ||
    templateId === GUILD_QUARTERMASTER_NPC_ID ||
    templateId === GUILD_RECRUITER_NPC_ID
  );
}

/** How near a player must stand to deal with a resident (the instructors' reach). */
export const HIGHWATCH_GUILD_TALK_RANGE = 7;

const GUILD = HIGHWATCH_BUILDINGS_BY_ID.highwatch_guild;
/** A point in the guild's model frame (guild_plan.py) in the world. */
function inHall(x: number, z: number): { x: number; z: number } {
  return localToWorld(GUILD.placement, GUILD.rotation, x, z);
}

function stand(x: number, z: number, lookX: number, lookZ: number) {
  const pos = inHall(x, z);
  return { pos, facing: facingToward(pos, inHall(lookX, lookZ)) };
}

// the guildmaster by her hearth, turned toward the hall; the clerk between his desk and the
// board; the quartermaster behind his counter; the recruiter on the far side of the map table
const GUILDMASTER = stand(-7.0, 6.6, 0, -6);
const CLERK = stand(12.6, 0, 6, 0);
const QUARTERMASTER = stand(-12.4, -0.6, -6, -0.6);
const RECRUITER = stand(7.3, 8.6, 7.3, 0);

export const HIGHWATCH_GUILD_NPCS: Record<string, NpcDef> = {
  [GUILDMASTER_NPC_ID]: {
    id: GUILDMASTER_NPC_ID,
    name: 'Hesper Dunmore',
    title: 'Guildmaster of Lantern Hall',
    pos: GUILDMASTER.pos,
    facing: GUILDMASTER.facing,
    color: 0x2f4a7a,
    questIds: [],
    dynamic: true,
    greeting:
      "Welcome to Lantern Hall, $C. Tobias keeps the week's contracts on the board, Garrick trades our seals for honors worth wearing, and Mira will find you a party for any door below the mountain. Bring back a trophy and it hangs in the hall behind me.",
  },
  [CONTRACT_CLERK_NPC_ID]: {
    id: CONTRACT_CLERK_NPC_ID,
    name: 'Tobias Wren',
    title: 'Contract Clerk',
    pos: CLERK.pos,
    facing: CLERK.facing,
    color: 0x5a4a32,
    questIds: [],
    dynamic: true,
    greeting:
      'Three contracts a week, posted every reset. No signing, no fees: see one through and the seals are yours.',
  },
  [GUILD_QUARTERMASTER_NPC_ID]: {
    id: GUILD_QUARTERMASTER_NPC_ID,
    name: 'Garrick Holt',
    title: 'Guild Quartermaster',
    pos: QUARTERMASTER.pos,
    facing: QUARTERMASTER.facing,
    color: 0x6a3a2a,
    questIds: [],
    dynamic: true,
    greeting:
      'Seals for honors, friend. Nothing on my shelves will sharpen a blade, but every hall in Highwatch will know where you earned it.',
  },
  [GUILD_RECRUITER_NPC_ID]: {
    id: GUILD_RECRUITER_NPC_ID,
    name: 'Mira Fairweather',
    title: 'Guild Recruiter',
    pos: RECRUITER.pos,
    facing: RECRUITER.facing,
    color: 0x3a6a4a,
    questIds: [],
    dynamic: true,
    greeting:
      'Looking for a party? Every crypt, bastion and temple on this map has a name on my list. Tell me where you are headed.',
  },
};
