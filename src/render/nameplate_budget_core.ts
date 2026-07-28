export const NAMEPLATE_TARGET = 1 << 0;
export const NAMEPLATE_SELF_EMOTE = 1 << 1;
export const NAMEPLATE_HOSTILE = 1 << 2;
export const NAMEPLATE_COMBAT = 1 << 3;
export const NAMEPLATE_CASTING = 1 << 4;
export const NAMEPLATE_PARTY = 1 << 5;
export const NAMEPLATE_QUEST = 1 << 6;
export const NAMEPLATE_INTERACTABLE = 1 << 7;
export const NAMEPLATE_RAID_MARKER = 1 << 8;
export const NAMEPLATE_PET = 1 << 9;
export const NAMEPLATE_LOOTABLE = 1 << 10;
export const NAMEPLATE_COMBO = 1 << 11;
export const NAMEPLATE_ACTIONABLE =
  NAMEPLATE_TARGET |
  NAMEPLATE_SELF_EMOTE |
  NAMEPLATE_HOSTILE |
  NAMEPLATE_COMBAT |
  NAMEPLATE_CASTING |
  NAMEPLATE_PARTY |
  NAMEPLATE_QUEST |
  NAMEPLATE_INTERACTABLE |
  NAMEPLATE_RAID_MARKER |
  NAMEPLATE_PET |
  NAMEPLATE_LOOTABLE |
  NAMEPLATE_COMBO;

export interface NameplateAdmissionCandidate {
  id: number;
  flags: number;
  distanceSq: number;
  inViewport: boolean;
}

export interface NameplateAdmissionScratch {
  ordinary: NameplateAdmissionCandidate[];
}

export function createNameplateAdmissionScratch(): NameplateAdmissionScratch {
  return { ordinary: [] };
}

function compareOrdinary(
  left: NameplateAdmissionCandidate,
  right: NameplateAdmissionCandidate,
): number {
  return left.distanceSq - right.distanceSq || left.id - right.id;
}

export function admitNameplates(
  candidates: readonly NameplateAdmissionCandidate[],
  maxOrdinary: number,
  admittedIds: number[],
  scratch: NameplateAdmissionScratch,
): number {
  if (!Number.isInteger(maxOrdinary) || maxOrdinary < 0) {
    throw new RangeError('maxOrdinary must be a non-negative integer');
  }
  admittedIds.length = 0;
  scratch.ordinary.length = 0;
  for (const candidate of candidates) {
    if (!candidate.inViewport) continue;
    if ((candidate.flags & NAMEPLATE_ACTIONABLE) !== 0) admittedIds.push(candidate.id);
    else scratch.ordinary.push(candidate);
  }
  scratch.ordinary.sort(compareOrdinary);
  const count = Math.min(maxOrdinary, scratch.ordinary.length);
  for (let index = 0; index < count; index++) {
    const candidate = scratch.ordinary[index];
    if (candidate) admittedIds.push(candidate.id);
  }
  return admittedIds.length;
}
