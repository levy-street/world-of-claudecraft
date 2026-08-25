import {
  DODGE_ENDURANCE_COST,
  DODGE_ENDURANCE_MAX,
  DODGE_ENDURANCE_REGEN_PER_SECOND,
  playerEndurance,
} from '../sim/player_dodge';
import type { Entity } from '../sim/types';
import type { PainterHostWriters } from './painter_host';

const DODGE_CHARGES_MAX = DODGE_ENDURANCE_MAX / DODGE_ENDURANCE_COST;

export interface DodgeEnduranceView {
  value: number;
  firstFraction: number;
  secondFraction: number;
  readyCharges: number;
  nextChargeSeconds: number;
}

export function dodgeEnduranceView(rawEndurance: number): DodgeEnduranceView {
  const value = Math.min(DODGE_ENDURANCE_MAX, Math.max(0, rawEndurance));
  const readyCharges = Math.min(DODGE_CHARGES_MAX, Math.floor(value / DODGE_ENDURANCE_COST));
  const chargeProgress = value - readyCharges * DODGE_ENDURANCE_COST;
  return {
    value,
    firstFraction: Math.min(1, value / DODGE_ENDURANCE_COST),
    secondFraction: Math.min(1, Math.max(0, value - DODGE_ENDURANCE_COST) / DODGE_ENDURANCE_COST),
    readyCharges,
    nextChargeSeconds:
      readyCharges >= DODGE_CHARGES_MAX
        ? 0
        : (DODGE_ENDURANCE_COST - chargeProgress) / DODGE_ENDURANCE_REGEN_PER_SECOND,
  };
}

export class DodgeEndurancePainter {
  private lastReadyCharges: number | null = null;
  private recoveryPhase: 'none' | 'a' | 'b' = 'none';

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly root: HTMLElement,
    private readonly first: HTMLElement,
    private readonly second: HTMLElement,
  ) {}

  paint(player: Entity): void {
    const view = dodgeEnduranceView(playerEndurance(player));
    if (this.lastReadyCharges !== null && view.readyCharges > this.lastReadyCharges) {
      this.recoveryPhase = this.recoveryPhase === 'a' ? 'b' : 'a';
    }
    this.lastReadyCharges = view.readyCharges;

    this.writers.setTransform(this.first, `scaleX(${view.firstFraction})`);
    this.writers.setTransform(this.second, `scaleX(${view.secondFraction})`);
    this.writers.setAttr(this.root, 'aria-valuenow', view.value.toFixed(1));
    this.writers.setAttr(
      this.root,
      'aria-valuetext',
      `${Math.round(view.value)} / ${DODGE_ENDURANCE_MAX}`,
    );
    this.writers.setAttr(this.root, 'data-charges', String(view.readyCharges));
    this.writers.toggleClass(this.root, 'recovered-a', this.recoveryPhase === 'a');
    this.writers.toggleClass(this.root, 'recovered-b', this.recoveryPhase === 'b');
  }
}
