// Leaf: the Wind Bridge's ids and timing (breath_bridge.ts; Jose's call of
// 2026-11-25), read by the sim and the renderer alike. Imports nothing.

/** The bridge's object (present while it stands; the look reads it). */
export const BRIDGE_OBJECT = 'sh_breath_airbridge';

/** A ride's carrier object (its state on the object: Entity.breathBridgeRide). */
export const BRIDGE_RIDE_OBJECT = 'sh_breath_airbridge_ride';

/** The bridge's fixed timing: how long its look takes to dissolve on the pull
 *  and to form again (seconds), and a ride's whole length mouth to mouth
 *  (seconds: a flowing carry, never a blink). */
export const BRIDGE_TUNING = { dissolve: 1.5, form: 1.5, rideSeconds: 2.7 } as const;

/** The ride's cue: the current takes a body (the lift and a crackle of its
 *  lightning); the landing is the isles' shared rideDown. */
export const BRIDGE_CUES = { ride: 'heart_breath_current_ride' } as const;
