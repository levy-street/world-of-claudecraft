// Fire and Fly's own shots: the one ledger behind the instant local fire feedback.
// The seat HUD marks every click it sends. One the server will surely take is
// PLAYED: the render (the head's recoil, the muzzle, the own shell) and the fire
// sound play it at once. One the server may take is HELD: it plays from its entry,
// and its cooldown holds the next played click. One the server surely refuses is
// FREE and holds nothing. "Surely" reads the band of click-to-`fired` leads the
// ledger measured: the mirror's clock trails the server's by a trip, so a click
// reaches the server between the band's low and high ends after its clock.
// Each `fired` entry is then resolved ONCE, in fired order, against the marks it
// may be: the mark it confirms, or none, and every reader asking about that entry
// gets the same answer, so nothing plays twice (an entry confirming a mark not
// played plays as usual). A mark no `fired` entry confirms in time was refused.
// The server stays authoritative: nothing here decides a shot.
//
// Every tick is IWorld.turretClock's (the last server tick the client has seen), so
// the window and the lead measure server time as the client sees it; offline the
// entry lands on the click's own tick. Pure: no DOM, no wall clock.
import { TURRET_WEAPON } from '../../../sim/content/turret_defense';
import type { TurretAim, TurretEvent } from '../../../sim/minigames/turret_defense';
import type { TurretFeedback } from '../../../sim/minigames/turret_feedback';
import type { TurretSessionView } from '../../../world_api/vehicles';

/** Played shots waiting for their `fired` entry at once: a single shooter, a cooldown apart. */
export const TURRET_OWN_SHOT_PENDING_MAX = 2;
/** Marks kept, the newest ones: every click sent, so each entry finds its own. */
export const TURRET_OWN_SHOT_RECORDS = 32;
/** The click-to-`fired` lead assumed before one was measured (ticks). */
export const TURRET_OWN_SHOT_LEAD_TICKS = 2;
/** The confirm window: twice the measured lead plus this slack, within the bounds (ticks). */
const WINDOW_SLACK = 4;
const WINDOW_MIN = 8;
const WINDOW_MAX = 40;
/** Lead samples the band is read from, the newest ones: enough to hold a jittery trip's tails. */
const BAND_SAMPLES = 16;
/** Samples the band needs before a click plays ahead of the mirror's own ready tick. */
const BAND_TRUSTED = 8;
/** Ticks the band reaches past its fastest and slowest samples. */
const BAND_MARGIN = 1;
/**
 * The band's high end before it is trusted (ticks, a 600 ms round trip): wide, so a
 * click an unlearned band cannot place is held rather than played. Clicks all at one
 * point never teach it (see resolve).
 */
const BAND_PRIOR_HIGH = 12;
/** How much of each new lead sample the smoothed lead takes. */
const LEAD_GAIN = 0.3;
/** The server clamps the same point with the same function: an entry this close is the mark's. */
const MATCH_YD = 0.05;
/** Resolved `fired` entries remembered for the readers that ask later. */
const VERDICTS = 8;

export type TurretOwnShotStatus = 'pending' | 'confirmed' | 'refused';

/**
 * What a click was when sent: `played`, the server will surely take it and its
 * report plays on the click; `held`, the server may take it, so it plays from its
 * entry and its cooldown holds the next played click; `free`, the server surely
 * refuses it, and it holds nothing.
 */
export type TurretOwnShotPlay = 'played' | 'held' | 'free';

const PLAY_RANK: Readonly<Record<TurretOwnShotPlay, number>> = { played: 0, held: 1, free: 2 };

export interface TurretOwnShot {
  /** 0 for an unused record; otherwise unique for the page, growing. */
  serial: number;
  /** The seat it was fired in. */
  startTick: number;
  /** IWorld.turretClock on the click. */
  clock: number;
  fromX: number;
  fromZ: number;
  /** The clamped aim point sent to the server. */
  x: number;
  z: number;
  range: number;
  status: TurretOwnShotStatus;
  play: TurretOwnShotPlay;
}

type TurretFired = Extract<TurretEvent, { type: 'fired' }>;

function newRecord(): TurretOwnShot {
  return {
    serial: 0,
    startTick: 0,
    clock: 0,
    fromX: 0,
    fromZ: 0,
    x: 0,
    z: 0,
    range: 0,
    status: 'refused',
    play: 'free',
  };
}

/** How likely a click at an entry's point is its own, lower first: waiting, then played, held, free. */
function rank(shot: TurretOwnShot): number {
  return (shot.status === 'pending' ? 0 : 3) + PLAY_RANK[shot.play];
}

function ended(session: TurretSessionView): boolean {
  const phase = session.defense.phase;
  return phase === 'won' || phase === 'lost';
}

export class TurretOwnShotLedger {
  private readonly records: TurretOwnShot[] = Array.from(
    { length: TURRET_OWN_SHOT_RECORDS },
    newRecord,
  );
  private readonly verdictSeq = new Float64Array(VERDICTS);
  private readonly verdictSerial = new Float64Array(VERDICTS);
  private nextVerdict = 0;
  private serial = 0;
  /** The newest mark an entry confirmed: the server took every older click before it, or refused it. */
  private confirmedSerial = 0;
  private startTick = Number.NaN;
  private seenSeq = 0;
  private seen: TurretSessionView | null = null;
  private lead = TURRET_OWN_SHOT_LEAD_TICKS;
  private readonly samples = new Float64Array(BAND_SAMPLES);
  private sampled = 0;
  private bandLow = 0;
  private bandHigh = BAND_PRIOR_HIGH;
  /** The sample count the band was last read at. */
  private bandRead = 0;
  /** What the waiting marks say of the server's cooldown, from waitingInto. */
  private readyLate = 0;
  private readyEarly = 0;
  private playedWaiting = 0;

  /** The smoothed click-to-`fired` lead in ticks (0 offline, about one round trip online). */
  get leadTicks(): number {
    return this.lead;
  }

  /** The newest serial marked on this page (0 before the first). */
  get newestSerial(): number {
    return this.serial;
  }

  /** The fewest ticks after its clock a click reaches the server: 0 until the band is trusted. */
  get leadLow(): number {
    this.readBand();
    return this.bandLow;
  }

  /** The most ticks after its clock a click may reach the server. */
  get leadHigh(): number {
    this.readBand();
    return this.bandHigh;
  }

  /** Ticks a played mark waits for its `fired` entry before it counts as refused. */
  get confirmWindow(): number {
    return Math.min(WINDOW_MAX, Math.max(WINDOW_MIN, Math.ceil(2 * this.lead) + WINDOW_SLACK));
  }

  /** A click now would be played: the reticle is bright. */
  canMark(session: TurretSessionView | null, clock: number | null): boolean {
    if (!session || clock === null || ended(session)) return false;
    return this.classify(session, clock) === 'played';
  }

  /**
   * What a click sent now is. Played: seated, the defense running, fewer than two
   * played clicks waiting, and the click reaches the server, even on the band's
   * fastest trip, once its cooldown is over, even if every click still waiting
   * arrived on the slowest. Held: it may reach a ready server. Free otherwise.
   */
  classify(session: TurretSessionView, clock: number): TurretOwnShotPlay {
    this.update(session, clock);
    if (ended(session)) return 'free';
    this.waitingInto(session);
    if (
      this.playedWaiting < TURRET_OWN_SHOT_PENDING_MAX &&
      clock + this.leadLow >= this.readyLate
    ) {
      return 'played';
    }
    return clock + this.leadHigh >= this.readyEarly ? 'held' : 'free';
  }

  /** Clicks of its own still waiting keep a click now from being played. */
  holding(session: TurretSessionView, clock: number): boolean {
    this.update(session, clock);
    this.waitingInto(null);
    return (
      this.playedWaiting >= TURRET_OWN_SHOT_PENDING_MAX || clock + this.leadLow < this.readyLate
    );
  }

  /**
   * Records a click sent at `aim` (clamped), as `play` (classify, asked before
   * this mark, by default). Returns its serial.
   */
  mark(
    session: TurretSessionView,
    clock: number,
    aim: Readonly<TurretAim>,
    play: TurretOwnShotPlay = this.classify(session, clock),
  ): number {
    this.update(session, clock);
    const shot = this.freeRecord();
    shot.serial = ++this.serial;
    shot.startTick = session.defense.startTick;
    shot.clock = clock;
    shot.fromX = session.defense.cx;
    shot.fromZ = session.defense.cz;
    shot.x = aim.x;
    shot.z = aim.z;
    shot.range = aim.range;
    shot.status = 'pending';
    shot.play = play;
    return shot.serial;
  }

  /** The oldest played mark of this seat after `serial` (0 for the first), for a reader to play. */
  launchAfter(session: TurretSessionView, serial: number): Readonly<TurretOwnShot> | null {
    this.observe(session);
    let next: TurretOwnShot | null = null;
    for (const shot of this.records) {
      if (shot.play !== 'played' || shot.serial <= serial || shot.startTick !== this.startTick) {
        continue;
      }
      if (!next || shot.serial < next.serial) next = shot;
    }
    return next;
  }

  /**
   * The played shot a `fired` entry of this session confirms: its serial when the
   * entry came in time (its shell flies on as this one), minus its serial when it
   * came after its window (a fresh shell, its report already played), else 0 (play it).
   */
  ownShotOf(session: TurretSessionView, entry: TurretFeedback): number {
    this.observe(session);
    for (let i = 0; i < VERDICTS; i++) {
      if (this.verdictSeq[i] === entry.seq) return this.verdictSerial[i];
    }
    return 0;
  }

  /** Where a mark stands; null once its record was reused or its seat ended. */
  status(serial: number): TurretOwnShotStatus | null {
    for (const shot of this.records) if (shot.serial === serial) return shot.status;
    return null;
  }

  /**
   * Reads the session's new `fired` entries, then refuses the marks that waited too
   * long: a played one past the confirm window, any other past the band, when its
   * entry would already show.
   */
  update(session: TurretSessionView, clock: number | null): void {
    this.observe(session);
    if (clock === null) return;
    const window = this.confirmWindow;
    const high = Math.ceil(this.leadHigh);
    for (const shot of this.records) {
      if (shot.serial === 0 || shot.status !== 'pending') continue;
      if (clock - shot.clock > (shot.play === 'played' ? window : high)) shot.status = 'refused';
    }
  }

  /**
   * The server's cooldown as the waiting marks leave it: ready by `readyLate` even
   * if every played or held one fired on the slowest trip, and not before
   * `readyEarly` since every played one fires, on the fastest. From the mirror's
   * ready tick when a session is given.
   */
  private waitingInto(session: TurretSessionView | null): void {
    const low = this.leadLow;
    const high = this.leadHigh;
    const cooldown = TURRET_WEAPON.cooldownTicks;
    const ready = session ? session.defense.readyTick : Number.NEGATIVE_INFINITY;
    let late = ready;
    let early = ready;
    let played = 0;
    for (const shot of this.records) {
      if (shot.serial === 0 || shot.status !== 'pending' || shot.play === 'free') continue;
      late = Math.max(late, shot.clock + high + cooldown);
      if (shot.play === 'played') {
        played++;
        early = Math.max(early, shot.clock + low + cooldown);
      }
    }
    this.readyLate = late;
    this.readyEarly = early;
    this.playedWaiting = played;
  }

  /**
   * The band from the newest samples, reaching a margin past them: the next trip
   * may beat them all. A lead of 0 is a host that fires inside the click (offline),
   * which never varies: no margin, trusted at once. Untrusted, the band reads 0
   * below and twice its slowest sample above (at least the prior): too wide only
   * holds more clicks, too narrow plays one the server refuses.
   */
  private readBand(): void {
    if (this.bandRead === this.sampled) return;
    this.bandRead = this.sampled;
    const n = Math.min(this.sampled, BAND_SAMPLES);
    let low = Number.POSITIVE_INFINITY;
    let high = 0;
    for (let i = 0; i < n; i++) {
      low = Math.min(low, this.samples[i]);
      high = Math.max(high, this.samples[i]);
    }
    if (n === 0 || (this.sampled < BAND_TRUSTED && high > 0)) {
      this.bandLow = 0;
      this.bandHigh = Math.max(BAND_PRIOR_HIGH, 2 * high + BAND_MARGIN);
      return;
    }
    const margin = high > 0 ? BAND_MARGIN : 0;
    this.bandLow = Math.max(0, low - margin);
    this.bandHigh = high + margin;
  }

  private observe(session: TurretSessionView): void {
    if (session === this.seen) return;
    this.seen = session;
    const ring = session.feedback;
    const newest = ring.length ? ring[ring.length - 1].seq : 0;
    // A new seat, or the same start tick taken again with its sequence back at 1.
    if (session.defense.startTick !== this.startTick || newest < this.seenSeq) {
      this.restart(session.defense.startTick);
    }
    let i = ring.length;
    while (i > 0 && ring[i - 1].seq > this.seenSeq) i--;
    for (; i < ring.length; i++) {
      const entry = ring[i];
      if (entry.event.type === 'fired') this.resolve(entry, entry.event);
    }
    if (newest > this.seenSeq) this.seenSeq = newest;
  }

  private restart(startTick: number): void {
    this.startTick = startTick;
    this.seenSeq = 0;
    for (const shot of this.records) shot.serial = 0;
    this.verdictSeq.fill(0);
    this.verdictSerial.fill(0);
  }

  /**
   * The mark this entry confirms, among the clicks at its point sent by its tick
   * and newer than the last confirmed (the server takes commands in order). Older
   * waiting marks were refused. Only the one click at its point teaches the lead:
   * among several, the likeliest may be a newer or older click than the server's
   * own, and a wrong trip would skew the band.
   */
  private resolve(entry: TurretFeedback, fired: TurretFired): void {
    let match: TurretOwnShot | null = null;
    let candidates = 0;
    for (const shot of this.records) {
      if (shot.serial <= this.confirmedSerial || shot.clock > entry.tick) continue;
      if (Math.abs(shot.x - fired.x) > MATCH_YD || Math.abs(shot.z - fired.z) > MATCH_YD) continue;
      candidates++;
      if (!match || this.likelier(shot, match, entry.tick)) match = shot;
    }
    let verdict = 0;
    if (match) {
      for (const shot of this.records) {
        if (shot.status === 'pending' && shot.serial !== 0 && shot.serial < match.serial) {
          shot.status = 'refused';
        }
      }
      const late = match.status !== 'pending';
      match.status = 'confirmed';
      this.confirmedSerial = match.serial;
      if (candidates === 1) this.sampleLead(entry.tick - match.clock);
      if (match.play === 'played') verdict = late ? -match.serial : match.serial;
    }
    const slot = this.nextVerdict;
    this.nextVerdict = (slot + 1) % VERDICTS;
    this.verdictSeq[slot] = entry.seq;
    this.verdictSerial[slot] = verdict;
  }

  /**
   * Of two clicks at an entry's point, `a` is likelier its own: still waiting,
   * then played (its shell is in the air), then sent nearer the lead before it.
   */
  private likelier(a: TurretOwnShot, b: TurretOwnShot, tick: number): boolean {
    if (rank(a) !== rank(b)) return rank(a) < rank(b);
    return Math.abs(tick - a.clock - this.lead) < Math.abs(tick - b.clock - this.lead);
  }

  private sampleLead(ticks: number): void {
    const sample = Math.max(0, ticks);
    this.lead = this.sampled > 0 ? this.lead + (sample - this.lead) * LEAD_GAIN : sample;
    this.samples[this.sampled % BAND_SAMPLES] = sample;
    this.sampled++;
  }

  /** An unused record, else the oldest settled one, else the oldest waiting free, held, then played. */
  private freeRecord(): TurretOwnShot {
    let best: TurretOwnShot | null = null;
    let bestOrder = 4;
    for (const shot of this.records) {
      if (shot.serial === 0) return shot;
      const order = shot.status !== 'pending' ? 0 : 3 - PLAY_RANK[shot.play];
      if (order < bestOrder || (order === bestOrder && best && shot.serial < best.serial)) {
        best = shot;
        bestOrder = order;
      }
    }
    return best ?? this.records[0];
  }
}
