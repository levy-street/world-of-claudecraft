// Fire and Fly monster sounds: a hurt cry when a live monster is thrown, its death
// cry on a kill, a thump per bounce or landing, and a heavy knock per bowled body.
// Each kind of sound keeps one channel: of the candidates a frame offers, only the
// strongest plays, and only once the channel's gap has passed, so a wave landing
// at once is one thump and a blast through a pack is one cry.
import { fireAndFlyLookTemplate } from '../sim/content/fire_and_fly_looks';
import { TURRET_BOWLING, TURRET_PHYSICS, TURRET_WEAPON } from '../sim/content/turret_defense';
import type { TurretEvent } from '../sim/minigames/turret_defense';
import type { TurretPlan } from '../sim/minigames/turret_defense_plan';
import type { TurretSizeClass } from '../sim/types';
import type { TurretSessionView } from '../world_api/vehicles';
import type { TurretSfxCue } from './turret_defense_sfx';

export const TURRET_THUMP_LIGHT_SFX = 'move_land';
export const TURRET_THUMP_HEAVY_SFX = 'rift_boulder_impact';
export const TURRET_KNOCK_SFX = 'impact_warrior_quake';

export const TURRET_VOICE_GAP_MS = 150;
/** A monster cries at most once in this long; its death cry ignores it. */
export const TURRET_VOICE_REPEAT_MS = 1000;
export const TURRET_THUMP_GAP_MS = 90;
export const TURRET_KNOCK_GAP_MS = 90;

export type TurretVoiceAction = 'hurt' | 'death';
/** A template's clip for a cry, or null when it has none. */
export type TurretVoiceCue = (templateId: string, action: TurretVoiceAction) => string | null;

const THUMPS: Readonly<Record<TurretSizeClass, { readonly key: string; readonly rate: number }>> = {
  small: { key: TURRET_THUMP_LIGHT_SFX, rate: 1.15 },
  medium: { key: TURRET_THUMP_LIGHT_SFX, rate: 0.95 },
  large: { key: TURRET_THUMP_HEAVY_SFX, rate: 1.1 },
  huge: { key: TURRET_THUMP_HEAVY_SFX, rate: 0.9 },
};

const THUMP_GAIN_MIN = 0.3;
const THUMP_GAIN_MAX = 0.95;
/** Contact speed (yd/s) of the loudest thump; a landing is slower than any bounce. */
const THUMP_HARD_SPEED = 20;
const KNOCK_GAIN_MIN = 0.5;
const KNOCK_GAIN_MAX = 1;
const HURT_GAIN = 0.8;
const DEATH_GAIN = 1;
const DEATH_RANK = 2;
const HURT_RANK = 1;

function ramp(value: number, from: number, to: number, min: number, max: number): number {
  const k = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return min + (max - min) * (Number.isFinite(k) ? k : 0);
}

/** A bounce's gain from its contact speed; a landing (no bounce left in it) plays the softest. */
export function turretThumpGain(speed: number): number {
  return ramp(
    speed,
    TURRET_PHYSICS.bounceMinSpeed,
    THUMP_HARD_SPEED,
    THUMP_GAIN_MIN,
    THUMP_GAIN_MAX,
  );
}

/** A knock's gain from the flyer's speed across, from the slowest that can knock to the throw cap. */
export function turretKnockGain(speed: number): number {
  return ramp(
    speed,
    TURRET_BOWLING.minSpeed,
    TURRET_WEAPON.maxLaunchSpeed,
    KNOCK_GAIN_MIN,
    KNOCK_GAIN_MAX,
  );
}

export function turretThumpSound(size: TurretSizeClass): {
  readonly key: string;
  readonly rate: number;
} {
  return THUMPS[size];
}

/** Every cry the plan's monsters can make, once each. */
export function turretVoiceKeys(plan: TurretPlan, voiceCue: TurretVoiceCue): string[] {
  const keys = new Set<string>();
  for (const kind of plan.kinds) {
    for (const action of ['hurt', 'death'] as const) {
      const key = voiceCue(fireAndFlyLookTemplate(kind.templateId, plan.scenarioId), action);
      if (key) keys.add(key);
    }
  }
  return [...keys];
}

interface Channel {
  readonly gapMs: number;
  lastAt: number;
  pending: boolean;
  score: number;
  /** The crying monster (voice channel only). */
  monster: number;
  readonly cue: TurretSfxCue;
}

function channel(gapMs: number): Channel {
  return {
    gapMs,
    lastAt: Number.NEGATIVE_INFINITY,
    pending: false,
    score: 0,
    monster: -1,
    cue: { key: '', x: 0, y: 0, z: 0, gain: 1, rate: 1, jitter: true },
  };
}

/** Claims the channel for a candidate that outscores the one it holds (ties keep the first). */
function claim(ch: Channel, score: number): TurretSfxCue | null {
  if (ch.pending && score <= ch.score) return null;
  ch.pending = true;
  ch.score = score;
  return ch.cue;
}

function place(
  cue: TurretSfxCue,
  key: string,
  at: { readonly x: number; readonly y: number; readonly z: number },
  gain: number,
  rate: number,
): void {
  cue.key = key;
  cue.x = at.x;
  cue.y = at.y;
  cue.z = at.z;
  cue.gain = gain;
  cue.rate = rate;
  cue.jitter = true;
}

/** The monsters' sounds for one seat: offer each fresh event, then flush once per frame. */
export class TurretMonsterSfx {
  private readonly voice = channel(TURRET_VOICE_GAP_MS);
  private readonly thump = channel(TURRET_THUMP_GAP_MS);
  private readonly knock = channel(TURRET_KNOCK_GAP_MS);
  private readonly lastCry = new Map<number, number>();
  private readonly dead = new Set<number>();
  /** Monster id to plan kind, kept after the engine drops a body (a drowned one, say). */
  private readonly kinds = new Map<number, number>();

  constructor(private readonly voiceCue: TurretVoiceCue) {}

  /** Forgets the previous seat's monsters. */
  reset(): void {
    this.lastCry.clear();
    this.dead.clear();
    this.kinds.clear();
    for (const ch of [this.voice, this.thump, this.knock]) {
      ch.pending = false;
      ch.lastAt = Number.NEGATIVE_INFINITY;
    }
  }

  /** `now` is a millisecond clock shared with flush. */
  offer(event: TurretEvent, session: TurretSessionView, now: number): void {
    switch (event.type) {
      case 'launched': {
        if (this.dead.has(event.id)) return;
        const last = this.lastCry.get(event.id);
        if (last !== undefined && now - last < TURRET_VOICE_REPEAT_MS) return;
        this.offerCry(session, event.id, 'hurt', event);
        return;
      }
      case 'killed':
        this.dead.add(event.id);
        this.offerCry(session, event.id, 'death', event);
        return;
      case 'bounce':
        this.offerThump(session, event.id, event, turretThumpGain(event.speed));
        return;
      case 'landed':
        this.offerThump(session, event.id, event, turretThumpGain(0));
        return;
      case 'bowled': {
        const gain = turretKnockGain(event.speed);
        const cue = claim(this.knock, gain);
        if (cue) place(cue, TURRET_KNOCK_SFX, event, gain, 1);
        return;
      }
    }
  }

  /** Plays each channel's strongest candidate whose gap has passed, and clears the rest. */
  flush(now: number, play: (cue: TurretSfxCue) => void): void {
    if (this.release(this.voice, now)) {
      this.lastCry.set(this.voice.monster, now);
      play(this.voice.cue);
    }
    if (this.release(this.thump, now)) play(this.thump.cue);
    if (this.release(this.knock, now)) play(this.knock.cue);
  }

  private release(ch: Channel, now: number): boolean {
    if (!ch.pending) return false;
    ch.pending = false;
    if (now - ch.lastAt < ch.gapMs) return false;
    ch.lastAt = now;
    return true;
  }

  private kindOf(session: TurretSessionView, id: number): TurretPlan['kinds'][number] | null {
    let index = this.kinds.get(id);
    if (index === undefined) {
      const monster = session.defense.monsters.find((m) => m.id === id);
      if (!monster) return null;
      index = monster.kind;
      this.kinds.set(id, index);
    }
    return session.defense.plan.kinds[index] ?? null;
  }

  private offerCry(
    session: TurretSessionView,
    id: number,
    action: TurretVoiceAction,
    at: { readonly x: number; readonly y: number; readonly z: number },
  ): void {
    const kind = this.kindOf(session, id);
    const look = kind && fireAndFlyLookTemplate(kind.templateId, session.defense.plan.scenarioId);
    const key = look && this.voiceCue(look, action);
    if (!key) return;
    const cue = claim(this.voice, action === 'death' ? DEATH_RANK : HURT_RANK);
    if (!cue) return;
    this.voice.monster = id;
    place(cue, key, at, action === 'death' ? DEATH_GAIN : HURT_GAIN, 1);
  }

  private offerThump(
    session: TurretSessionView,
    id: number,
    at: { readonly x: number; readonly y: number; readonly z: number },
    gain: number,
  ): void {
    const cue = claim(this.thump, gain);
    if (!cue) return;
    const sound = turretThumpSound(this.kindOf(session, id)?.sizeClass ?? 'medium');
    place(cue, sound.key, at, gain, sound.rate);
  }
}
