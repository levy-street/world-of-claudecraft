import type { SimEvent } from '../sim/types';
import type { HoardBossCueView } from '../world_api/dungeons';

interface MirroredCue extends Omit<HoardBossCueView, 'remaining'> {
  expiresAtMs: number;
}

/** Client-side clock mirror for authoritative Hoard telegraphs. */
export class HoardBossCueMirror {
  private cues: MirroredCue[] = [];

  constructor(private readonly nowMs: () => number) {}

  apply(event: SimEvent): void {
    const now = this.nowMs();
    if (event.type === 'riftState') {
      this.cues = event.active
        ? (event.hoardCues ?? []).map((cue) => ({
            ...cue,
            expiresAtMs: now + cue.remaining * 1000,
          }))
        : [];
      return;
    }
    if (event.type === 'hoardBossCueClear') {
      this.cues = [];
      return;
    }
    if (event.type !== 'hoardBossCue') return;
    this.cues = this.cues.filter(
      (cue) =>
        cue.expiresAtMs > now && (cue.instanceId !== event.instanceId || cue.cueId !== event.cueId),
    );
    this.cues.push({
      instanceId: event.instanceId,
      cueId: event.cueId,
      kind: event.kind,
      variant: event.variant,
      phase: event.phase,
      x: event.x,
      z: event.z,
      radius: event.radius,
      total: event.durationSecs,
      facing: event.facing,
      halfAngle: event.halfAngle,
      innerRadius: event.innerRadius,
      waveGap: event.waveGap,
      waveSpan: event.waveSpan,
      waveLead: event.waveLead,
      targetId: event.targetId,
      expiresAtMs: now + event.durationSecs * 1000,
    });
  }

  views(): HoardBossCueView[] {
    const now = this.nowMs();
    return this.cues.flatMap((cue) => {
      const remaining = (cue.expiresAtMs - now) / 1000;
      return remaining > 0 ? [{ ...cue, remaining }] : [];
    });
  }
}
