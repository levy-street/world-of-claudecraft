// Head-focused framing for the few rigs whose whole-body still makes a poor
// portrait: a boss far taller than it is wide (a lich under a mitre and his staff,
// a sea serpent coiled to the sky, a gaoler three players tall whose face is a
// small part of his bulk) shrinks to a speck in the 128px mob portrait.
// Keyed by the model URL the render spec carries. `bone` is the node the camera
// aims at (posed), `radius` the framed radius as a fraction of the posed bounding
// sphere, `lift` moves the aim up by that fraction of the framed radius (negative sets
// the head high in the frame, where the mob portrait's top crop keeps it), `yaw` turns the model further toward the camera, and `rim` adds a
// coloured back light for that model only.
// Any model not listed renders exactly as before.
export const STILL_FOCUS = {
  'models/creatures/woc_crypt_morthen.glb': { bone: 'head', radius: 0.26, lift: -0.5, yaw: 0.6 },
  'models/creatures/woc_bastion_turnkey.glb': { bone: 'head', radius: 0.36, lift: -0.3 },
  // the Sledge Tusker: the soul lantern's post tops its bounds, so the top crop held only the
  // hump; framed on its brow with the tusks curling below it, turned three-quarter
  'models/creatures/woc_sanctum_tusker.glb': { bone: 'head', radius: 0.55, lift: -0.3, yaw: 1.1 },
  // the Moonmantle Ray: a disc far wider than it is tall, framed on its crescent and pearl
  'models/creatures/temple_sentinel.glb': { bone: 'Head', radius: 0.26, lift: 0.12, yaw: 0.25 },
  'models/creatures/woc_temple_ysolei.glb': {
    bone: 'head',
    radius: 0.2,
    lift: 0.15,
    yaw: 0.8,
    rim: { color: 0xbfd8ff, intensity: 2.6, from: [-3, 4, -5] },
  },
};
