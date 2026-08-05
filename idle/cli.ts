// Idle Classic CLI entry.
// Run: `node dist-idle/idle.cjs --class warrior --seed 20061 --speed 20`
//
// Prints a one-line summary per step plus colored SimEvent highlights.
// No top-level await (esbuild CJS output constraint, mirrors headless/).

import type { SimEvent } from '../src/sim/types';
import { ALL_CLASSES } from '../src/sim/types';
import type { IdleEngineOptions, IdleStepSummary } from './engine';
import { IdleEngine } from './engine';

// -------------------------------------------------------------------------
// Cheap ANSI terminal colours (no dep).
// -------------------------------------------------------------------------
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// -------------------------------------------------------------------------
// CLI arg parsing (no dependency).
// -------------------------------------------------------------------------
interface CliArgs {
  playerClass: string;
  seed: number;
  speed: number;
  level: number;
  saveDir: string;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    playerClass: 'warrior',
    seed: 20061,
    speed: 20,
    level: 5,
    saveDir: 'idle/save',
    help: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--class':
        args.playerClass = argv[++i] ?? 'warrior';
        break;
      case '--seed':
        args.seed = parseInt(argv[++i] ?? '20061', 10);
        break;
      case '--speed':
        args.speed = parseInt(argv[++i] ?? '20', 10);
        break;
      case '--level':
        args.level = parseInt(argv[++i] ?? '5', 10);
        break;
      case '--save-dir':
        args.saveDir = argv[++i] ?? 'idle/save';
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
Idle Classic, terminal-first idle game mode for World of ClaudeCraft

Usage:  node dist-idle/idle.cjs [options]

Options:
  --class <name>     Player class (${ALL_CLASSES.join(', ')}).    Default: warrior
  --seed <int>       World seed for determinism.                    Default: 20061
  --speed <N>        Sim ticks per step (20 = 1 sim-sec/real-sec).  Default: 20
  --save-dir <path>  Directory for per-character save files.        Default: idle/save
  --help, -h         Show this help.

Examples:
  node dist-idle/idle.cjs --class mage --seed 42
  node dist-idle/idle.cjs --class rogue --speed 40 --save-dir my_saves
`);
}

// -------------------------------------------------------------------------
// SimEvent highlighting
// -------------------------------------------------------------------------

function highlightSimEvent(ev: SimEvent, engine: IdleEngine): string | null {
  switch (ev.type) {
    case 'damage':
      if (ev.kind === 'hit' || ev.kind === 'miss' || ev.kind === 'dodge') {
        const who = ev.sourceId === engine.sim.primaryId ? 'Player' : `Mob${ev.sourceId}`;
        return `${DIM}${who} ${ev.kind} ${ev.targetId === engine.sim.primaryId ? 'Player' : 'Mob' + ev.targetId} ${ev.amount}dmg ${ev.ability || ''}${ev.crit ? ' CRIT' : ''}${RESET}`;
      }
      return null;
    case 'xp':
      return `${CYAN}XP: +${ev.amount}${ev.rested ? ` (rested: ${ev.rested})` : ''}${RESET}`;
    case 'levelup':
      return `${GREEN}${BOLD}LEVEL UP! Now level ${ev.level}${RESET}`;
    case 'virtualLevelUp':
      return `${MAGENTA}Virtual level: ${ev.level}${RESET}`;
    case 'loot':
      return `${YELLOW}Loot: ${ev.text}${RESET}`;
    case 'death':
      return `${RED}Death (entity ${ev.entityId}, killer ${ev.killerId})${RESET}`;
    case 'lootRoll':
      return `${YELLOW}Roll ${ev.rollId}: ${ev.itemName} (${ev.quality})${RESET}`;
    case 'questAccepted':
      return `${GREEN}Quest accepted: ${ev.questId}${RESET}`;
    case 'questProgress':
      return `${CYAN}Quest ${ev.questId}: ${ev.current}/${ev.required}${RESET}`;
    case 'questReady':
      return `${GREEN}${BOLD}Quest ready: ${ev.questId}${RESET}`;
    case 'questDone':
      return `${GREEN}${BOLD}Quest completed: ${ev.questId}${RESET}`;
    case 'learnAbility':
      return `${MAGENTA}Learned: ${ev.abilityId} (rank ${ev.rank})${RESET}`;
    case 'deedUnlocked':
      return `${MAGENTA}Deed unlocked: ${ev.deedId}${ev.retro ? ' (retro)' : ''}${RESET}`;
    default:
      return null;
  }
}

// -------------------------------------------------------------------------
// One-line summary
// -------------------------------------------------------------------------

function debugTargetInfo(engine: IdleEngine): string {
  const p = engine.sim.player;
  const target = p.targetId !== null ? (engine.sim.entities.get(p.targetId) ?? null) : null;
  if (!target) return 'no target';
  const d = Math.hypot(p.pos.x - target.pos.x, p.pos.z - target.pos.z);
  return `target: ${target.templateId || 'e' + target.id} Lv${target.level} HP${target.hp}/${target.maxHp} dist${d.toFixed(1)} auto${p.autoAttack ? 'Y' : 'N'}`;
}

function printSummary(sum: IdleStepSummary, engine: IdleEngine): void {
  const highlightLines: string[] = [];
  for (const ev of sum.events) {
    const line = highlightSimEvent(ev, engine);
    if (line) highlightLines.push(line);
  }
  // One-liner.
  const line = [
    `${BOLD}Lv${sum.level}${RESET}`,
    `XP ${sum.xpGained > 0 ? GREEN + '+' + sum.xpGained + RESET : DIM + '-' + RESET}`,
    `Kills ${sum.kills}`,
    `Gold ${sum.copper}c`,
    `HP ${sum.hp}/${sum.maxHp}${sum.dead ? RED + ' DEAD' + RESET : ''}`,
    `Δ ${sum.deltaSeconds.toFixed(1)}s`,
  ].join(' | ');
  console.log(line);
  // Debug: show target info every 3 steps.
  console.log(`  ${DIM}${debugTargetInfo(engine)}${RESET}`);

  // Highlighted events (max 5 per step to avoid spam).
  const shown = highlightLines.slice(0, 5);
  for (const hl of shown) {
    console.log(`  ${hl}`);
  }
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------

function main(): void {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!ALL_CLASSES.includes(args.playerClass as any)) {
    console.error(`Unknown class "${args.playerClass}". Valid: ${ALL_CLASSES.join(', ')}`);
    process.exit(1);
  }

  const opts: IdleEngineOptions = {
    seed: args.seed,
    playerClass: args.playerClass as any,
    frameSkip: args.speed,
    saveDir: args.saveDir,
    playerName: 'IdleHero',
    playerLevel: args.level,
  };

  const engine = new IdleEngine(opts);
  const startTime = Date.now();
  let stepCount = 0;

  // Debug: count entities on startup
  let mobCount = 0,
    npcCount = 0;
  for (const [, e] of engine.sim.entities) {
    if (e.kind === 'mob') mobCount++;
    else if (e.kind === 'npc') npcCount++;
  }
  const p = engine.sim.player;

  // Check first targetable mobs near the player
  let nearMobs = 0,
    firstMob = '';
  for (const [, e] of engine.sim.entities) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
    if (d < 50) {
      nearMobs++;
      if (!firstMob) firstMob = `${e.templateId || '?'} (Lv${e.level}) @ ${d.toFixed(0)}yd`;
    }
  }
  const msg = [
    `Idle Classic started, ${opts.playerClass} @ seed ${opts.seed}`,
    `  speed: ${opts.frameSkip} ticks/step (${(opts.frameSkip! * 0.05).toFixed(1)} sim-sec/step)`,
    `  saves: ${opts.saveDir}`,
    `  world: ${mobCount} mobs, ${npcCount} NPCs, ${engine.sim.entities.size} total`,
    `  player: pos(${p.pos.x.toFixed(0)}, ${p.pos.z.toFixed(0)}) HP ${p.hp}/${p.maxHp}`,
    `  mobs within 50yd: ${nearMobs}${firstMob ? ' (closest: ' + firstMob + ')' : ''}`,
  ].join('\n');
  console.log(msg);
  console.log('---');

  // Print the first summary immediately.
  const first = engine.step(1000);
  stepCount++;
  printSummary(first, engine);

  // Then every ~1 real-second.
  const interval = setInterval(() => {
    const sum = engine.step(1000);
    stepCount++;
    printSummary(sum, engine);

    // Save every 10 steps.
    if (stepCount % 10 === 0) {
      engine.save(opts.saveDir);
    }
  }, 1000);

  // Graceful shutdown.
  const shutdown = () => {
    clearInterval(interval);
    engine.save(opts.saveDir);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nShutdown after ${elapsed}s, ${stepCount} steps. Saved.`);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
}

main();
