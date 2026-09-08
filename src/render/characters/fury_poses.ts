import * as THREE from 'three';

/** Local joint offsets on the native donor. The first and return strokes use
 * opposite arm commitments, with a separate cross-body finisher. Preparation
 * only: preserves all native tracks and never synthesizes a rig in a frame. */
export function poseFuryTracks(tracks: THREE.KeyframeTrack[], harvest: boolean): void {
  if (!tracks.some((t) => t.name === 'chest.quaternion')) return;
  const turns = harvest ? [0, -24, 22, 28, -24, -30, 34, 10, 0] : [0, -22, 24, 28, -30, -10, 0];
  const strikes = harvest
    ? [0, -0.7, 1, 0.6, -1, -0.7, 1.25, 0.3, 0]
    : [0, -0.7, 1, 0.6, -1.15, -0.3, 0];
  const q = new THREE.Quaternion(),
    offset = new THREE.Quaternion(),
    prior = new THREE.Quaternion();
  const euler = new THREE.Euler();
  for (const track of tracks) {
    if (track.name === 'root.position') {
      for (let i = 1; i < track.times.length; i++)
        for (let axis = 0; axis < 3; axis++) track.values[i * 3 + axis] = track.values[axis];
      continue;
    }
    if (!track.name.endsWith('.quaternion')) continue;
    const bone = track.name.slice(0, -11);
    for (let i = 0; i < track.times.length; i++) {
      const turn = turns[i] ?? 0,
        strike = strikes[i] ?? 0;
      let x = 0,
        y = 0,
        z = 0;
      if (bone === 'chest') {
        x = Math.abs(strike) * 5;
        y = turn;
      } else if (bone === 'spine') {
        x = Math.abs(strike) * 3;
        y = turn * 0.3;
      } else if (bone === 'head') {
        y = -turn * 0.5;
      } else if (bone === 'upperarmr') {
        x = -strike * 18;
        z = strike * 24;
      } else if (bone === 'upperarml') {
        x = strike * 18;
        z = strike * 24;
      } else if (bone === 'lowerarmr') {
        z = -strike * 14;
      } else if (bone === 'lowerarml') {
        z = -strike * 14;
      } else continue;
      euler.set((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180);
      q.fromArray(track.values, i * 4)
        .normalize()
        .multiply(offset.setFromEuler(euler))
        .normalize();
      if (i && prior.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      q.toArray(track.values, i * 4);
      prior.copy(q);
    }
  }
}
