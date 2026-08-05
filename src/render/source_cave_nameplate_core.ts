// Pure nameplate rules for the Source Cave contributor mobs. Three/DOM/i18n-free
// (RENDER_PURE_CORES, tests/architecture.test.ts) so the whole decision table is
// unit-tested without a WebGL context; NameplatePainter is the thin consumer that
// turns the result into DOM writes and resolves the title text through i18n.
//
// The room has two phases and deliberately shows a different plate in each.
// Before the reboot button is pressed the contributors are friendly and cannot be
// engaged, so the plate honours the PERSON: their name over their contribution
// rung, with no combat furniture at all. Pressing the button turns every
// contributor hostile at once, and the plate switches to threat assessment: the
// level badge plus a role-tinted elite diamond. Separating the two facts in TIME
// is what keeps either legible; carrying both at once is what made a 44-plate
// room unreadable (docs/the-source-cave/encirclement-waves.md).
//
// The phase signal is the mob's own `hostile` flag, which already rides the wire
// and which beginSourceCaveEncounter flips for the entire roster at reboot. A
// wipe reset rebuilds the mobs friendly, so the plate returns to the tribute form
// with no extra bookkeeping here.

/** Combat roles that earn a tinted diamond; every other role draws none. */
const TINTED_ROLES = new Set(['runesmith', 'architect', 'worldwright']);

/** The lootable-corpse coin, kept identical to the generic mob plate. */
const LOOT_MARKER = '$';
/** The classic elite diamond. */
const ELITE_MARKER = '◆';

export interface SourceCaveNameplateInput {
  /** Hostile since the reboot; false during the friendly tribute phase. */
  hostile: boolean;
  dead: boolean;
  /** A lootable corpse takes the coin marker, exactly like any other mob. */
  lootable: boolean;
  /** In the fixed combat budget; false for an overflow guardian. */
  combatant: boolean;
  elite: boolean;
  boss: boolean;
  /** Assigned combat role, or null for an overflow guardian. */
  combatTier: string | null;
}

export type SourceCaveFrame = '' | 'elite' | 'boss';

export type SourceCaveMarkerRole = '' | 'loot' | 'runesmith' | 'architect' | 'worldwright';

export interface SourceCaveNameplateRows {
  /** Draw the contribution-rung title line under the name (friendly phase only). */
  showTitle: boolean;
  /** Draw the level badge next to the name. */
  showLevel: boolean;
  /** Marker glyph, or '' for none. */
  marker: string;
  /**
   * Who the marker belongs to, for the consumer to colour: 'loot' for the
   * corpse coin, a combat role for a tinted diamond, '' for an untinted one.
   */
  markerRole: SourceCaveMarkerRole;
  /** hp-bar frame: '' , 'elite' or 'boss'. */
  frame: SourceCaveFrame;
}

/**
 * The plate a Source Cave contributor draws right now.
 *
 * Overflow guardians stay visually plain for the whole encounter: no diamond, no
 * frame. They are not part of the clear, and waking one by splashing it is a
 * punishment the room otherwise hands out with no warning at all, so "this one is
 * not in the fight" is information the raid is allowed to have.
 */
export function sourceCaveNameplateRows(input: SourceCaveNameplateInput): SourceCaveNameplateRows {
  const corpse = input.dead;
  if (!input.hostile) {
    return {
      showTitle: !corpse,
      showLevel: false,
      marker: input.lootable ? LOOT_MARKER : '',
      markerRole: input.lootable ? 'loot' : '',
      frame: '',
    };
  }
  if (input.lootable) {
    return {
      showTitle: false,
      showLevel: !corpse,
      marker: LOOT_MARKER,
      markerRole: 'loot',
      frame: corpse ? '' : sourceCaveFrame(input),
    };
  }
  const tinted = input.combatant && !corpse && input.elite;
  const role = input.combatTier ?? '';
  return {
    showTitle: false,
    showLevel: !corpse,
    marker: tinted ? ELITE_MARKER : '',
    markerRole: tinted && TINTED_ROLES.has(role) ? (role as SourceCaveMarkerRole) : '',
    frame: corpse ? '' : sourceCaveFrame(input),
  };
}

/** Guardians never take the gold/red frame, whatever their own prestige rung says. */
function sourceCaveFrame(input: SourceCaveNameplateInput): SourceCaveFrame {
  if (!input.combatant) return '';
  return input.boss ? 'boss' : input.elite ? 'elite' : '';
}
