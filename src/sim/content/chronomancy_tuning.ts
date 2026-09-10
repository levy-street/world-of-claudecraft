// Shared authored windows for Chronomancy's individual and group Echo effects.
// Every ability rank imports these values so a balance pass cannot leave an
// earlier rank on a stale duration.

export const TEMPORAL_ECHO_DURATION_SECONDS = 22.5;
export const TEMPORAL_CASCADE_ECHO_DURATION_SECONDS = 15;
export const TEMPORAL_CASCADE_CAST_SECONDS = 1.5;
export const TEMPORAL_ECHO_SINGLE_CONVERSION = 0.4;
export const TEMPORAL_ECHO_AREA_CONVERSION = 0.15;
export const TEMPORAL_ECHO_ROTATION_CONVERSION_MULTIPLIER = 4;

// Temporal Cascade's initial heal answers the emergency it is cast into: an ally
// at full health takes the authored roll, and a nearly dead one takes up to this
// much more on top of it. Cast as preparation on a healthy group the ability is
// unchanged; only the reactive case scales. See combat/chronomancy_echo_distribution.
export const TEMPORAL_CASCADE_RELIEF_MAX_BONUS = 3;

// Discipline-style overheal-to-shield conversion (Temporal Aegis): excess healing
// from Echo conversion generates an absorb shield capped at 20% of max health,
// refreshed on each application for 15 seconds.
export const TEMPORAL_AEGIS_CAP_MAX_HP_FRACTION = 0.2;
export const TEMPORAL_AEGIS_DURATION_SECONDS = 15;

// Perfect Moment: 20% increased Aether Darts damage for the 10s window.
export const PERFECT_MOMENT_DARTS_DAMAGE_MULT = 1.2;
