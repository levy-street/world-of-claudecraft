// Battleground (Thornhollow Fields) segmentation: the same observe-only shape
// as arena, but the match object carries an explicit winner, so no inference
// is needed. The arena wire frame is reused deliberately (format, team average
// ratings, and the practice flag carrying unrated/dev-ended), so the service's
// flat arena columns and filters work for battlegrounds with zero schema
// change; capture objectives ride as 'mech' lines.
import type { FightParticipant } from './contract';
import { OpenFight, type PendingClose } from './fights';
import type { BgMatchView, SegmenterHost } from './types';

const BG_FORMAT = 'thornhollow_5v5';

export class BattlegroundSegmenter {
  private readonly tracked = new Map<number, OpenFight>();
  private readonly lastScores = new Map<number, [number, number]>();

  observe(host: SegmenterHost, tick: number, opened: OpenFight[], closing: PendingClose[]): void {
    if (!host.surfaceEnabled('battleground')) return;
    const seen = new Set<number>();
    for (const match of host.sim.bgMatches.values()) {
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      const fight = this.tracked.get(match.id);
      if (fight === undefined && match.state === 'active') {
        const openedFight = this.open(host, tick, match);
        if (openedFight !== null) opened.push(openedFight);
      } else if (fight !== undefined) {
        this.noteCaptures(tick, match, fight);
        if (match.state === 'ended') {
          closing.push({
            fight,
            outcome: match.winner === 0 ? 'win_a' : match.winner === 1 ? 'win_b' : 'draw',
          });
          this.tracked.delete(match.id);
          this.lastScores.delete(match.id);
        }
      }
    }
    for (const [id, fight] of this.tracked) {
      if (!seen.has(id)) {
        closing.push({ fight, outcome: 'abandon' });
        this.tracked.delete(id);
        this.lastScores.delete(id);
      }
    }
  }

  private open(host: SegmenterHost, tick: number, match: BgMatchView): OpenFight | null {
    const participants: FightParticipant[] = [];
    for (const [teamIndex, pids] of match.teams.entries()) {
      for (const pid of pids) {
        const p = host.resolveParticipant(pid);
        if (p !== null) participants.push({ ...p, team: teamIndex === 0 ? 'a' : 'b' });
      }
    }
    if (participants.length === 0) return null;
    const fight = new OpenFight(
      {
        fightId: host.nextFightId(),
        surface: 'battleground',
        key: BG_FORMAT,
        difficulty: null,
        segment: 'match',
        groupType: 'team',
        startedTick: tick,
        arena: {
          format: BG_FORMAT,
          ratingA: Math.round(match.ratingAvg[0]),
          ratingB: Math.round(match.ratingAvg[1]),
          practice: !match.rated || match.devEnded,
        },
        participants,
      },
      host.sink,
      host.counters,
    );
    this.tracked.set(match.id, fight);
    this.lastScores.set(match.id, [match.scores[0], match.scores[1]]);
    return fight;
  }

  /** Emit an objective record whenever a team's capture score moves. */
  private noteCaptures(tick: number, match: BgMatchView, fight: OpenFight): void {
    const prev = this.lastScores.get(match.id);
    if (prev === undefined) return;
    if (match.scores[0] > prev[0]) fight.recordObjective(tick, `capture_a:${match.scores[0]}`);
    if (match.scores[1] > prev[1]) fight.recordObjective(tick, `capture_b:${match.scores[1]}`);
    if (match.scores[0] !== prev[0] || match.scores[1] !== prev[1]) {
      this.lastScores.set(match.id, [match.scores[0], match.scores[1]]);
    }
  }
}
