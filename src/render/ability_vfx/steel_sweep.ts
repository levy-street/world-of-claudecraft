export interface SteelSweepRange {
  readonly from: number;
  readonly to: number;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A fast leading edge and a broad trailing wake over an immediately visible
 * full-size footprint. Age is normalized to the retained effect lifetime. */
export function steelSweepGain(u: number, age: number): number {
  const head = Math.max(0, Math.min(1, age / 0.62)) * 1.24 - 0.12;
  const lead = 1 - smooth(0.035, 0.19, Math.abs(u - head));
  const wake = smooth(head - 0.65, head - 0.12, u) * (1 - smooth(head - 0.05, head + 0.08, u));
  return 0.22 + 1.15 * lead + 0.55 * wake;
}

// Same normalized envelope for the prepared sculpture. No extra GPU inputs,
// textures, geometry updates or render passes are needed.
export const STEEL_SWEEP_GLSL = `
float steelSweepGain(float u,float age){
  float head=clamp(age/0.62,0.0,1.0)*1.24-0.12;
  float lead=1.0-smoothstep(0.035,0.19,abs(u-head));
  float wake=smoothstep(head-0.65,head-0.12,u)*(1.0-smoothstep(head-0.05,head+0.08,u));
  return 0.22+1.15*lead+0.55*wake;
}`;
