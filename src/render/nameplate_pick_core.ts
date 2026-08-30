// Pure screen-space hit testing for the health bars drawn by the shared
// nameplate canvas. The painter reuses high-water candidate objects each frame,
// then this module resolves a click without touching the DOM, Three, or world
// state. Keeping the draw dimensions here prevents the visible bar and its hit
// target from drifting apart.

export const NAMEPLATE_BASE_WIDTH = 80;
export const NAMEPLATE_BOSS_WIDTH = 100;
export const NAMEPLATE_HEALTH_HEIGHT = 4;
export const NAMEPLATE_HEALTH_PICK_PADDING_Y = 6;

const NAMEPLATE_CAST_STACK_STEP = 10;
const NAMEPLATE_HEALTH_STACK_STEP = 7;

export interface NameplatePickCandidate {
  id: number;
  sx: number;
  sy: number;
  hpVisible: boolean;
  castVisible: boolean;
  boss: boolean;
  pickable: boolean;
}

export function nameplateHealthBarWidth(boss: boolean): number {
  return boss ? NAMEPLATE_BOSS_WIDTH : NAMEPLATE_BASE_WIDTH;
}

export function nameplateHealthBarTop(anchorY: number, castVisible: boolean): number {
  return anchorY - NAMEPLATE_HEALTH_STACK_STEP - (castVisible ? NAMEPLATE_CAST_STACK_STEP : 0);
}

/**
 * Return the entity whose visible health bar owns this screen point. Later
 * candidates draw over earlier ones, so a residual overlap resolves to the
 * same plate the player sees on top. `count` excludes unused high-water slots.
 */
export function pickNameplateHealthBarAt(
  candidates: readonly NameplatePickCandidate[],
  count: number,
  clientX: number,
  clientY: number,
): number | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const last = Math.min(candidates.length, Math.max(0, Math.trunc(count))) - 1;
  for (let i = last; i >= 0; i--) {
    const candidate = candidates[i];
    if (!candidate.pickable || !candidate.hpVisible) continue;
    const halfWidth = nameplateHealthBarWidth(candidate.boss) / 2;
    if (clientX < candidate.sx - halfWidth || clientX > candidate.sx + halfWidth) continue;
    const top = nameplateHealthBarTop(candidate.sy, candidate.castVisible);
    if (
      clientY >= top - NAMEPLATE_HEALTH_PICK_PADDING_Y &&
      clientY <= top + NAMEPLATE_HEALTH_HEIGHT + NAMEPLATE_HEALTH_PICK_PADDING_Y
    ) {
      return candidate.id;
    }
  }
  return null;
}
