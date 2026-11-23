/**
 * Player-through-grass interaction core: tracks smoothed player movement,
 * a trailing wake segment behind the player's footsteps, and spring-back
 * rustle energy so nearby grass blades and tufts part, bow along the path,
 * and rustle as they rebound.
 *
 * Pure core (no Three, no DOM, no i18n, deterministic on injected inputs).
 */

/** Base foot-parting radius (yards) when the player stands at rest. */
export const GRASS_INTERACT_BASE_RADIUS = 1.1;

/** Expanded parting and wake radius (yards) when the player runs at full speed. */
export const GRASS_INTERACT_MOVE_RADIUS = 1.65;

/** Reference run speed (yards/sec) at which normalized interaction speed reaches 1. */
export const GRASS_INTERACT_REF_SPEED = 7.2;

/** Maximum trailing wake length (yards) behind the player's current position. */
export const GRASS_INTERACT_MAX_WAKE_LEN = 2.4;

/** Single-frame jump distance (yards) treated as a teleport or spawn snap. */
export const GRASS_INTERACT_TELEPORT_DIST = 8.0;

/** Plain 4-component vector compatible with WebGLUniforms setValueV4f. */
export interface GrassVec4Uniform {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface GrassInteractionState {
  px: number;
  pz: number;
  wakeX: number;
  wakeZ: number;
  dirX: number;
  dirZ: number;
  speedNorm: number;
  rustleEnergy: number;
  wakeStrength: number;
  wakeRadius: number;
  lastTimeSec: number;
  readonly uGrassMove: { value: GrassVec4Uniform };
  readonly uGrassWake: { value: GrassVec4Uniform };
}

export interface GrassInteractionDisplacement {
  dx: number;
  dy: number;
  dz: number;
  push: number;
}

export function createGrassInteractionState(
  initialPx = 1e9,
  initialPz = 1e9,
): GrassInteractionState {
  return {
    px: initialPx,
    pz: initialPz,
    wakeX: initialPx,
    wakeZ: initialPz,
    dirX: 0,
    dirZ: 1,
    speedNorm: 0,
    rustleEnergy: 0,
    wakeStrength: 0,
    wakeRadius: GRASS_INTERACT_BASE_RADIUS,
    lastTimeSec: Number.NaN,
    uGrassMove: {
      value: { x: 0, y: 1, z: 0, w: 0 },
    },
    uGrassWake: {
      value: { x: initialPx, y: initialPz, z: 0, w: GRASS_INTERACT_BASE_RADIUS },
    },
  };
}

function syncInteractionUniforms(state: GrassInteractionState): void {
  const move = state.uGrassMove.value;
  move.x = state.dirX;
  move.y = state.dirZ;
  move.z = state.speedNorm;
  move.w = state.rustleEnergy;

  const wake = state.uGrassWake.value;
  wake.x = state.wakeX;
  wake.y = state.wakeZ;
  wake.z = state.wakeStrength;
  wake.w = state.wakeRadius;
}

/**
 * Advance the player-through-grass interaction state for the current frame.
 * Idempotent when called multiple times at the same timestamp and coordinates.
 */
export function stepGrassInteraction(
  state: GrassInteractionState,
  px: number,
  pz: number,
  timeSec: number,
): void {
  if (!Number.isFinite(px) || !Number.isFinite(pz) || !Number.isFinite(timeSec)) return;
  if (!Number.isFinite(state.lastTimeSec)) {
    state.px = px;
    state.pz = pz;
    state.wakeX = px;
    state.wakeZ = pz;
    state.speedNorm = 0;
    state.rustleEnergy = 0;
    state.wakeStrength = 0;
    state.wakeRadius = GRASS_INTERACT_BASE_RADIUS;
    state.lastTimeSec = timeSec;
    syncInteractionUniforms(state);
    return;
  }

  const rawDt = timeSec - state.lastTimeSec;
  const dx = px - state.px;
  const dz = pz - state.pz;
  if (rawDt === 0 && dx === 0 && dz === 0) return;

  const dt = rawDt > 0 && rawDt <= 0.25 ? rawDt : 1 / 60;
  const dist = Math.hypot(dx, dz);

  if (dist > GRASS_INTERACT_TELEPORT_DIST || rawDt < 0) {
    state.px = px;
    state.pz = pz;
    state.wakeX = px;
    state.wakeZ = pz;
    state.speedNorm = 0;
    state.rustleEnergy = 0;
    state.wakeStrength = 0;
    state.wakeRadius = GRASS_INTERACT_BASE_RADIUS;
    state.lastTimeSec = timeSec;
    syncInteractionUniforms(state);
    return;
  }

  const instSpeed = dist / dt;
  const targetSpeed = Math.min(1, instSpeed / GRASS_INTERACT_REF_SPEED);
  const speedRate = targetSpeed > state.speedNorm ? 14 : 6;
  state.speedNorm += (targetSpeed - state.speedNorm) * Math.min(1, dt * speedRate);
  if (state.speedNorm < 1e-4) state.speedNorm = 0;

  if (dist > 1e-4) {
    const invDist = 1 / dist;
    const ndx = dx * invDist;
    const ndz = dz * invDist;
    const dirBlend = Math.min(1, dt * 16);
    const bx = state.dirX + (ndx - state.dirX) * dirBlend;
    const bz = state.dirZ + (ndz - state.dirZ) * dirBlend;
    const bLen = Math.hypot(bx, bz);
    if (bLen > 1e-5) {
      state.dirX = bx / bLen;
      state.dirZ = bz / bLen;
    }
  }

  const rustleRate = targetSpeed > state.rustleEnergy ? 16 : 2.6;
  state.rustleEnergy += (targetSpeed - state.rustleEnergy) * Math.min(1, dt * rustleRate);
  if (state.rustleEnergy < 1e-4) state.rustleEnergy = 0;

  const wakeFollow = Math.min(1, dt * 3.8);
  state.wakeX += (px - state.wakeX) * wakeFollow;
  state.wakeZ += (pz - state.wakeZ) * wakeFollow;
  const wdx = px - state.wakeX;
  const wdz = pz - state.wakeZ;
  const wakeDist = Math.hypot(wdx, wdz);
  if (wakeDist > GRASS_INTERACT_MAX_WAKE_LEN) {
    const scale = GRASS_INTERACT_MAX_WAKE_LEN / wakeDist;
    state.wakeX = px - wdx * scale;
    state.wakeZ = pz - wdz * scale;
  }
  const clampedWakeDist = Math.min(wakeDist, GRASS_INTERACT_MAX_WAKE_LEN);
  state.wakeStrength = Math.min(1, (clampedWakeDist / 0.85) * 0.65 + state.rustleEnergy * 0.55);
  if (state.wakeStrength < 1e-4) state.wakeStrength = 0;

  state.wakeRadius =
    GRASS_INTERACT_BASE_RADIUS +
    (GRASS_INTERACT_MOVE_RADIUS - GRASS_INTERACT_BASE_RADIUS) * state.speedNorm;
  state.px = px;
  state.pz = pz;
  state.lastTimeSec = timeSec;
  syncInteractionUniforms(state);
}

function glslSmoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic CPU twin of the vertex displacement for a blade at world XZ
 * and local vertex height `localY`. Used by unit tests to verify radial parting,
 * velocity sweep, wake persistence, and root-locked vertical depression.
 */
export function evaluateGrassInteractionAt(
  state: GrassInteractionState,
  bladeX: number,
  bladeZ: number,
  localY: number,
  timeSec = state.lastTimeSec,
  out: GrassInteractionDisplacement = { dx: 0, dy: 0, dz: 0, push: 0 },
): GrassInteractionDisplacement {
  out.dx = 0;
  out.dy = 0;
  out.dz = 0;
  out.push = 0;
  if (localY <= 0) return out;

  const toBladeX = bladeX - state.px;
  const toBladeZ = bladeZ - state.pz;
  const distSq = toBladeX * toBladeX + toBladeZ * toBladeZ;
  if (distSq >= 18.0) return out;

  const dist = Math.sqrt(distSq);
  const radius = Math.max(state.wakeRadius, 0.8);
  let body = 1 - glslSmoothstep(0, radius, dist);
  body *= body;
  const radX = dist > 0.001 ? toBladeX / dist : state.dirX;
  const radZ = dist > 0.001 ? toBladeZ / dist : state.dirZ;

  const segX = state.px - state.wakeX;
  const segZ = state.pz - state.wakeZ;
  const segSq = segX * segX + segZ * segZ;
  const segT =
    segSq > 0.0001
      ? Math.max(
          0,
          Math.min(1, ((bladeX - state.wakeX) * segX + (bladeZ - state.wakeZ) * segZ) / segSq),
        )
      : 1;
  const wakePtX = state.wakeX + segX * segT;
  const wakePtZ = state.wakeZ + segZ * segT;
  const wakeVecX = bladeX - wakePtX;
  const wakeVecZ = bladeZ - wakePtZ;
  const wakeDist = Math.hypot(wakeVecX, wakeVecZ);
  const wakeR = radius * (0.58 + (0.96 - 0.58) * segT);
  let wake = (1 - glslSmoothstep(0, wakeR, wakeDist)) * (0.35 + 0.65 * segT) * state.wakeStrength;
  wake *= wake;
  const wakeDirX = wakeDist > 0.001 ? wakeVecX / wakeDist : radX;
  const wakeDirZ = wakeDist > 0.001 ? wakeVecZ / wakeDist : radZ;

  const push = Math.max(body * (0.42 + 0.58 * state.speedNorm), wake * 0.88);
  if (push <= 0.001) return out;

  const moveWeight = 0.48 * state.speedNorm * Math.max(body, wake);
  const rawDirX = radX * (body + 0.001) + wakeDirX * (wake * 0.85) + state.dirX * moveWeight;
  const rawDirZ = radZ * (body + 0.001) + wakeDirZ * (wake * 0.85) + state.dirZ * moveWeight;
  const rawLen = Math.hypot(rawDirX, rawDirZ);
  if (rawLen <= 1e-6) return out;
  const worldDirX = rawDirX / rawLen;
  const worldDirZ = rawDirZ / rawLen;

  const t = Number.isFinite(timeSec) ? timeSec : 0;
  const phase = bladeX * 3.1 + bladeZ * 2.7;
  const rustle = Math.sin(t * 11.0 + phase) * 0.14 * state.rustleEnergy * push;
  const perpX = -worldDirZ;
  const perpZ = worldDirX;
  const totalWorldX = worldDirX * (push * 0.56) + perpX * rustle;
  const totalWorldZ = worldDirZ * (push * 0.56) + perpZ * rustle;
  const bendMag = Math.hypot(totalWorldX, totalWorldZ);
  if (bendMag <= 0.0001) return out;

  const weight = localY * localY;
  out.dx = totalWorldX * weight;
  out.dz = totalWorldZ * weight;
  out.dy = -bendMag * 0.36 * weight;
  out.push = push;
  return out;
}

/** Shared grass interaction state updated per frame and bound by all grass layers. */
export const sharedGrassInteraction: GrassInteractionState = createGrassInteractionState();

export function stepSharedGrassInteraction(px: number, pz: number, timeSec: number): void {
  stepGrassInteraction(sharedGrassInteraction, px, pz, timeSec);
}

export function attachGrassInteractionUniforms(
  uniforms: Record<string, { value: unknown }>,
  state: GrassInteractionState = sharedGrassInteraction,
): void {
  uniforms.uGrassMove = state.uGrassMove;
  uniforms.uGrassWake = state.uGrassWake;
}

/** GLSL uniform declarations for player-through-grass interaction. */
export function grassInteractionUniformDeclGlsl(): string {
  return `
        uniform vec4 uGrassMove;
        uniform vec4 uGrassWake;`;
}

/**
 * GLSL vertex displacement for 3D blade clusters (blade_grass.ts and
 * blade_grass_band.ts). Requires `bgOrigin`, `bgFade`, `uPlayerPos`, `uTime`,
 * `instanceMatrix`, `position`, and `transformed` in scope.
 */
export function grassBladeInteractionGlsl(): string {
  return `
          if (bgFade > 0.0) {
            vec2 giToBlade = bgOrigin.xz - uPlayerPos;
            float giDistSq = dot(giToBlade, giToBlade);
            if (giDistSq < 18.0) {
              float giDist = sqrt(giDistSq);
              float giRadius = max(uGrassWake.w, 0.8);
              float giBody = 1.0 - smoothstep(0.0, giRadius, giDist);
              giBody *= giBody;
              vec2 giRadDir = giDist > 0.001 ? giToBlade / giDist : uGrassMove.xy;
              vec2 giSeg = uPlayerPos - uGrassWake.xy;
              float giSegSq = dot(giSeg, giSeg);
              float giSegT = giSegSq > 0.0001
                ? clamp(dot(bgOrigin.xz - uGrassWake.xy, giSeg) / giSegSq, 0.0, 1.0)
                : 1.0;
              vec2 giWakeVec = bgOrigin.xz - mix(uGrassWake.xy, uPlayerPos, giSegT);
              float giWakeDist = length(giWakeVec);
              float giWakeR = giRadius * mix(0.58, 0.96, giSegT);
              float giWake = (1.0 - smoothstep(0.0, giWakeR, giWakeDist))
                * (0.35 + 0.65 * giSegT) * uGrassWake.z;
              giWake *= giWake;
              vec2 giWakeDir = giWakeDist > 0.001 ? giWakeVec / giWakeDist : giRadDir;
              float giPush = max(giBody * (0.42 + 0.58 * uGrassMove.z), giWake * 0.88);
              if (giPush > 0.001) {
                vec2 giWorldDir = normalize(
                  giRadDir * (giBody + 0.001)
                  + giWakeDir * (giWake * 0.85)
                  + uGrassMove.xy * (0.48 * uGrassMove.z * max(giBody, giWake))
                );
                float giPhase = bgOrigin.x * 3.1 + bgOrigin.z * 2.7 + position.x * 4.0;
                float giRustle = sin(uTime * 11.0 + giPhase) * 0.14 * uGrassMove.w * giPush;
                vec2 giPerp = vec2(-giWorldDir.y, giWorldDir.x);
                vec2 giTotalWorld = giWorldDir * (giPush * 0.56) + giPerp * giRustle;
                float giBendMag = length(giTotalWorld);
                if (giBendMag > 0.0001) {
                  float giWeight = position.y * position.y;
                  vec3 giLocalDir = normalize(vec3(giTotalWorld.x, 0.0, giTotalWorld.y) * mat3(instanceMatrix));
                  transformed += giLocalDir * (giBendMag * giWeight);
                  transformed.y -= giBendMag * 0.36 * giWeight;
                }
              }
            }
          }`;
}

/**
 * GLSL vertex displacement for crossed grass-tuft cards (foliage.ts).
 * Requires `tuftBase`, `uPlayerPos`, `uTime`, `instanceMatrix`, and
 * `transformed` in scope.
 */
export function grassTuftInteractionGlsl(): string {
  return `
        #ifdef USE_INSTANCING
          vec2 giToTuft = tuftBase - uPlayerPos;
          float giTuftDistSq = dot(giToTuft, giToTuft);
          if (giTuftDistSq < 18.0) {
            float giTuftDist = sqrt(giTuftDistSq);
            float giTuftR = max(uGrassWake.w, 0.8);
            float giTuftBody = 1.0 - smoothstep(0.0, giTuftR, giTuftDist);
            giTuftBody *= giTuftBody;
            vec2 giTuftRad = giTuftDist > 0.001 ? giToTuft / giTuftDist : uGrassMove.xy;
            vec2 giTuftSeg = uPlayerPos - uGrassWake.xy;
            float giTuftSegSq = dot(giTuftSeg, giTuftSeg);
            float giTuftSegT = giTuftSegSq > 0.0001
              ? clamp(dot(tuftBase - uGrassWake.xy, giTuftSeg) / giTuftSegSq, 0.0, 1.0)
              : 1.0;
            vec2 giTuftWakeVec = tuftBase - mix(uGrassWake.xy, uPlayerPos, giTuftSegT);
            float giTuftWakeDist = length(giTuftWakeVec);
            float giTuftWake = (1.0 - smoothstep(0.0, giTuftR * mix(0.58, 0.96, giTuftSegT), giTuftWakeDist))
              * (0.35 + 0.65 * giTuftSegT) * uGrassWake.z;
            giTuftWake *= giTuftWake;
            vec2 giTuftWakeDir = giTuftWakeDist > 0.001 ? giTuftWakeVec / giTuftWakeDist : giTuftRad;
            float giTuftPush = max(giTuftBody * (0.42 + 0.58 * uGrassMove.z), giTuftWake * 0.88);
            if (giTuftPush > 0.001) {
              vec2 giTuftWorldDir = normalize(
                giTuftRad * (giTuftBody + 0.001)
                + giTuftWakeDir * (giTuftWake * 0.85)
                + uGrassMove.xy * (0.48 * uGrassMove.z * max(giTuftBody, giTuftWake))
              );
              float giTuftRustle = sin(uTime * 11.0 + tuftBase.x * 2.9 + tuftBase.y * 2.3)
                * 0.12 * uGrassMove.w * giTuftPush;
              vec2 giTuftTotal = giTuftWorldDir * (giTuftPush * 0.48)
                + vec2(-giTuftWorldDir.y, giTuftWorldDir.x) * giTuftRustle;
              float giTuftMag = length(giTuftTotal);
              if (giTuftMag > 0.0001) {
                float giTuftW = smoothstep(0.0, 0.7, transformed.y);
                vec3 giTuftLocal = normalize(vec3(giTuftTotal.x, 0.0, giTuftTotal.y) * mat3(instanceMatrix));
                transformed += giTuftLocal * (giTuftMag * giTuftW);
                transformed.y -= giTuftMag * 0.28 * giTuftW;
              }
            }
          }
        #endif`;
}
