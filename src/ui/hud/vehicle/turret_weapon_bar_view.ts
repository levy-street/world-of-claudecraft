// The Fire and Fly weapon sockets' view core: the Shockwave (slot 0) and the
// fragmentation shell (slot 1) as ActionBarPainter slot states. Charges are the
// ones the player should see (the mirror's, less the played clicks still waiting,
// from the own-shot ledger); a socket is ready only when a click now would be
// played, so the intro, the pauses between waves, an empty weapon, the Shockwave's
// rearm and the cannon's reload all read as not ready. The Shockwave's rearm draws
// the bar's cooldown sweep; the fragmentation shell shows its armed state; the
// Shockwave pulses gold while enough monsters wind up at the tower (fewer in the
// first trial). Pure: no DOM.
import { TURRET_SCENARIO_INTRODUCTION } from '../../../sim/content/fire_and_fly_scenarios';
import { TURRET_SHOCKWAVE } from '../../../sim/content/turret_defense';
import { TICK_RATE } from '../../../sim/types';
import type { TurretSessionView } from '../../../world_api/vehicles';
import { formatNumber, getI18nRevision, t } from '../../i18n';
import { type ActionBarState, makeSlotState } from '../action_bar/action_bar_view';
import type { TurretOwnShotLedger } from './turret_own_shot_core';
import {
  type TurretWeaponKind,
  turretWaveCoreDamage,
  turretWeaponDescription,
  turretWeaponName,
} from './turret_weapon_tooltip';

/** Bar slot per weapon: key 1 slams, key 2 arms. */
export const TURRET_WEAPON_SLOTS: readonly TurretWeaponKind[] = ['shock', 'frag'];
/** Monsters winding up a strike at once that make the Shockwave socket pulse. */
export const TURRET_SHOCK_NUDGE_WINDUPS = 3;
/** The first trial's few monsters seldom reach three at once, and it is where the Shockwave is learned. */
export const TURRET_SHOCK_NUDGE_WINDUPS_FIRST_TRIAL = 2;

export function turretShockNudgeWindups(scenarioId: string): number {
  return scenarioId === TURRET_SCENARIO_INTRODUCTION.id
    ? TURRET_SHOCK_NUDGE_WINDUPS_FIRST_TRIAL
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

function windups(session: TurretSessionView): number {
  let count = 0;
  for (const m of session.defense.monsters) if (m.state === 'windup' && m.hp > 0) count++;
  return count;
}

export class TurretWeaponBarView {
  private readonly state: ActionBarState = {
    slots: TURRET_WEAPON_SLOTS.map(() => makeSlotState()),
    manySpells: false,
  };
  private readonly charges: number[] = TURRET_WEAPON_SLOTS.map(() => 0);
  private windupSession: TurretSessionView | null = null;
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

  /** The charges each slot showed on the last tick. */
  chargesAt(slot: number): number {
    return this.charges[slot] ?? 0;
  }

  tick(input: TurretWeaponBarInput): ActionBarState {
    const { session, clock, shots } = input;
    const inWave = session.defense.phase === 'wave';
    const coreDamage = turretWaveCoreDamage(session);
    const revision = getI18nRevision();
    if (session !== this.windupSession) {
      this.windupSession = session;
      this.windupCount = windups(session);
      this.nudgeWindups = turretShockNudgeWindups(session.defense.plan.scenarioId);
    }
    for (let i = 0; i < TURRET_WEAPON_SLOTS.length; i++) {
      const weapon = TURRET_WEAPON_SLOTS[i];
      const slot = this.state.slots[i];
      const built = this.built[i];
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
