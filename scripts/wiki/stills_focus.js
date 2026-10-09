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
  'models/creatures/crypt_morthen_lich.glb': { bone: 'Head', radius: 0.33, lift: -0.24 },
  'models/creatures/gaol_turnkey.glb': { bone: 'Head', radius: 0.36, lift: -0.3 },
  // the Moonmantle Ray: a disc far wider than it is tall, framed on its crescent and pearl
  'models/creatures/temple_sentinel.glb': { bone: 'Head', radius: 0.26, lift: 0.12, yaw: 0.25 },
  'models/creatures/temple_ysolei.glb': {
    bone: 'Head',
    radius: 0.17,
    lift: -0.4,
    yaw: 0.8,
    rim: { color: 0xbfd8ff, intensity: 2.6, from: [-3, 4, -5] },
  },
};
