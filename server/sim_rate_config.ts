import {
  DEFAULT_SIM_RATES,
  normalizeRate,
  type SimRates,
} from '../src/sim/rates';

function envRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  return normalizeRate(Number(raw), fallback);
}

export function simRatesFromEnv(env: NodeJS.ProcessEnv = process.env): SimRates {
  return {
    xp: envRate(env.RATE_XP, DEFAULT_SIM_RATES.xp),
    dropMoney: envRate(env.RATE_DROP_MONEY, DEFAULT_SIM_RATES.dropMoney),
  };
}
