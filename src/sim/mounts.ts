export const BASIC_MOUNT_ID = 'brown_horse';
export const BASIC_MOUNT_SPEED_MULT = 1.6;

export interface MountDef {
  id: string;
  name: string;
  speedMult: number;
  minLevel: number;
}

export interface PlayerMountState {
  known: string[];
  activeId: string | null;
}

export const MOUNTS: Record<string, MountDef> = {
  [BASIC_MOUNT_ID]: {
    id: BASIC_MOUNT_ID,
    name: 'Brown Horse',
    speedMult: BASIC_MOUNT_SPEED_MULT,
    minLevel: 20,
  },
};

export function emptyMountState(): PlayerMountState {
  return { known: [], activeId: null };
}

export function cloneMountState(state: PlayerMountState): PlayerMountState {
  return { known: [...state.known], activeId: state.activeId };
}

export function normalizeMountState(value: PlayerMountState | undefined): PlayerMountState {
  if (!value) return emptyMountState();
  const known = normalizeKnownMounts(value.known);
  const activeId =
    typeof value.activeId === 'string' && known.includes(value.activeId) ? value.activeId : null;
  return { known, activeId };
}

export function learnMount(state: PlayerMountState, mountId: string): boolean {
  if (!MOUNTS[mountId] || state.known.includes(mountId)) return false;
  state.known.push(mountId);
  state.known.sort();
  return true;
}

export function activateMount(state: PlayerMountState, mountId: string): boolean {
  if (!state.known.includes(mountId)) return false;
  state.activeId = mountId;
  return true;
}

export function clearActiveMount(state: PlayerMountState): boolean {
  if (!state.activeId) return false;
  state.activeId = null;
  return true;
}

export function activeMountSpeedMult(state: PlayerMountState): number {
  return state.activeId ? (MOUNTS[state.activeId]?.speedMult ?? 1) : 1;
}

function normalizeKnownMounts(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === 'string' && !!MOUNTS[id]))].sort();
}
