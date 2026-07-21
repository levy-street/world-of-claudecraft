// Headless RL environment server.
// Speaks NDJSON over stdin/stdout: one JSON object per line in, one per line out.
//
//   -> {"cmd":"info"}
//   <- {"obs_size":...,"num_actions":...,"actions":[...]}  (sizes are content-dependent; query, don't hardcode)
//   -> {"cmd":"reset","seed":123,"player_class":"warrior","player_level":20,"talents":{"spec":"arms","rows":{}},"config":{...}}
//   <- {"obs":[...],"info":{...}}
//   -> {"cmd":"step","action":4}
//   <- {"obs":[...],"reward":0.01,"terminated":false,"truncated":false,"info":{...}}
//   -> {"cmd":"close"}
//
// Run `node dist-env/env_server.cjs --bench` for a throughput benchmark.

import * as readline from 'node:readline';
import type { TalentAllocation } from '../src/sim/content/talents';
import { ACTIONS, applyAction, encodeObs, NUM_ACTIONS, obsSize } from '../src/sim/obs';
import { type RewardCounters, Sim } from '../src/sim/sim';
import { ALL_CLASSES, MAX_LEVEL, type PlayerClass } from '../src/sim/types';
import {
  MAX_INPUT_LINE_LENGTH,
  parseTalentResetRequest,
  validateAction,
  validatePlayerClass,
} from './protocol';

interface EnvConfig {
  frameSkip: number; // sim ticks per env step (20 ticks = 1 second)
  maxSteps: number; // truncate episode after this many steps (0 = never)
  respawnSeconds: number;
  terminateOnDeath: boolean;
  rewards: {
    xp: number; // per xp point
    damageDealt: number;
    damageTaken: number;
    kill: number;
    death: number;
    questDone: number;
    questProgress: number;
    levelUp: number;
    timePenalty: number; // per step
  };
}

const DEFAULT_CONFIG: EnvConfig = {
  frameSkip: 5, // 4 decisions per sim-second
  // the cap is level 20 across three zones now — episodes need room to breathe
  maxSteps: 8000,
  respawnSeconds: 15,
  terminateOnDeath: false,
  rewards: {
    xp: 0.01,
    damageDealt: 0.002,
    damageTaken: -0.001,
    kill: 0.2,
    death: -5,
    questDone: 5,
    questProgress: 0.5,
    levelUp: 2,
    timePenalty: 0,
  },
};

class Env {
  sim: Sim | null = null;
  config: EnvConfig = DEFAULT_CONFIG;
  playerClass: PlayerClass = 'warrior';
  stepCount = 0;
  prev: RewardCounters | null = null;

  reset(
    seed: number,
    playerClass: PlayerClass,
    cfg: Partial<EnvConfig> & { rewards?: Partial<EnvConfig['rewards']> },
    playerLevel = 1,
    talents?: TalentAllocation,
  ): object {
    this.config = {
      ...DEFAULT_CONFIG,
      ...cfg,
      rewards: { ...DEFAULT_CONFIG.rewards, ...(cfg.rewards ?? {}) },
    };
    this.playerClass = playerClass;
    this.sim = new Sim({
      seed,
      playerClass,
      respawnSeconds: this.config.respawnSeconds,
      autoEquip: true,
    });
    if (playerLevel !== 1) this.sim.setPlayerLevel(playerLevel);
    if (talents && !this.sim.applyTalents(talents)) throw new Error('invalid talents');
    this.stepCount = 0;
    this.prev = { ...this.sim.counters };
    return { obs: encodeObs(this.sim), info: this.infoDict() };
  }

  step(action: number): object {
    if (!this.sim || !this.prev) throw new Error('call reset first');
    const sim = this.sim;
    applyAction(sim, action);
    for (let i = 0; i < this.config.frameSkip; i++) sim.tick();
    this.stepCount++;

    const c = sim.counters;
    const r = this.config.rewards;
    const reward =
      (c.xpGained - this.prev.xpGained) * r.xp +
      (c.damageDealt - this.prev.damageDealt) * r.damageDealt +
      (c.damageTaken - this.prev.damageTaken) * r.damageTaken +
      (c.kills - this.prev.kills) * r.kill +
      (c.deaths - this.prev.deaths) * r.death +
      (c.questsCompleted - this.prev.questsCompleted) * r.questDone +
      (c.questProgress - this.prev.questProgress) * r.questProgress +
      (c.levelUps - this.prev.levelUps) * r.levelUp +
      r.timePenalty;
    const died = c.deaths > this.prev.deaths;
    this.prev = { ...c };

    const terminated = (this.config.terminateOnDeath && died) || sim.player.level >= MAX_LEVEL;
    const truncated = this.config.maxSteps > 0 && this.stepCount >= this.config.maxSteps;

    return {
      obs: encodeObs(sim),
      reward,
      terminated,
      truncated,
      info: this.infoDict(),
    };
  }

  infoDict(): object {
    const sim = this.sim!;
    return {
      level: sim.player.level,
      xp: sim.xp,
      hp: sim.player.hp,
      kills: sim.counters.kills,
      deaths: sim.counters.deaths,
      quests_done: sim.counters.questsCompleted,
      copper: sim.copper,
      step: this.stepCount,
    };
  }
}

function bench(): void {
  const env = new Env();
  env.reset(1, 'warrior', {});
  const N = 200_000;
  // exercise a realistic action mix
  const start = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    const a = i % 11 === 0 ? 8 : i % 7 === 0 ? 9 : i % 5 === 0 ? 10 : 1;
    const res = env.step(a) as any;
    if (res.terminated || res.truncated) env.reset(i, 'warrior', {});
  }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
  const sps = Math.round(N / elapsed);
  const tps = sps * DEFAULT_CONFIG.frameSkip;
  console.log(`steps: ${N}, elapsed: ${elapsed.toFixed(2)}s`);
  console.log(`env steps/sec: ${sps} (${tps} sim ticks/sec) on a single core`);
}

function serve(): void {
  const env = new Env();
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const send = (obj: object) => process.stdout.write(JSON.stringify(obj) + '\n');

  rl.on('line', (line: string) => {
    if (line.length > MAX_INPUT_LINE_LENGTH) {
      send({ error: 'input line too large' });
      return;
    }
    line = line.trim();
    if (!line) return;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ error: 'bad json' });
      return;
    }
    try {
      switch (msg.cmd) {
        case 'info':
          send({
            obs_size: obsSize(),
            num_actions: NUM_ACTIONS,
            actions: ACTIONS,
            max_level: MAX_LEVEL,
          });
          break;
        case 'reset':
          {
            const playerClass = validatePlayerClass(msg.player_class ?? 'warrior');
            if (playerClass === null) {
              send({ error: `invalid player_class: expected one of ${ALL_CLASSES.join(', ')}` });
              break;
            }
            const reset = parseTalentResetRequest(msg);
            if (!reset.ok) {
              send({ error: reset.error });
              break;
            }
            send(
              env.reset(
                msg.seed ?? 0,
                playerClass,
                msg.config ?? {},
                reset.playerLevel,
                reset.talents,
              ),
            );
          }
          break;
        case 'step':
          {
            const action = validateAction(msg.action ?? 0);
            if (action === null) {
              send({ error: `invalid action: expected integer 0-${NUM_ACTIONS - 1}` });
              break;
            }
            send(env.step(action));
          }
          break;
        case 'close':
          send({ ok: true });
          process.exit(0);
          break;
        default:
          send({ error: `unknown cmd: ${msg.cmd}` });
      }
    } catch (err: any) {
      send({ error: String(err?.message ?? err) });
    }
  });
  rl.on('close', () => process.exit(0));
}

if (process.argv.includes('--bench')) bench();
else serve();
