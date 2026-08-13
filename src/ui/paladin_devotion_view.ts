import type { Entity } from '../sim/types';

export interface PaladinDevotionState {
  visible: boolean;
  value: number;
  fillFrac: number;
  ready: boolean;
  ascended: boolean;
  charges: number;
  lastCharge: boolean;
  label: string;
  ariaValueText: string;
  announcement: string;
}

export interface PaladinDevotionView {
  tick(player: Pick<Entity, 'templateId' | 'paladinDevotion'>): PaladinDevotionState;
}

export function createPaladinDevotionView(
  formatCount: (value: number) => string,
  formatStatus: (value: string, max: string, charges: string, lastCharge: boolean) => string,
  finalChargeAnnouncement: string,
): PaladinDevotionView {
  const maxLabel = formatCount(20);
  const state: PaladinDevotionState = {
    visible: false,
    value: 0,
    fillFrac: 0,
    ready: false,
    ascended: false,
    charges: 0,
    lastCharge: false,
    label: '',
    ariaValueText: '',
    announcement: '',
  };

  return {
    tick(player): PaladinDevotionState {
      const devotion = player.paladinDevotion;
      state.visible = player.templateId === 'paladin' && devotion !== undefined;
      state.value = devotion?.value ?? 0;
      state.fillFrac = Math.max(0, Math.min(1, state.value / 20));
      state.ascended =
        (devotion?.ascensionCharges ?? 0) > 0 && (devotion?.ascensionRemaining ?? 0) > 0;
      state.ready = state.value >= 20 && !state.ascended;
      state.charges = state.ascended
        ? Math.max(0, Math.min(5, devotion?.ascensionCharges ?? 0))
        : 0;
      state.lastCharge = state.ascended && state.charges === 1;
      const valueLabel = formatCount(state.value);
      const chargesLabel = formatCount(state.charges);
      state.label = `${valueLabel} / ${maxLabel}`;
      state.ariaValueText = formatStatus(valueLabel, maxLabel, chargesLabel, state.lastCharge);
      state.announcement = state.lastCharge ? finalChargeAnnouncement : '';
      return state;
    },
  };
}
