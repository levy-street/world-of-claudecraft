import { seasonalFlicker } from './seasonal_glow_core';

/** The same discoverable state at every graphics tier and in daylight.
 * Keep the rind dark: the lit face and cavity carry the candle, not a solid
 * orange silhouette. Reduced motion retains the entire readable lit state. */
export function hauntedPumpkinGlow(
  materialName: string,
  found: boolean,
  time = 0,
  reducedMotion = false,
): number {
  if (!found) return 0;
  const flicker = reducedMotion ? 1 : seasonalFlicker(time, 0);
  switch (materialName) {
    case 'GourdGlow':
      return 1.4 * flicker;
    case 'GourdInner':
      return flicker;
    case 'GourdFlesh':
      return 0.7 * flicker;
    case 'GourdLitSkin':
      return 0.04 * flicker;
    default:
      return 0;
  }
}
