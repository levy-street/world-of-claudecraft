// Pure geometry + persistence helpers for the movable target frame. No DOM, no
// Three, no sim deps: just arithmetic and (de)serialization so the clamping rules
// can be unit-tested headlessly. The DOM wiring (the move/lock button, pointer
// events, applying styles) lives in hud.ts; this module only answers "given a
// desired top-left and a viewport, what is the legal position, and how do we
// round-trip it through localStorage?". Mirrors chat_window.ts (its move-only
// sibling: the target frame has a fixed size, so there is no resize half).

// `left`/`top` are the target frame's top-left corner in viewport px.
export interface TargetFramePos {
  left: number;
  top: number;
}

// The gap kept between the frame and every viewport edge, matching the chat box's
// 8px margin so a dragged frame never touches the screen edge.
export const TARGET_FRAME_MARGIN = 8;

function clamp(v: number, lo: number, hi: number): number {
  // hi can fall below lo on a viewport too small to hold the frame; prefer the
  // lower bound (margin) so the frame stays anchored to the top-left corner.
  return Math.max(lo, Math.min(hi, v));
}

// Clamp a desired position so the whole frame (its measured `size`) stays on
// screen inside the margin. Called on every drag move and on window resize.
export function clampTargetFramePos(
  pos: TargetFramePos,
  viewport: { w: number; h: number },
  size: { w: number; h: number },
  margin: number = TARGET_FRAME_MARGIN,
): TargetFramePos {
  const maxLeft = Math.max(margin, viewport.w - size.w - margin);
  const maxTop = Math.max(margin, viewport.h - size.h - margin);
  return {
    left: clamp(pos.left, margin, maxLeft),
    top: clamp(pos.top, margin, maxTop),
  };
}

export function serializeTargetFramePos(pos: TargetFramePos): string {
  return JSON.stringify({ left: pos.left, top: pos.top });
}

// Parse persisted position, returning null for missing/corrupt data so callers
// fall back to the CSS default. Both fields must be finite numbers.
export function parseTargetFramePos(raw: string | null | undefined): TargetFramePos | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const nums = ['left', 'top'].map((k) => o[k]);
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    const [left, top] = nums as number[];
    return { left, top };
  } catch {
    return null;
  }
}
