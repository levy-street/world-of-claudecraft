// The Fire and Fly weapon sockets' view core: the Shockwave (slot 0) and the
// fragmentation shell (slot 1) as ActionBarPainter slot states, each present only
// when the scenario's arsenal holds that weapon (an absent one has no socket and
// its key does nothing). Charges are the
// ones the player should see (the mirror's, less the played clicks still waiting,
// from the own-shot ledger); a socket is ready only when a click now would be
// played, so the intro, an empty weapon, the Shockwave's
// rearm and the cannon's reload all read as not ready. The Shockwave's rearm draws
// the bar's cooldown sweep; the fragmentation shell shows its armed state; the
// Shockwave pulses gold while enough strikes are due at the tower (fewer in the
// trial that brings it in). Pure: no DOM.
import { TURRET_SHOCKWAVE, TURRET_TIMING } from '../../../sim/content/turret_defense';
import type { TurretArsenal, TurretPlan } from '../../../sim/minigames/turret_defense_plan';
import { TICK_RATE } from '../../../sim/types';
import type { TurretSessionView } from '../../../world_api/vehicles';
import { formatNumber, getI18nRevision, t } from '../../i18n';
import { type ActionBarState, makeSlotState } from '../action_bar/action_bar_view';
import { turretIntroducedWeapon } from './turret_arsenal_banner_core';
import type { TurretOwnShotLedger } from './turret_own_shot_core';
import {
  type TurretWeaponKind,
  turretWaveCoreDamage,
  turretWeaponDescription,
  turretWeaponName,
} from './turret_weapon_tooltip';

/** Bar slot per weapon: key 1 slams, key 2 arms. */
export const TURRET_WEAPON_SLOTS: readonly TurretWeaponKind[] = ['shock', 'frag'];
/** Strikes due at once that make the Shockwave socket pulse. */
export const TURRET_SHOCK_NUDGE_WINDUPS = 3;
/**
 * A strike is due once a monster winds up, or walks in to land one within this many ticks:
 * the pulse comes as early before each strike as a 1.5 s windup alone gave it, whatever
 * the windup's length.
 */
export const TURRET_SHOCK_NUDGE_LEAD_TICKS = Math.round(1.5 * TICK_RATE);
/** The trial that brings in the Shockwave is where it is learned: it pulses sooner there. */
export const TURRET_SHOCK_NUDGE_WINDUPS_LEARNING = 2;

/** The scenario's arsenal holds this weapon: its socket shows and its key works. */
export function turretWeaponInArsenal(arsenal: TurretArsenal, weapon: TurretWeaponKind): boolean {
  return (weapon === 'shock' ? arsenal.shockwave : arsenal.fragmentation) > 0;
}

export function turretShockNudgeWindups(plan: Pick<TurretPlan, 'scenarioId' | 'arsenal'>): number {
  return turretIntroducedWeapon(plan) === 'shock'
    ? TURRET_SHOCK_NUDGE_WINDUPS_LEARNING
    : TURRET_SHOCK_NUDGE_WINDUPS;
}
/** The procedural icon keys (src/ui/icons.ts). */
export const TURRET_WEAPON_ICONS: Readonly<Record<TurretWeaponKind, string>> = {
  shock: 'turret_shockwave',
  frag: 'turret_frag',
};

export interface TurretWeaponBarInput {
  session: TurretSessionView;
  /** IWorld.turretClock; null reads every socket as not ready. */
  clock: number | null;
  shots: Pick<TurretOwnShotLedger, 'chargesLeft' | 'canMark'>;
  fragArmed: boolean;
  /** The keycap each socket shows, by slot. */
  keycap(slot: number): string;
}

/** Living monsters winding up, plus those whose walk ends in a strike within the lead. */
export function turretStrikesDue(session: TurretSessionView, clock: number | null): number {
  let count = 0;
  for (const m of session.defense.monsters) {
    if (!(m.hp > 0)) continue;
    if (m.state === 'windup') count++;
    else if (
      clock !== null &&
      m.state === 'march' &&
      m.seg.kind === 'march' &&
      m.seg.end + TURRET_TIMING.windupTicks - clock <= TURRET_SHOCK_NUDGE_LEAD_TICKS
    )
      count++;
  }
  return count;
}

export class TurretWeaponBarView {
  private readonly state: ActionBarState = {
    slots: TURRET_WEAPON_SLOTS.map(() => makeSlotState()),
    manySpells: false,
  };
  private readonly charges: number[] = TURRET_WEAPON_SLOTS.map(() => 0);
  private readonly present: boolean[] = TURRET_WEAPON_SLOTS.map(() => false);
  private windupSession: TurretSessionView | null = null;
  private windupClock: number | null = null;
  private windupCount = 0;
  private nudgeWindups = TURRET_SHOCK_NUDGE_WINDUPS;
  /** What each slot's text was last built from, so an unchanged frame formats nothing. */
  private readonly built = TURRET_WEAPON_SLOTS.map(() => ({
    charges: -1,
    coreDamage: -1,
    revision: -1,
    cdSeconds: -1,
  }));

  private groupText = '';
  private groupRevision = -1;

  /** The sockets' group name, resolved once per language rather than per frame. */
  groupLabel(): string {
    const revision = getI18nRevision();
    if (revision !== this.groupRevision) {
      this.groupRevision = revision;
      this.groupText = t('hudChrome.turret.weapons');
    }
    return this.groupText;
  }

  /** Per slot, the arsenal holds its weapon (as of the last tick): its socket shows. */
  get presence(): readonly boolean[] {
    return this.present;
  }

  /** The charges each slot showed on the last tick. */
  chargesAt(slot: number): number {
    return this.charges[slot] ?? 0;
  }

  tick(input: TurretWeaponBarInput): ActionBarState {
    const { session, clock, shots } = input;
    const inWave = session.defense.phase === 'wave';
    const coreDamage = turretWaveCoreDamage(session);
    const revision = getI18nRevision();
    if (session !== this.windupSession || clock !== this.windupClock) {
      if (session !== this.windupSession)
        this.nudgeWindups = turretShockNudgeWindups(session.defense.plan);
      this.windupSession = session;
      this.windupClock = clock;
      this.windupCount = turretStrikesDue(session, clock);
    }
    for (let i = 0; i < TURRET_WEAPON_SLOTS.length; i++) {
      const weapon = TURRET_WEAPON_SLOTS[i];
      const slot = this.state.slots[i];
      const built = this.built[i];
      this.present[i] = turretWeaponInArsenal(session.defense.plan.arsenal, weapon);
      const charges = shots.chargesLeft(session, clock, weapon);
      this.charges[i] = charges;
      slot.kind = 'ability';
      slot.abilityId = TURRET_WEAPON_ICONS[weapon];
      slot.iconKey = TURRET_WEAPON_ICONS[weapon];
      if (built.revision !== revision || built.charges !== charges) {
        slot.count = formatNumber(charges);
        built.charges = charges;
      }
      if (built.revision !== revision || built.coreDamage !== coreDamage) {
        slot.ariaLabel = turretWeaponName(weapon);
        slot.ariaDescription = turretWeaponDescription(weapon, coreDamage);
        built.coreDamage = coreDamage;
      }
      slot.isCharges = true;
      slot.usable = inWave && charges > 0 && shots.canMark(session, clock, weapon);
      slot.keybindLabel = input.keycap(i);
      if (weapon === 'shock') {
        const total = TURRET_SHOCKWAVE.rearmTicks / TICK_RATE;
        const remaining =
          clock === null || charges === 0
            ? 0
            : Math.max(0, session.defense.shockReadyTick - clock) / TICK_RATE;
        slot.cooldownTotal = total;
        slot.cooldownRemaining = remaining;
        slot.cooldownPercent = Math.min(100, (100 * remaining) / total);
        const cdSeconds = Math.ceil(remaining);
        if (built.revision !== revision || built.cdSeconds !== cdSeconds) {
          slot.cdText = cdSeconds > 0 ? formatNumber(cdSeconds) : '';
          built.cdSeconds = cdSeconds;
        }
        // Only a press that would be played: never while it rearms or outside a wave.
        slot.procGlow = slot.usable && this.windupCount >= this.nudgeWindups;
        slot.aiming = false;
      } else {
        slot.cooldownTotal = 0;
        slot.cooldownRemaining = 0;
        slot.cooldownPercent = 0;
        slot.cdText = '';
        slot.procGlow = false;
        slot.aiming = input.fragArmed;
      }
      built.revision = revision;
    }
    return this.state;
  }
}
