import { HoardMechanicAudio } from '../game/hoard_mechanic_audio';
import { HoardTideAudio } from '../game/hoard_tide_audio';
import { sfx } from '../game/sfx';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { HOARD_TIDE_WAVE_HALF_GAP, hoardTideWaveCenter } from '../sim/rift/hoard_boss_kits';
import type { SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';
import type { HoardBossCueView } from '../world_api/dungeons';
import { GFX } from './gfx';

/** Local presentation only. Cues and damage always come from the authoritative world. */
export class HoardBossPresentation {
  private readonly audio = new HoardTideAudio(sfx);
  /** The hammer, the boulder, the tentacles and the cocoon, told in sound. */
  private readonly mechanics = new HoardMechanicAudio(sfx);
  private lastNearCue = -1;
  private lastNearInstance = -1;
  private readonly cosmeticShake =
    resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
      .tier !== 'low';
  constructor(
    private readonly world?: IWorld,
    private readonly shake?: (amount: number) => void,
  ) {
    if (world)
      for (const key of [
        'hoard_tide_build',
        'hoard_tide_rush',
        'hoard_tide_crash',
        'hoard_tide_hit',
      ])
        sfx.preload(key);
  }

  sync(cues: readonly HoardBossCueView[]): void {
    const world = this.world;
    if (!world) return;
    const player = world.entities.get(world.playerId);
    for (const cue of cues) {
      if (cue.targetId !== undefined) {
        const target = world.entities.get(cue.targetId);
        if (target) {
          cue.x = target.pos.x;
          cue.z = target.pos.z;
        }
      }
      if (!player || cue.variant !== 'tide-wave' || cue.total - cue.remaining < (cue.waveLead ?? 1))
        continue;
      const facing = cue.facing ?? 0;
      const dx = player.pos.x - cue.x;
      const dz = player.pos.z - cue.z;
      const lateral = dx * Math.cos(facing) - dz * Math.sin(facing);
      const along = dx * Math.sin(facing) + dz * Math.cos(facing);
      const center = hoardTideWaveCenter(cue.radius, cue.remaining, cue.total, cue.waveLead);
      if (
        (cue.cueId !== this.lastNearCue || cue.instanceId !== this.lastNearInstance) &&
        Math.abs(along - center) < 2.5 &&
        Math.abs(lateral) <= (cue.waveSpan ?? 15) &&
        Math.abs(lateral - (cue.waveGap ?? 0)) >= HOARD_TIDE_WAVE_HALF_GAP
      ) {
        this.lastNearCue = cue.cueId;
        this.lastNearInstance = cue.instanceId;
        if (this.cosmeticShake) this.shake?.(0.08);
      }
    }
    this.audio.sync(cues, player?.pos.y ?? 0);
    this.mechanics.sync(cues, player?.pos.y ?? 0);
  }

  handleEvent(event: SimEvent): void {
    if (event.type !== 'damage' || event.ability !== 'Crashing Tide') return;
    const target = this.world?.entities.get(event.targetId);
    if (target) this.audio.hit(target.pos.x, target.pos.y, target.pos.z);
    if (event.targetId === this.world?.playerId) this.shake?.(0.13);
  }

  dispose(): void {
    this.audio.dispose();
    this.mechanics.dispose();
  }
}
