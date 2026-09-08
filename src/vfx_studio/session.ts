import type { TalentAllocation } from '../sim/content/talents';
import { ABILITIES } from '../sim/data';
import { Sim } from '../sim/sim';
import {
  DT,
  emptyMoveInput,
  PLAYER_INTEREST_DROP_RADIUS,
  type PlayerClass,
  type SimEvent,
} from '../sim/types';
import { WORLD_SEED } from '../sim/world_seed';
import { studioAbilityLibrary } from './ability_library';
import { equipStudioLoadout } from './loadout';
import { stageStudioCast } from './stage_cast';
import { arrangeStudioActors } from './stage_layout';

export type StudioScene = 'sandbox' | 'duel' | 'raid';
export interface StudioConfig {
  cls: PlayerClass;
  spec: string | null;
  scene: StudioScene;
  seed: number;
  rows?: TalentAllocation['rows'];
  graphicsPreset?: number;
  environment?: 'studio' | 'world';
}
export type StudioCommand =
  | { kind: 'cast'; abilityId: string; targetId: number; prepare?: boolean }
  | { kind: 'move'; active: boolean }
  | { kind: 'target'; targetId: number }
  | { kind: 'recover' };
export interface RecordedCommand {
  tick: number;
  command: StudioCommand;
}
export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  cls: 'shaman',
  spec: 'restoration',
  scene: 'sandbox',
  seed: WORLD_SEED,
};

/** Scenario setup only. Combat always runs through the shipped simulation. */
export class StudioSession {
  readonly sim: Sim;
  readonly commands: RecordedCommand[] = [];
  readonly targetIds: number[] = [];
  ticks = 0;

  readonly config: StudioConfig;

  constructor(config: StudioConfig) {
    if (!Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff)
      throw new Error('Invalid studio seed');
    this.config = Object.freeze({ ...config, rows: Object.freeze({ ...config.rows }) });
    this.sim = new Sim({
      seed: config.seed,
      playerClass: config.cls,
      playerName: 'VFX',
      devCommands: true,
      compulsoryTutorial: false,
      riftPortals: false,
      idleMobTickRadius: PLAYER_INTEREST_DROP_RADIUS,
    });
    this.sim.setPlayerLevel(20);
    for (const ability of Object.values(ABILITIES))
      if (ability.class === config.cls && ability.requiresQuest)
        this.sim.questsDone.add(ability.requiresQuest);
    this.sim.ctx.refreshKnownAbilities(this.sim.players.get(this.sim.player.id)!, false);
    if (!this.sim.applyTalents({ spec: config.spec, rows: { ...config.rows } }))
      throw new Error('Invalid studio talent build');
    equipStudioLoadout(this.sim, config.cls, config.spec);
    if (config.scene === 'sandbox') {
      const existing = new Set(this.sim.entities.keys());
      this.sim.startDevSandbox();
      for (const e of this.sim.entities.values())
        if (!existing.has(e.id)) this.targetIds.push(e.id);
    } else if (config.scene === 'raid') {
      this.sim.chat('/dev ignivarraid boss');
      const player = this.sim.player;
      const nearby = [...this.sim.entities.values()].filter(
        (e) =>
          e.id !== player.id && Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) < 100,
      );
      const boss = nearby.filter((e) => e.kind === 'mob').sort((a, b) => b.maxHp - a.maxHp)[0];
      if (!boss) throw new Error('Raid showcase boss is missing');
      // Place the observer in real cast range. Practice immortality prevents
      // death from ending a long effects take; damage/CC still resolve normally.
      player.pos = this.sim.groundPos(boss.pos.x, boss.pos.z + 18);
      player.prevPos = { ...player.pos };
      this.sim.rebucket(player);
      this.sim.chat('/dev immortal');
      this.targetIds.push(boss.id, ...nearby.filter((e) => e.kind === 'player').map((e) => e.id));
    } else {
      const opponent = this.sim.addPlayer('mage', 'PVP', { bot: true });
      this.sim.setPlayerLevel(20, opponent);
      const actor = this.sim.entities.get(opponent)!;
      const me = this.sim.player;
      actor.pos = this.sim.groundPos(me.pos.x - 4, me.pos.z + 6);
      actor.prevPos = { ...actor.pos };
      this.sim.rebucket(actor);
      this.sim.duelRequest(opponent);
      this.sim.duelAccept(opponent);
      for (let i = 0; i < 61; i++) this.sim.tick();
      this.targetIds.push(opponent);
    }
    this.targetIds.push(this.sim.player.id);
    if (config.environment !== 'world' && config.scene !== 'raid')
      arrangeStudioActors(this.sim, this.targetIds);
    this.sim.drainEvents();
    this.target(this.targetIds[0]);
  }

  get time(): number {
    return this.ticks * DT;
  }
  get abilities(): string[] {
    return [...studioAbilityLibrary(this.sim).keys()];
  }
  target(id: number): void {
    const target = this.sim.entities.get(id);
    if (!target) return;
    const player = this.sim.player;
    player.facing = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
    player.prevFacing = player.facing;
    this.sim.targetEntity(id);
  }

  dispatch(command: StudioCommand, record = true): SimEvent[] {
    if (record) this.commands.push({ tick: this.ticks, command: { ...command } });
    if (command.kind === 'target') {
      this.target(command.targetId);
    } else if (command.kind === 'move') {
      Object.assign(this.sim.players.get(this.sim.player.id)!.moveInput, emptyMoveInput(), {
        forward: command.active,
      });
    } else if (command.kind === 'recover') {
      // Explicit convenience only, distinct from complete session reset.
      this.sim.chat('/dev cooldowns');
      this.sim.chat('/dev resource');
    } else {
      if (!ABILITIES[command.abilityId]) return [];
      const targetId =
        command.prepare && this.config.scene === 'sandbox'
          ? stageStudioCast(this.sim, command.abilityId, command.targetId)
          : command.targetId;
      this.target(targetId);
      const target = this.sim.entities.get(targetId);
      const base = studioAbilityLibrary(this.sim).get(command.abilityId)?.base ?? command.abilityId;
      const definition = ABILITIES[command.abilityId];
      if (command.prepare && this.config.scene === 'sandbox' && command.abilityId === 'dismiss_pet')
        this.sim.abandonPet();
      else if (target)
        this.sim.castAbility(
          base,
          undefined,
          definition.targetMode === 'position' ? { x: target.pos.x, z: target.pos.z } : undefined,
        );
    }
    return this.sim.drainEvents();
  }

  tick(): SimEvent[] {
    this.ticks++;
    const events = this.sim.tick();
    if (this.config.scene === 'sandbox') {
      const party = this.sim.partyOf(this.sim.player.id)?.members ?? [];
      for (const id of this.sim.ctx.pendingResurrections.keys())
        if (id !== this.sim.player.id && party.includes(id))
          this.sim.respondToResurrection(true, id);
      events.push(...this.sim.drainEvents());
    }
    return events;
  }
}
