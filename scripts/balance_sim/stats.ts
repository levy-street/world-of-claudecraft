// Pure statistics for the Monte Carlo combat balance simulator. No sim imports:
// a Vitest exercises these directly (tests/balance_sim_stats.test.ts).

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sq = 0;
  for (const v of values) sq += (v - m) * (v - m);
  return Math.sqrt(sq / (values.length - 1));
}

// Wilson score interval for a binomial proportion. The lower bound is the
// conservative "at least this good" estimate we rank broken specs by: it only
// clears a threshold once the sample size backs the observed rate up.
export interface WilsonInterval {
  low: number;
  high: number;
}

export function wilsonInterval(successes: number, trials: number, z = 1.96): WilsonInterval {
  if (trials === 0) return { low: 0, high: 1 };
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return {
    low: Math.max(0, (centre - margin) / denom),
    high: Math.min(1, (centre + margin) / denom),
  };
}

// Z-score of each value against the population of all values. The "how far off
// the field is this spec" number used by the outlier verdicts.
export function zScores(values: number[]): number[] {
  const m = mean(values);
  const sd = stddev(values);
  if (sd === 0) return values.map(() => 0);
  return values.map((v) => (v - m) / sd);
}

// One PvP standing row per spec, aggregated from bout outcomes. Draws count as
// half a win so a stalemate spec ranks between winning and losing outright.
export interface PvpStanding {
  key: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  wilson: WilsonInterval;
  zScore: number;
}

export interface PvpOutcome {
  aKey: string;
  bKey: string;
  // 'a' | 'b' | 'draw'
  winner: 'a' | 'b' | 'draw';
}

export function aggregatePvp(outcomes: PvpOutcome[]): PvpStanding[] {
  const rows = new Map<string, { games: number; wins: number; losses: number; draws: number }>();
  const row = (key: string) => {
    let r = rows.get(key);
    if (!r) {
      r = { games: 0, wins: 0, losses: 0, draws: 0 };
      rows.set(key, r);
    }
    return r;
  };
  for (const o of outcomes) {
    const a = row(o.aKey);
    const b = row(o.bKey);
    a.games++;
    b.games++;
    if (o.winner === 'draw') {
      a.draws++;
      b.draws++;
    } else if (o.winner === 'a') {
      a.wins++;
      b.losses++;
    } else {
      b.wins++;
      a.losses++;
    }
  }
  const keys = [...rows.keys()].sort();
  const standings = keys.map((key) => {
    const r = rows.get(key)!;
    const effective = r.wins + r.draws / 2;
    return {
      key,
      games: r.games,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      winRate: r.games > 0 ? effective / r.games : 0,
      wilson: wilsonInterval(effective, r.games),
      zScore: 0,
    };
  });
  const zs = zScores(standings.map((s) => s.winRate));
  for (let i = 0; i < standings.length; i++) standings[i].zScore = zs[i];
  return standings.sort((x, y) => y.winRate - x.winRate || x.key.localeCompare(y.key));
}

// Head-to-head matchup matrix: winRate of the row spec against the column spec.
export function matchupMatrix(outcomes: PvpOutcome[]): Record<string, Record<string, number>> {
  const games = new Map<string, { n: number; w: number }>();
  const bump = (rowKey: string, colKey: string, win: number) => {
    const k = `${rowKey}|${colKey}`;
    const cur = games.get(k) ?? { n: 0, w: 0 };
    cur.n++;
    cur.w += win;
    games.set(k, cur);
  };
  for (const o of outcomes) {
    const aWin = o.winner === 'a' ? 1 : o.winner === 'draw' ? 0.5 : 0;
    bump(o.aKey, o.bKey, aWin);
    bump(o.bKey, o.aKey, 1 - aWin);
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [k, v] of games) {
    const [rowKey, colKey] = k.split('|');
    out[rowKey] ??= {};
    out[rowKey][colKey] = v.w / v.n;
  }
  return out;
}

// Composite "broken score": PvP dominance plus PvE speed, each as a z-score so
// the two dimensions weigh equally regardless of unit. PvE kill time counts
// negatively (faster is stronger). Specs missing a dimension use only the other.
export interface BrokenRanking {
  key: string;
  brokenScore: number;
  pvpZ: number | null;
  pveZ: number | null;
  verdict: 'overpowered' | 'strong' | 'balanced' | 'weak' | 'underpowered';
}

export function rankBrokenness(
  pvp: { key: string; zScore: number }[],
  pveKillTimeZ: { key: string; zScore: number }[],
): BrokenRanking[] {
  const pvpBy = new Map(pvp.map((r) => [r.key, r.zScore]));
  const pveBy = new Map(pveKillTimeZ.map((r) => [r.key, r.zScore]));
  const keys = [...new Set([...pvpBy.keys(), ...pveBy.keys()])].sort();
  const rows = keys.map((key) => {
    const pvpZ = pvpBy.has(key) ? pvpBy.get(key)! : null;
    const rawPveZ = pveBy.has(key) ? pveBy.get(key)! : null;
    const pveZ = rawPveZ === null ? null : -rawPveZ;
    const parts = [pvpZ, pveZ].filter((v): v is number => v !== null);
    const brokenScore = parts.length === 0 ? 0 : mean(parts);
    return { key, brokenScore, pvpZ, pveZ, verdict: verdictFor(brokenScore) };
  });
  return rows.sort((a, b) => b.brokenScore - a.brokenScore || a.key.localeCompare(b.key));
}

function verdictFor(score: number): BrokenRanking['verdict'] {
  if (score >= 1.5) return 'overpowered';
  if (score >= 0.75) return 'strong';
  if (score <= -1.5) return 'underpowered';
  if (score <= -0.75) return 'weak';
  return 'balanced';
}
