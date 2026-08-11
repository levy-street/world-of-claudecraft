// Hidden system cooldown for the refer-a-friend Summon a Friend teleport
// (docs/prd/refer-a-friend.md). A pure leaf like unstuck_cooldown.ts so the
// bond module, the cooldown load allowlist, and the readout filter share the id
// without a runtime import cycle.

export const SUMMON_FRIEND_COOLDOWN_ID = 'system_summon_friend';
