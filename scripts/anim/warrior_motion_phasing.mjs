/** Offline joint overlap. Endpoints remain exact, so contacts and planted-foot
 * solving retain their authority. The pelvis leads; the weapon catches up.
 * Contact holds stay authored in the timeline, never inferred from frame rate. */
export function warriorMotionWeight(name, key, start, end, t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (name === 'Warrior_Bladestorm_Loop' || name === 'Warrior_Bladed_Gyre')
    return end === 0.15 ? t * t : t * t * (3 - 2 * t);
  const contact = end === 0.15 || (name === 'Warrior_Storm_Bolt' && end === 0.14);
  const load = end <= (name === 'Warrior_Storm_Bolt' ? 0.095 : 0.11);
  const wrist = /hand|wrist/.test(key);
  const arm = /arm/.test(key);
  const torso = /spine|chest/.test(key);
  // Stagger initiation, not contact: every joint reaches the authored hit at
  // the same instant, after different velocity curves through the swing.
  if (contact) return t ** (wrist ? 2.75 : arm ? 2.05 : torso ? 1.45 : 1.1);
  const smooth = t * t * (3 - 2 * t);
  if (load) return smooth ** (wrist ? 1.5 : arm ? 1.2 : torso ? 0.9 : 0.75);
  // A body catches its weight before the trailing hand settles. Left and
  // right recover differently; this is repeatable choreography, not jitter.
  const drag = wrist ? (key.includes('.r') ? 1.55 : 1.28) : arm ? 1.15 : 0.8;
  return smooth ** drag;
}
