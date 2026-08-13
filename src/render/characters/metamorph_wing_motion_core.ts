export interface MetamorphWingPose {
  unfold: number;
  breath: number;
  sweepBack: number;
  open: number;
}

export function createMetamorphWingPose(): MetamorphWingPose {
  return {
    unfold: 0,
    breath: 0,
    sweepBack: 0,
    open: 0,
  };
}

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export function metamorphWingPoseInto(
  elapsed: number,
  moving: boolean,
  running: boolean,
  airborne: boolean,
  casting: boolean,
  attacking: boolean,
  out: MetamorphWingPose,
  reducedMotion = false,
): MetamorphWingPose {
  out.unfold = reducedMotion ? 1 : smoothstep(elapsed / 0.5);
  out.breath = reducedMotion ? 0 : Math.sin(elapsed * 1.45) * 0.028;
  out.sweepBack = airborne ? 0.04 : running ? 0.18 : moving ? 0.08 : 0;
  out.open = airborne ? 0.25 : casting ? 0.17 : attacking ? 0.12 : 0.02;
  return out;
}
