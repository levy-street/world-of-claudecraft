// Deterministic presentation plan for the Goblin Rocket Sled's continuous
// exhaust. Three/DOM-free: the mount-owned painter consumes these scalars and
// the renderer owns creation/disposal with the mount visual.

export interface GoblinRocketSledFxState {
  intensity: number;
  reverseBlend: number;
  ignitionAge: number;
  ignitionCooldown: number;
  nonForwardTime: number;
  forwardAge: number;
  fullBoreLatched: boolean;
  wasForward: boolean;
  wasAirborne: boolean;
  airborneBlend: number;
  landingAge: number;
}

export interface GoblinRocketSledFxInputs {
  dt: number;
  time: number;
  mounted: boolean;
  moving: boolean;
  backwards: boolean;
  airborne: boolean;
  speed: number;
  reducedMotion: boolean;
}

export interface GoblinRocketSledFxPlan {
  visible: boolean;
  intensity: number;
  outerLength: number;
  outerWidth: number;
  innerLength: number;
  opacity: number;
  flutter: number;
  particleStrength: number;
  smokeStrength: number;
  reverseBlend: number;
  ignition: number;
  ignitionAge: number;
  ignitionBurst: boolean;
  thrustSpool: number;
  airborneOverburn: number;
  jetHunt: number;
  takeoffBurst: boolean;
  landingBurst: boolean;
  stationaryPressure: number;
}

export const GOBLIN_ROCKET_SLED_FX_IDLE = 0.08;
export const GOBLIN_ROCKET_SLED_FX_VISIBLE_MIN = 0.12;
export const GOBLIN_ROCKET_SLED_REVERSE_INTENSITY = 0.3;
export const GOBLIN_ROCKET_SLED_DIRECTION_FADE_SEC = 0.12;
export const GOBLIN_ROCKET_SLED_FULL_BORE_SEC = 1;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Step the shared exhaust envelope. Unmount is intentionally immediate: no
 * flame mesh or emitter may survive after the owning mount visual disappears.
 */
export function stepGoblinRocketSledFx(
  state: GoblinRocketSledFxState,
  inputs: GoblinRocketSledFxInputs,
  out: GoblinRocketSledFxPlan,
): GoblinRocketSledFxPlan {
  if (!inputs.mounted) {
    state.intensity = 0;
    state.reverseBlend = 0;
    state.ignitionAge = -1;
    state.ignitionCooldown = 0;
    state.nonForwardTime = 0;
    state.forwardAge = 0;
    state.fullBoreLatched = false;
    state.wasForward = false;
    state.wasAirborne = false;
    state.airborneBlend = 0;
    state.landingAge = -1;
    out.visible = false;
    out.intensity = 0;
    out.outerLength = 0;
    out.outerWidth = 0;
    out.innerLength = 0;
    out.opacity = 0;
    out.flutter = 0;
    out.particleStrength = 0;
    out.smokeStrength = 0;
    out.reverseBlend = 0;
    out.ignition = 0;
    out.ignitionAge = -1;
    out.ignitionBurst = false;
    out.thrustSpool = 0;
    out.airborneOverburn = 0;
    out.jetHunt = 0;
    out.takeoffBurst = false;
    out.landingBurst = false;
    out.stationaryPressure = 0;
    return out;
  }

  const speed = Math.max(0, Number.isFinite(inputs.speed) ? inputs.speed : 0);
  const speedStrength = clamp01(speed / 10);
  const dt = Math.min(0.1, Math.max(0, Number.isFinite(inputs.dt) ? inputs.dt : 0));
  const forward = inputs.moving && !inputs.backwards;
  const reverse = inputs.moving && inputs.backwards;
  const airborneThrust = inputs.airborne && inputs.moving;
  const stationaryAirborne = inputs.airborne && !inputs.moving;
  const takeoffBurst = inputs.airborne && !state.wasAirborne;
  const landingBurst = !inputs.airborne && state.wasAirborne;
  const airborneTarget = airborneThrust ? 1 : 0;
  const airborneRate = airborneTarget > state.airborneBlend ? 14 : 9;
  state.airborneBlend +=
    (airborneTarget - state.airborneBlend) * (1 - Math.exp(-airborneRate * dt));
  state.airborneBlend = clamp01(state.airborneBlend);
  if (landingBurst) state.landingAge = 0;
  else if (state.landingAge >= 0) {
    state.landingAge += dt;
    if (state.landingAge > 0.22) state.landingAge = -1;
  }
  state.wasAirborne = inputs.airborne;
  const target = forward
    ? 0.58 + speedStrength * 0.42
    : reverse
      ? GOBLIN_ROCKET_SLED_REVERSE_INTENSITY
      : GOBLIN_ROCKET_SLED_FX_IDLE;
  const rate = target > state.intensity ? 9 : 5;
  state.intensity += (target - state.intensity) * (1 - Math.exp(-rate * dt));
  state.intensity = clamp01(state.intensity);

  const reverseTarget = reverse ? 1 : 0;
  const directionStep = dt / GOBLIN_ROCKET_SLED_DIRECTION_FADE_SEC;
  state.reverseBlend = clamp01(
    state.reverseBlend + Math.max(-directionStep, Math.min(directionStep, reverseTarget - state.reverseBlend)),
  );

  state.ignitionCooldown = Math.max(0, state.ignitionCooldown - dt);
  let ignitionBurst = false;
  if (forward && !state.wasForward) {
    state.forwardAge = 0;
    state.fullBoreLatched = false;
    state.ignitionAge = -1;
  } else if (forward) {
    state.forwardAge += dt;
  }
  if (
    forward &&
    !state.fullBoreLatched &&
    state.forwardAge >= GOBLIN_ROCKET_SLED_FULL_BORE_SEC &&
    state.ignitionCooldown <= 0
  ) {
    state.ignitionAge = 0;
    state.ignitionCooldown = 0.35;
    state.fullBoreLatched = true;
    ignitionBurst = true;
  } else if (state.ignitionAge >= 0) {
    state.ignitionAge += dt;
    if (state.ignitionAge > 0.45) state.ignitionAge = -1;
  }
  if (forward) state.nonForwardTime = 0;
  else {
    state.nonForwardTime = Math.min(1, state.nonForwardTime + dt);
    state.forwardAge = 0;
    state.fullBoreLatched = false;
    state.ignitionAge = -1;
  }
  state.wasForward = forward;

  const ignition = state.ignitionAge >= 0 ? Math.exp(-state.ignitionAge * 7) : 0;

  const intensity = state.intensity;
  // Keep combustion flutter at full speed throughout the turbine windup;
  // spool changes physical thrust mass, never animation playback speed.
  const spoolAge = clamp01(state.forwardAge / GOBLIN_ROCKET_SLED_FULL_BORE_SEC);
  const thrustSpool = forward
    ? spoolAge < 0.15
      ? 0.16 + (spoolAge / 0.15) * 0.08
      : spoolAge < 0.75
        ? 0.24 + ((spoolAge - 0.15) / 0.6) * 0.38
        : 0.62 + ((spoolAge - 0.75) / 0.25) * 0.38
    : reverse
      ? 1
      : 0;
  const motionScale = inputs.reducedMotion ? 0.25 : 1;
  const flutterWave =
    Math.sin(inputs.time * 18.7) * 0.65 + Math.sin(inputs.time * 31.1 + 1.9) * 0.35;
  const flutter = flutterWave * intensity * motionScale;
  const airborneOverburn = state.airborneBlend;
  const landingCompression =
    state.landingAge >= 0 ? Math.sin((state.landingAge / 0.22) * Math.PI) : 0;
  const jetHunt =
    airborneOverburn * motionScale *
    (Math.sin(inputs.time * 8.7) * 0.7 + Math.sin(inputs.time * 13.1 + 0.8) * 0.3);

  out.visible = intensity >= GOBLIN_ROCKET_SLED_FX_VISIBLE_MIN || stationaryAirborne;
  out.intensity = intensity;
  const forwardLength = 0.22 + intensity * 1.08;
  const reverseLength = 0.3 + intensity * 0.14;
  const directionLength =
    forwardLength + (reverseLength - forwardLength) * state.reverseBlend;
  const forwardMass = forward ? 0.28 + thrustSpool * 0.72 : 1;
  out.outerLength =
    directionLength * forwardMass * (1 - ignition * 0.18) *
    (1 + airborneOverburn * 0.24 - landingCompression * 0.13);
  out.outerWidth =
    (0.1 + intensity * 0.12) * (forward ? 0.55 + thrustSpool * 0.45 : 1) +
    ignition * 0.18 +
    state.reverseBlend * 0.015 +
    landingCompression * 0.075;
  out.outerWidth *= 1 - airborneOverburn * 0.09;
  out.innerLength = out.outerLength * 0.62;
  const combustionOpacity = clamp01((intensity - GOBLIN_ROCKET_SLED_FX_VISIBLE_MIN) / 0.42);
  const forwardOpacity = forward ? 0.42 + thrustSpool * 0.58 : 1;
  out.opacity =
    combustionOpacity * forwardOpacity +
    (0.78 - combustionOpacity * forwardOpacity) * state.reverseBlend;
  const pressureFlicker = stationaryAirborne
    ? 0.5 + 0.5 * Math.sin(inputs.time * 24.7 + Math.sin(inputs.time * 10.3))
    : 0;
  const stationaryPressure = stationaryAirborne ? 0.82 + pressureFlicker * 0.18 : 0;
  if (stationaryAirborne) {
    out.outerLength = 0.16 + pressureFlicker * 0.035;
    out.outerWidth = 0.105 + pressureFlicker * 0.012;
    out.innerLength = out.outerLength * 0.76;
    out.opacity = 0.72 + pressureFlicker * 0.18;
  }
  out.flutter = flutter;
  out.particleStrength = out.visible && forward ? intensity * (0.12 + thrustSpool * 0.88) : 0;
  out.smokeStrength =
    forward
      ? clamp01((intensity - 0.68) / 0.32) * clamp01((thrustSpool - 0.78) / 0.22) * 0.32
      : 0;
  out.reverseBlend = state.reverseBlend;
  out.ignition = ignition;
  out.ignitionAge = state.ignitionAge;
  out.ignitionBurst = ignitionBurst;
  out.thrustSpool = thrustSpool;
  out.airborneOverburn = airborneOverburn;
  out.jetHunt = jetHunt;
  out.takeoffBurst = takeoffBurst;
  out.landingBurst = landingBurst;
  out.stationaryPressure = stationaryPressure;
  return out;
}
