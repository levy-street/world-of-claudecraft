// Sentence is instant in the sim. These timings are cosmetic only: a very
// short invocation contracts at the caster, the pooled curse ribbon travels
// at the same speed used by the painter, and the target gets a readable seal
// before the damage event's visual payoff.
export const SENTENCE_BUILDUP_SECONDS = 0.16;
export const SENTENCE_TRANSFER_SPEED = 58;
export const SENTENCE_TRANSFER_MIN_SECONDS = 0.08;
export const SENTENCE_TRANSFER_MAX_SECONDS = 0.52;
export const SENTENCE_MARK_SECONDS = 0.24;
export const SENTENCE_BURST_SECONDS = 1.7;
export const SENTENCE_CATACLYSM_SECONDS = 2.35;

export interface SentenceInvocationPlan {
  visible: boolean;
  buildup: number;
  release: number;
  coreOpacity: number;
  coreScale: number;
  sealOpacity: number;
  sealScale: number;
  wispOpacity: number;
  wispRadius: number;
  rotation: number;
}

export interface SentenceBurstPlan {
  visible: boolean;
  progress: number;
  duration: number;
  maximum: boolean;
  powerScale: number;
  opacity: number;
  vortexScale: number;
  eyeScale: number;
  irisScale: number;
  rotation: number;
  flashOpacity: number;
  waveOpacity: number;
  waveScale: number;
  secondaryWaveScale: number;
  pillarOpacity: number;
  pillarScale: number;
  crownOpacity: number;
  crownScale: number;
  sparkOpacity: number;
  sparkDistance: number;
  cataclysmCoreOpacity: number;
  cataclysmCoreScale: number;
  detonationFlashOpacity: number;
  detonationFlashScale: number;
  cataclysmOpacity: number;
  cataclysmScale: number;
  starburstOpacity: number;
  starburstScale: number;
  ruptureOpacity: number;
  ruptureScale: number;
  verticalHaloOpacity: number;
  verticalHaloScale: number;
  residueOpacity: number;
  residueScale: number;
  soulOpacity: number;
  soulRise: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

export function sentenceTransferSeconds(distance: number): number {
  const travel = Math.max(0, Number.isFinite(distance) ? distance : 0) / SENTENCE_TRANSFER_SPEED;
  return Math.max(SENTENCE_TRANSFER_MIN_SECONDS, Math.min(SENTENCE_TRANSFER_MAX_SECONDS, travel));
}

export function createSentenceInvocationPlan(): SentenceInvocationPlan {
  return {
    visible: false,
    buildup: 0,
    release: 0,
    coreOpacity: 0,
    coreScale: 0,
    sealOpacity: 0,
    sealScale: 0,
    wispOpacity: 0,
    wispRadius: 0,
    rotation: 0,
  };
}

export function writeSentenceInvocationPlan(
  out: SentenceInvocationPlan,
  elapsed: number,
  travelSeconds: number,
  reducedMotion: boolean,
): SentenceInvocationPlan {
  const safeElapsed = Math.max(0, elapsed);
  const buildup = clamp01(safeElapsed / SENTENCE_BUILDUP_SECONDS);
  const release = clamp01((safeElapsed - SENTENCE_BUILDUP_SECONDS) / Math.max(0.01, travelSeconds));
  const contraction = smoothstep(buildup);
  const releaseFade = 1 - smoothstep(release / 0.48);
  const visible = safeElapsed < SENTENCE_BUILDUP_SECONDS + Math.max(0, travelSeconds) * 0.58;

  out.visible = visible;
  out.buildup = buildup;
  out.release = release;
  out.coreOpacity = visible ? smoothstep(buildup / 0.22) * releaseFade : 0;
  out.sealOpacity = visible ? smoothstep(buildup / 0.34) * releaseFade : 0;
  out.wispOpacity = visible ? smoothstep(buildup / 0.18) * releaseFade : 0;
  out.coreScale = reducedMotion ? 0.34 : 0.78 - contraction * 0.54;
  out.sealScale = reducedMotion ? 0.82 : 0.48 + contraction * 0.64 - release * 0.3;
  out.wispRadius = reducedMotion ? 0.72 : 1.28 - contraction * 0.92;
  out.rotation = reducedMotion ? 0 : buildup * Math.PI * 1.4 + release * Math.PI * 0.35;
  return out;
}

export function createSentenceBurstPlan(): SentenceBurstPlan {
  return {
    visible: false,
    progress: 0,
    duration: SENTENCE_BURST_SECONDS,
    maximum: false,
    powerScale: 0.76,
    opacity: 0,
    vortexScale: 0,
    eyeScale: 0,
    irisScale: 0,
    rotation: 0,
    flashOpacity: 0,
    waveOpacity: 0,
    waveScale: 0,
    secondaryWaveScale: 0,
    pillarOpacity: 0,
    pillarScale: 0,
    crownOpacity: 0,
    crownScale: 0,
    sparkOpacity: 0,
    sparkDistance: 0,
    cataclysmCoreOpacity: 0,
    cataclysmCoreScale: 0,
    detonationFlashOpacity: 0,
    detonationFlashScale: 0,
    cataclysmOpacity: 0,
    cataclysmScale: 0,
    starburstOpacity: 0,
    starburstScale: 0,
    ruptureOpacity: 0,
    ruptureScale: 0,
    verticalHaloOpacity: 0,
    verticalHaloScale: 0,
    residueOpacity: 0,
    residueScale: 0,
    soulOpacity: 0,
    soulRise: 0,
  };
}

export function writeSentenceBurstPlan(
  out: SentenceBurstPlan,
  elapsed: number,
  condemnation: number,
  reducedMotion: boolean,
): SentenceBurstPlan {
  const maximum = condemnation >= 100;
  const duration = maximum ? SENTENCE_CATACLYSM_SECONDS : SENTENCE_BURST_SECONDS;
  const progress = clamp01(elapsed / SENTENCE_BURST_SECONDS);
  const doomProgress = clamp01((condemnation - 20) / 80);
  const powerScale = 0.76 + doomProgress * 0.24;
  const markProgress = clamp01(elapsed / SENTENCE_MARK_SECONDS);
  const enter = smoothstep(markProgress / 0.62);
  const leave = 1 - smoothstep((progress - 0.36) / 0.34);
  const opacity = enter * leave;
  const detonate = maximum ? smoothstep((elapsed - SENTENCE_MARK_SECONDS) / 0.1) : 0;
  const blastTravel = maximum ? smoothstep((elapsed - SENTENCE_MARK_SECONDS) / 0.32) : 0;
  const payoff = smoothstep((elapsed - SENTENCE_MARK_SECONDS) / 0.08);
  const aftermath = clamp01(
    (elapsed - SENTENCE_MARK_SECONDS) /
      Math.max(0.01, SENTENCE_BURST_SECONDS - SENTENCE_MARK_SECONDS),
  );

  out.visible = elapsed >= 0 && elapsed < duration;
  out.progress = clamp01(elapsed / duration);
  out.duration = duration;
  out.maximum = maximum;
  out.powerScale = powerScale;
  out.opacity = opacity;
  out.flashOpacity =
    enter * (1 - smoothstep(Math.max(0, (progress - 0.02) / 0.24))) * (0.78 + doomProgress * 0.22);
  out.waveOpacity = enter * (1 - smoothstep(Math.max(0, (progress - 0.12) / 0.7)));
  out.pillarOpacity =
    enter * (1 - smoothstep(Math.max(0, (progress - 0.45) / 0.4))) * (0.72 + doomProgress * 0.28);
  out.crownOpacity =
    enter * (1 - smoothstep(Math.max(0, (progress - 0.4) / 0.5))) * (0.76 + doomProgress * 0.24);
  out.sparkOpacity = enter * leave;
  out.cataclysmCoreOpacity =
    detonate * (1 - smoothstep((elapsed - 0.5) / 0.4)) * (maximum ? 0.9 : 0);
  out.detonationFlashOpacity =
    detonate * (1 - smoothstep((elapsed - 0.34) / 0.36)) * (maximum ? 0.9 : 0);
  out.cataclysmOpacity =
    detonate * (1 - smoothstep((elapsed - 0.58) / 0.44)) * (maximum ? 0.95 : 0);
  out.starburstOpacity = detonate * (1 - smoothstep((elapsed - 0.5) / 0.36)) * (maximum ? 0.92 : 0);
  out.ruptureOpacity = detonate * (1 - smoothstep((elapsed - 0.56) / 0.52)) * (maximum ? 0.88 : 0);
  out.verticalHaloOpacity =
    detonate * (1 - smoothstep((elapsed - 0.5) / 0.48)) * (maximum ? 0.9 : 0);
  out.residueOpacity =
    payoff * (1 - smoothstep((aftermath - 0.28) / 0.72)) * (0.52 + doomProgress * 0.28);
  out.soulOpacity =
    payoff * (1 - smoothstep((aftermath - 0.42) / 0.58)) * (0.6 + doomProgress * 0.34);
  out.residueScale = reducedMotion
    ? 2.15 * powerScale
    : (0.72 + smoothstep(aftermath / 0.48) * 2.2) * powerScale;
  out.soulRise = reducedMotion ? 1.4 * powerScale : (0.25 + aftermath * 4.2) * powerScale;

  if (reducedMotion) {
    out.vortexScale = 0.55 * powerScale;
    out.eyeScale = 1.5 * powerScale;
    out.irisScale = 1.2 * powerScale;
    out.rotation = 0;
    out.waveScale = 4 * powerScale;
    out.secondaryWaveScale = 5.2 * powerScale;
    out.pillarScale = 1.25 * powerScale;
    out.crownScale = 1.4 * powerScale;
    out.sparkDistance = 2.4 * powerScale;
    out.cataclysmCoreScale = maximum ? 2.4 : 0;
    out.detonationFlashScale = maximum ? 4.5 : 0;
    out.cataclysmScale = maximum ? 5.2 : 0;
    out.starburstScale = maximum ? 6.2 : 0;
    out.ruptureScale = maximum ? 11 : 0;
    out.verticalHaloScale = maximum ? 5.2 : 0;
  } else {
    out.vortexScale = (1.25 - enter * 0.82 + progress * 0.15) * powerScale;
    out.eyeScale = (0.42 + enter * 1.05 + Math.sin(progress * Math.PI) * 0.26) * powerScale;
    out.irisScale = (0.52 + enter * 0.72 + Math.sin(progress * Math.PI) * 0.38) * powerScale;
    out.rotation = progress * Math.PI * 1.65;
    const maximumExpansion = 1 + blastTravel * 0.75;
    out.waveScale = (0.55 + progress * 5.8) * powerScale * maximumExpansion;
    out.secondaryWaveScale = (0.85 + progress * 7) * powerScale * maximumExpansion;
    out.pillarScale =
      (0.6 + enter * 0.5 + Math.sin(progress * Math.PI) * 0.5) *
      powerScale *
      (1 + blastTravel * 0.7);
    out.crownScale = (0.6 + enter * 0.5 + progress * 1.5) * powerScale;
    out.sparkDistance = (0.25 + progress * 5) * powerScale * (1 + blastTravel * 0.9);
    out.cataclysmCoreScale = maximum ? 0.45 + blastTravel * 3.2 : 0;
    out.detonationFlashScale = maximum ? 1.2 + blastTravel * 5.5 : 0;
    out.cataclysmScale = maximum ? 0.9 + blastTravel * 4.6 : 0;
    out.starburstScale = maximum ? 1 + blastTravel * 5.4 : 0;
    out.ruptureScale = maximum ? 1.2 + blastTravel * 7 : 0;
    out.verticalHaloScale = maximum ? 1 + blastTravel * 4.5 : 0;
  }

  if (!out.visible) {
    out.opacity = 0;
    out.flashOpacity = 0;
    out.waveOpacity = 0;
    out.pillarOpacity = 0;
    out.crownOpacity = 0;
    out.sparkOpacity = 0;
    out.cataclysmCoreOpacity = 0;
    out.detonationFlashOpacity = 0;
    out.cataclysmOpacity = 0;
    out.starburstOpacity = 0;
    out.ruptureOpacity = 0;
    out.verticalHaloOpacity = 0;
    out.residueOpacity = 0;
    out.soulOpacity = 0;
  }
  return out;
}

export interface SentenceImpactPlan {
  light: number;
  duration: number;
  shake: number;
  fovPunch: number;
}

// Impact feedback for the Sentence hit: heavier Condemnation spends land with a
// brighter, longer shadow pulse, and the local caster additionally feels a
// screen shake and FOV punch (nobody else's camera moves). Thresholds follow
// the Condemnation spend breakpoints; a maximum (100) spend is the only tier
// with the heavy shake.
export function sentenceImpactPlan(condemnation: number, localCaster: boolean): SentenceImpactPlan {
  const tier =
    condemnation >= 100
      ? { light: 11.5, duration: 0.72 }
      : condemnation >= 80
        ? { light: 10.5, duration: 0.68 }
        : condemnation >= 50
          ? { light: 9, duration: 0.6 }
          : { light: 7.5, duration: 0.52 };
  return {
    light: tier.light,
    duration: tier.duration,
    shake: localCaster ? (condemnation >= 100 ? 0.9 : 0.48) : 0,
    fovPunch: localCaster ? (condemnation >= 100 ? 4 : 1.6) : 0,
  };
}
