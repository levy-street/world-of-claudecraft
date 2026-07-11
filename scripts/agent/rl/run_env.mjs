// Dependency-free mage RL harness: drives dist-env/env_server.cjs over NDJSON with
// a scripted baseline policy and the reward shaping from a reward_policy.json. Proves
// the whole training loop runs (env + rewards + episode resets) with NO python/torch.
// Use it as the baseline a learned PPO policy (python/train_agent.py) must beat.
//   node scripts/agent/rl/run_env.mjs [reward_policy.mage.json]   (STEPS=3000 env override)
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const policyPath = process.argv[2] || join(HERE, 'reward_policy.mage.json');
const pol = JSON.parse(readFileSync(policyPath, 'utf8'));
const STEPS = Number(process.env.STEPS || 3000);
const SERVER = join(REPO, 'dist-env', 'env_server.cjs');

const proc = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'ignore'] });
const rl = createInterface({ input: proc.stdout, terminal: false });
const waiters = [];
rl.on('line', (line) => { const w = waiters.shift(); if (w) w(JSON.parse(line)); });
const req = (msg) => new Promise((res) => { waiters.push(res); proc.stdin.write(JSON.stringify(msg) + '\n'); });

const A = {}; // action-name → index
(async () => {
  const meta = await req({ cmd: 'info' });
  meta.actions.forEach((n, i) => { A[n] = i; });
  const abilities = meta.actions.filter((n) => n.startsWith('ability_')).map((n) => A[n]);
  await req({ cmd: 'reset', seed: 7, player_class: pol.player_class || 'mage',
    config: { frameSkip: pol.frameSkip ?? 5, maxSteps: pol.maxSteps ?? 8000, rewards: pol.rewards } });

  // scripted baseline: keep a target, attack, weave abilities, else advance to find mobs
  let total = 0, episodes = 0, info = {}, abi = 0;
  for (let s = 0; s < STEPS; s++) {
    // cast-from-range baseline: re-target periodically, attack, weave abilities,
    // only nudge forward occasionally (a mage that stands and casts survives far
    // better than one that marches into melee). Still untrained — PPO should beat it.
    let action; const m = s % 20;
    if (m === 0) action = A.target_nearest;
    else if (m === 1) action = A.attack;
    else if (m % 5 === 0) action = A.forward;
    else action = abilities.length ? abilities[abi++ % abilities.length] : A.attack;
    const r = await req({ cmd: 'step', action });
    total += r.reward; info = r.info ?? info;
    if (r.terminated || r.truncated) { episodes++; await req({ cmd: 'reset', seed: 7 + episodes, player_class: pol.player_class || 'mage', config: { frameSkip: pol.frameSkip ?? 5, maxSteps: pol.maxSteps ?? 8000, rewards: pol.rewards } }); }
  }
  proc.kill();
  mkdirSync(join(HERE, 'runs'), { recursive: true });
  const out = { runId: `baseline-${pol.player_class}`, policy: policyPath, steps: STEPS, episodes,
    totalReward: Math.round(total * 100) / 100, final: info, at: Date.now(), kind: 'scripted-baseline' };
  writeFileSync(join(HERE, 'runs', `baseline-${pol.player_class}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
