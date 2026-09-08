import { masterworkAudioKey } from '../game/masterwork_audio_core';
import type { sfx } from '../game/sfx';
import { attackAbilityId } from '../render/characters/weapon_attack_style_core';
import type { Entity, SimEvent } from '../sim/types';
import {
  auraApplyCue,
  castCueForAbility,
  consumeHealCue,
  groundTickAbilityCue,
  impactCueForDamage,
  novaAbilityCue,
  playerSwingCueForDamage,
  shouldPlayCombatImpactForTarget,
  shouldPlayCritSfxForTarget,
  spellFxCue,
} from '../ui/combat_sfx';

/** The same canonical cue decisions as the HUD, without constructing a HUD.
 * This adapter owns only its cast loops; the renderer owns spatial VFX audio. */
export class StudioCombatAudio {
  private readonly loops = new Set<number>();
  constructor(private readonly sink: Pick<typeof sfx, 'playAt' | 'loop' | 'unloop' | 'preload'>) {}

  clear(): void {
    for (const id of this.loops) this.sink.unloop(`cast:${id}`, 0.05);
    this.loops.clear();
  }

  event(event: SimEvent, entities: ReadonlyMap<number, Entity>, playerId: number): void {
    const play = (key: string, actor: Entity | undefined, gain = 0.75) => {
      if (actor)
        this.sink.playAt(key, actor.pos.x, actor.pos.y, actor.pos.z, { gain, cooldown: 0.08 });
    };
    switch (event.type) {
      case 'castStart': {
        const actor = entities.get(event.entityId);
        const signature = masterworkAudioKey(event.ability, 'charge');
        if (signature && actor) {
          this.sink.loop(
            `cast:${actor.id}`,
            signature,
            0.55,
            actor.pos.x,
            actor.pos.y,
            actor.pos.z,
          );
          this.loops.add(actor.id);
          break;
        }
        if (event.ability === 'chain_heal') {
          play('cast_chain_heal', actor);
          break;
        }
        const cue = castCueForAbility(event.ability);
        if (cue && actor) {
          this.sink.loop(`cast:${actor.id}`, cue, 0.75, actor.pos.x, actor.pos.y, actor.pos.z);
          this.loops.add(actor.id);
        }
        break;
      }
      case 'castStop':
        this.sink.unloop(`cast:${event.entityId}`, 0.1);
        this.loops.delete(event.entityId);
        break;
      case 'death':
        this.sink.unloop(`cast:${event.entityId}`, 0.05);
        this.loops.delete(event.entityId);
        break;
      case 'spellfx': {
        if (masterworkAudioKey(event.ability, 'release')) break;
        const cue = spellFxCue(event);
        if (cue) play(cue.key, entities.get(cue.anchorId));
        break;
      }
      case 'spellfxAt': {
        if (masterworkAudioKey(event.ability, 'impact')) break;
        if (event.fx === 'meteorFall') {
          this.sink.preload('meteor');
          break;
        }
        const cue =
          event.fx === 'tick'
            ? groundTickAbilityCue(event.ability)
            : (event.sfxKey ?? (event.fx === 'nova' ? novaAbilityCue(event.ability) : null));
        if (cue)
          this.sink.playAt(cue, event.x, entities.get(playerId)?.pos.y ?? 0, event.z, {
            gain: 0.75,
            cooldown: 0.08,
          });
        break;
      }
      case 'damage': {
        const target = entities.get(event.targetId);
        if (!target) break;
        const source = entities.get(event.sourceId);
        const swing = playerSwingCueForDamage(event, source ?? null);
        if (swing) play(swing, source);
        if (['miss', 'dodge', 'resist', 'evade', 'parry'].includes(event.kind)) break;
        if ((event.absorbed ?? 0) > 0 || event.kind === 'block') play('combat_block', target, 0.4);
        const cue = impactCueForDamage(event, target);
        if (
          cue &&
          !masterworkAudioKey(attackAbilityId(event.ability), 'impact') &&
          shouldPlayCombatImpactForTarget(target)
        )
          play(cue, target);
        if (event.crit && shouldPlayCritSfxForTarget(target)) play('combat_crit', target);
        break;
      }
      case 'heal':
      case 'heal2': {
        if (
          event.type === 'heal2' &&
          masterworkAudioKey(event.abilityId ?? attackAbilityId(event.ability), 'impact')
        )
          break;
        const cue = event.type === 'heal' ? consumeHealCue(event) : null;
        if (event.type === 'heal' && event.source && !cue) break;
        const hot = event.type === 'heal2' && event.hot === true;
        const frenzy = event.type === 'heal2' && event.abilityId === 'frenzied_regeneration';
        if (hot ? !frenzy : frenzy) break;
        play(cue ?? 'heal_impact', entities.get(event.targetId));
        break;
      }
      case 'aura': {
        if (event.targetId !== playerId) break;
        const actor = entities.get(playerId);
        const aura = event.gained
          ? (actor?.auras.find((a) => a.name === event.name) ?? null)
          : null;
        const cue = auraApplyCue(event, aura);
        if (cue) play(cue, actor);
        break;
      }
    }
  }
}
