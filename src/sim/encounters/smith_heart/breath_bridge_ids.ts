// Leaf: the Wind Bridge's ids and timing (breath_bridge.ts; Jose's call of
// 2026-11-25), read by the sim and the renderer alike. Imports nothing.

/** The bridge's object (present while it stands; the look reads it). */
export const BRIDGE_OBJECT = 'sh_breath_airbridge';

/** The bridge's fixed timing: how long it takes to dissolve on the pull and
 *  to form again (seconds, the look's; the sim carries bodies off for the
 *  first), and the carry's pace (yards a second, a gentle slide). */
export const BRIDGE_TUNING = { dissolve: 1.5, form: 1.5, carryPace: 7 } as const;
