export interface SimRates {
  xp: number;
  dropMoney: number;
}

export const DEFAULT_SIM_RATES: SimRates = {
  xp: 1,
  dropMoney: 1,
};

export function normalizeRate(value: number | undefined, fallback = 1, min = fallback): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback;
}

export function normalizeSimRates(rates?: Partial<SimRates>): SimRates {
  return {
    xp: normalizeRate(rates?.xp, DEFAULT_SIM_RATES.xp),
    dropMoney: normalizeRate(rates?.dropMoney, DEFAULT_SIM_RATES.dropMoney),
  };
}

export function applyRate(amount: number, rate: number): number {
  return Math.max(0, Math.round(amount * rate));
}
