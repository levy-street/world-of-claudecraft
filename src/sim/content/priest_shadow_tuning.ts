// Initial Shadow talent budgets: one extra VT pulse per five, or one fifth of
// Tithe Bomb's burst spread over its lingering ground effect.
// Existing secondary Dirge extensions share this per-application ceiling.
// Keep the budget in a dependency-free leaf so refresh timing cannot read a
// partially initialized combat module through a circular import.
export const LIVING_COVENANT_MAX_EXTENSION = 6;
export const SHADOW_LIVING_COVENANT_EXTENSION = 1;
export const SHADOW_LIVING_COVENANT_MAX_EXTENSION = 3;
export const SHADOW_SECOND_VERSE_TICKS = 5;
export const SHADOW_BOMB_RESIDUAL_FRACTION = 0.2;
export const SHADOW_BOMB_RESIDUAL_DURATION = 6;
export const SHADOW_BOMB_RESIDUAL_INTERVAL = 2;
export const SHADOW_CHOIR_DURATION = 15;
export const SHADOW_CHOIR_HEAL_FRACTION = 0.2;
