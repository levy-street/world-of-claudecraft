export const UMBRAL_ANCHOR_PLACE_SECONDS = 0.72;
export const UMBRAL_ANCHOR_RECALL_SECONDS = 0.58;

export type UmbralAnchorVfxPhase = 'hidden' | 'placing' | 'active' | 'recalling';

export interface UmbralAnchorVfxPlan {
  visible: boolean;
  opacity: number;
  scale: number;
  groundRotation: number;
  runeRotation: number;
  columnScale: number;
  columnOpacity: number;
  shardLift: number;
  wispRise: number;
  wispSpin: number;
  pulse: number;
}

export function createUmbralAnchorVfxPlan(): UmbralAnchorVfxPlan {
  return {
    visible: false,
    opacity: 0,
    scale: 1,
    groundRotation: 0,
    runeRotation: 0,
    columnScale: 1,
    columnOpacity: 0,
    shardLift: 0,
    wispRise: 0,
    wispSpin: 0,
    pulse: 0,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/**
 * Writes the complete animation plan into caller-owned storage. The painter
 * supplies both clocks so this remains deterministic and allocation-free.
 */
export function writeUmbralAnchorVfxPlan(
  out: UmbralAnchorVfxPlan,
  phase: UmbralAnchorVfxPhase,
  elapsed: number,
  absoluteTime: number,
  reducedMotion: boolean,
): UmbralAnchorVfxPlan {
  if (phase === 'hidden') {
    out.visible = false;
    out.opacity = 0;
    out.scale = 1;
    out.groundRotation = 0;
    out.runeRotation = 0;
    out.columnScale = 1;
    out.columnOpacity = 0;
    out.shardLift = 0;
    out.wispRise = 0;
    out.wispSpin = 0;
    out.pulse = 0;
    return out;
  }

  if (reducedMotion) {
    const visible = phase !== 'recalling';
    out.visible = visible;
    out.opacity = visible ? 1 : 0;
    out.scale = 1;
    out.groundRotation = 0;
    out.runeRotation = 0;
    out.columnScale = 1;
    out.columnOpacity = visible ? 0.16 : 0;
    out.shardLift = 0.55;
    out.wispRise = 0.5;
    out.wispSpin = 0;
    out.pulse = 0;
    return out;
  }

  if (phase === 'placing') {
    const progress = clamp01(elapsed / UMBRAL_ANCHOR_PLACE_SECONDS);
    const ease = 1 - (1 - progress) ** 4;
    out.visible = true;
    out.opacity = clamp01(progress / 0.28);
    out.scale = 0.18 + ease * 0.82 + Math.sin(progress * Math.PI) * 0.1;
    out.groundRotation = absoluteTime * 0.12 - (1 - progress) * 0.7;
    out.runeRotation = -absoluteTime * 0.2 + (1 - progress) * 1.4;
    out.columnScale = 0.22 + Math.sin(progress * Math.PI * 0.82) * 1.25;
    out.columnOpacity = Math.sin(progress * Math.PI) * 0.34 + progress * 0.14;
    out.shardLift = ease * 0.72;
    out.wispRise = progress;
    out.wispSpin = absoluteTime * 0.48;
    out.pulse = Math.sin(progress * Math.PI);
    return out;
  }

  if (phase === 'recalling') {
    const progress = clamp01(elapsed / UMBRAL_ANCHOR_RECALL_SECONDS);
    const collapse = progress * progress;
    out.visible = progress < 1;
    out.opacity = 1 - smoothstep(progress);
    out.scale = 1 - collapse * 0.88;
    out.groundRotation = absoluteTime * 0.12 + collapse * Math.PI * 1.5;
    out.runeRotation = -absoluteTime * 0.2 - collapse * Math.PI * 3;
    out.columnScale = 1 + progress * 2.1;
    out.columnOpacity = (1 - progress) * 0.46;
    out.shardLift = 0.55 + progress * 1.75;
    out.wispRise = progress;
    out.wispSpin = absoluteTime * 0.8 + collapse * Math.PI * 2;
    out.pulse = 1 - progress;
    return out;
  }

  const pulse = Math.sin(absoluteTime * 2.35);
  out.visible = true;
  out.opacity = 0.9 + pulse * 0.08;
  out.scale = 1 + pulse * 0.025;
  out.groundRotation = absoluteTime * 0.12;
  out.runeRotation = -absoluteTime * 0.2;
  out.columnScale = 0.92 + pulse * 0.08;
  out.columnOpacity = 0.15 + pulse * 0.035;
  out.shardLift = 0.55 + pulse * 0.08;
  out.wispRise = (((absoluteTime * 0.18) % 1) + 1) % 1;
  out.wispSpin = absoluteTime * 0.34;
  out.pulse = pulse;
  return out;
}
