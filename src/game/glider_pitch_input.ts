/** Flight can look well above the horizon without crossing the camera pole.
 * Keep the ordinary ground/swim range unchanged, including on flight exit. */
export function clampGliderCameraPitch(pitch: number, flying: boolean): number {
  return Math.min(1.35, Math.max(flying ? -1.15 : -0.4, pitch));
}

/** Camera pitch is positive looking down. The default camera angle is a
 * neutral glide; only steering looks own this channel, never left orbit. */
export function gliderPitchFromCamera(
  pitch: number,
  flying: boolean,
  steering: boolean,
): number | undefined {
  if (!flying || !steering || !Number.isFinite(pitch)) return undefined;
  const neutral = 0.32;
  const deadband = 0.06;
  const delta = neutral - pitch;
  if (Math.abs(delta) <= deadband) return 0;
  // Reach full control at comfortable angles, not at the orbit stops. Looking
  // further is still useful for spotting the course but cannot add more thrust.
  const range = delta > 0 ? neutral + 0.2 : 0.9 - neutral;
  const value = Math.sign(delta) * Math.min(1, (Math.abs(delta) - deadband) / (range - deadband));
  return Math.round(value * 20) / 20;
}
