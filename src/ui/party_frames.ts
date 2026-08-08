import { isPartyFrameRelevantAura } from '../sim/aura_classify';
import type { PartyInfo, PartyMemberInfo } from '../world_api';
import type { PartyPetInfo } from './pet_frame_view';

/**
 * The distance past which a party/raid row is badged out of range.
 *
 * This is the healer's ONLY signal for "can I reach them", so it has to be the
 * range they can actually cast at, not the range at which the client still knows
 * the body exists. It was 100, close to the interest radius, while every
 * friendly-targeted ability in the game is 30: a member anywhere from 30 to 100
 * yards away showed a clean row and refused every heal with "Out of range",
 * which is exactly what battleground healers reported.
 *
 * Pinned against the real ability table by `tests/party_frames.test.ts`, so
 * retuning heal range fails the test rather than silently desyncing the badge.
 *
 * What it still cannot tell you is LINE OF SIGHT: a member in range behind a
 * wall reads as reachable and the cast refuses. That is a separate surface, not
 * something a distance threshold can express.
 */
export const PARTY_FRAME_RANGE_YD = 30;

/** A member row's data. `pet` is attached CLIENT-SIDE from the entity roster
 *  (findPetsByOwner), not from the party wire: absent when the member has no pet,
 *  when their pet is outside the client's interest scope, or when the Show Pets
 *  display option is off. */
export type PartyFrameMember = PartyMemberInfo & { oor: boolean; pet?: PartyPetInfo };

/** Owner entity id -> that owner's pet. Built once per repaint by the caller. */
export type PartyPetMap = ReadonlyMap<number, PartyPetInfo>;

export type PartyFrameHealthTextMode = 0 | 1 | 2 | 3;
export type PartyFrameSortMode = 0 | 1 | 2;
export type PartyFrameStyleMode = 0 | 1 | 2;
export type PartyFrameStyle = 'classic' | 'raid';

export interface PartyFrameDisplayConfig {
  showSelf: boolean;
  showResource: boolean;
  showAbsorbs: boolean;
  showAuras: boolean;
  showPets: boolean;
  healthText: PartyFrameHealthTextMode;
  sort: PartyFrameSortMode;
  presentation: PartyFrameStyleMode;
}

export const DEFAULT_PARTY_FRAME_DISPLAY: PartyFrameDisplayConfig = {
  showSelf: false,
  showResource: true,
  showAbsorbs: true,
  showAuras: true,
  showPets: true,
  healthText: 1,
  sort: 0,
  presentation: 0,
};

const ROLE_ORDER = { tank: 0, healer: 1, dps: 2 } as const;

export { isPartyFrameRelevantAura as partyFrameAuraIsRelevant };

/** Resolve the persisted presentation choice. Automatic keeps classic five-player
 * frames, then switches to the compact grid when the party is converted to a raid. */
export function resolvePartyFrameStyle(mode: PartyFrameStyleMode, raid: boolean): PartyFrameStyle {
  if (mode === 2) return 'raid';
  if (mode === 1) return 'classic';
  return raid ? 'raid' : 'classic';
}

export function partyFrameHealthText(
  hp: number,
  maxHp: number,
  mode: PartyFrameHealthTextMode,
  format: (value: number, percent?: boolean) => string,
): string {
  const current = Math.max(0, Math.round(hp));
  const maximum = Math.max(1, Math.round(maxHp));
  if (mode === 1) return format(current / maximum, true);
  if (mode === 2) return format(current);
  if (mode === 3) return `${format(current)} / ${format(maximum)}`;
  return '';
}

const stableNameCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function selectPartyFrameMembers(
  info: PartyInfo,
  playerId: number,
  playerPos: { x: number; z: number },
  rangeYd = PARTY_FRAME_RANGE_YD,
  config: PartyFrameDisplayConfig = DEFAULT_PARTY_FRAME_DISPLAY,
  pets?: PartyPetMap,
): PartyFrameMember[] {
  return info.members
    .map((member, index) => ({ member, index }))
    .sort((a, b) => {
      if (config.sort === 2)
        return stableNameCompare(a.member.name, b.member.name) || a.member.pid - b.member.pid;
      if (config.sort === 1) {
        const ar = a.member.role ? ROLE_ORDER[a.member.role] : ROLE_ORDER.dps;
        const br = b.member.role ? ROLE_ORDER[b.member.role] : ROLE_ORDER.dps;
        return (
          ar - br || stableNameCompare(a.member.name, b.member.name) || a.member.pid - b.member.pid
        );
      }
      return info.raid ? a.member.group - b.member.group || a.index - b.index : a.index - b.index;
    })
    .map(({ member }) => member)
    .filter((m) => config.showSelf || m.pid !== playerId)
    .map((m) => {
      const pet = config.showPets ? pets?.get(m.pid) : undefined;
      return {
        ...m,
        oor:
          m.pid !== playerId &&
          !m.dead &&
          Math.hypot(m.x - playerPos.x, m.z - playerPos.z) > rangeYd,
        ...(pet ? { pet } : {}),
      };
    });
}

/**
 * The cheap per-frame rebuild signature for the party frames, computed in a SINGLE
 * pass over `info.members` with NO intermediate array allocation, so an unchanged
 * party short-circuits BEFORE `selectPartyFrameMembers` (which allocates the sorted /
 * filtered / mapped arrays) is ever called. It encodes exactly the inputs the frames
 * render from: per member the pid, group, hp/maxHp, resource, dead,
 * in-combat, the out-of-range flag (computed inline, identically to the selector),
 * level, and the aura strip (id + kind + sap flag per aura, in order), plus the
 * leader, raid flag, and the player's own group. The player is skipped (the
 * frames never show the local player), matching the selector's `pid !== playerId`.
 *
 * Pure and deterministic (only `Math.hypot` and string building). It iterates in raw
 * member order rather than the selector's sorted order; the server's party member
 * order is stable frame to frame, so a reorder only accompanies a membership change,
 * which flips the signature and rebuilds regardless. Any selector-relevant change
 * (a field, a join/leave, an out-of-range flip) changes this string, and nothing the
 * selector depends on is omitted, so an equal signature means an identical render.
 */
export function partyFrameSignature(
  info: PartyInfo,
  playerId: number,
  playerPos: { x: number; z: number },
  rangeYd = PARTY_FRAME_RANGE_YD,
  config: PartyFrameDisplayConfig = DEFAULT_PARTY_FRAME_DISPLAY,
  pets?: PartyPetMap,
): string {
  let sig = '';
  let myGroup: 1 | 2 = 1;
  for (const m of info.members) {
    if (m.pid === playerId) {
      myGroup = m.group;
      if (!config.showSelf) continue;
    }
    const oor = !m.dead && Math.hypot(m.x - playerPos.x, m.z - playerPos.z) > rangeYd;
    sig += `${m.pid}:${m.name}:${m.cls}:${m.role ?? ''}:${m.group}:${m.hp}/${m.mhp}:${m.absorb}:${m.res}/${m.mres}:${m.rtype ?? ''}:${m.dead}:${m.inCombat}:${oor ? 1 : 0}:${m.level}:`;
    // The aura strip, appended inline (no intermediate array): a joined/left aura,
    // a kind flip, or a sap-sign flip changes the string and repaints the row.
    if (m.auras) {
      for (const a of m.auras) sig += `${a.id},${a.kind},${a.neg ? 1 : 0},${a.remaining ?? ''};`;
    }
    // The pet sliver rides the SAME per-member fold. Without this the pet's health
    // could move while every wire field stayed put, the signature would not budge,
    // and updatePartyFrames would short-circuit before repainting: the sliver would
    // simply freeze at whatever value it first painted.
    //
    // The NAME is folded for the same reason and is not decorative: it is the only
    // thing the sliver's accessible label says besides the percent, and renamePet
    // can change it with every other field identical. Everything paintPet reads
    // (name, hp, maxHp, dead) has to be in here, or that read goes stale silently.
    // Pet names are validated to letters, spaces, apostrophes and hyphens, so they
    // cannot inject the delimiters this fold uses.
    const pet = config.showPets ? pets?.get(m.pid) : undefined;
    sig += `W${m.rewind ?? 0}:I${m.incomingHeal ?? 0}:A${m.hasAggro ?? 0}:C${m.connected ?? 1}`;
    sig += pet ? `:P${pet.id},${pet.name},${pet.hp}/${pet.maxHp},${pet.dead ? 1 : 0}|` : '|';
  }
  return `${sig}L${info.leader}:R${info.raid ? 1 : 0}:G${myGroup}:C${config.showSelf ? 1 : 0}${config.showResource ? 1 : 0}${config.showAbsorbs ? 1 : 0}${config.showAuras ? 1 : 0}${config.showPets ? 1 : 0}${config.healthText}${config.sort}${config.presentation}`;
}
