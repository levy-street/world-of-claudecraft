// Launch an RL training run shaped by a reward_policy.json the agent authored.
// This is the meta-loop entry: the LLM agent edits reward_policy.json, runs this,
// then rl/evaluate.mjs scores the result and the agent iterates.
//
// It writes the reward policy where the env can read it and spawns the Python
// trainer (python/wow_env.py). The example runner is a random agent; swap in a
// PPO trainer (stable-baselines3) at TRAIN_CMD for real learning.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const policyPath = process.argv[2] || join(HERE, 'reward_policy.json');
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));

mkdirSync(join(HERE, 'runs'), { recursive: true });
const runId = `run-${policy.player_class}-${policy.curriculum?.[0]?.stage ?? 'flat'}`;
// the python env reads WOC_REWARD_POLICY to override env.reset() rewards/config
const env = { ...process.env, WOC_REWARD_POLICY: JSON.stringify(policy) };

// Default: the bundled example agent (sanity). Real training: set TRAIN_CMD to a
// PPO script, e.g. TRAIN_CMD="python3 python/train_ppo.py --timesteps 1e6".
// Default = dependency-free Node baseline harness (runs now, no python/torch).
// Real PPO: TRAIN_CMD="python3 python/train_agent.py <policy>" after `pip install gymnasium stable-baselines3 torch`.
const cmd = process.env.TRAIN_CMD || `node scripts/agent/rl/run_env.mjs ${policyPath}`;
console.log(`[train] ${runId}\n[train] policy: ${policyPath}\n[train] cmd: ${cmd}`);
console.log('[train] (build the env first: npm run env  — headless/env_server.ts)');

const child = spawn(cmd, { cwd: REPO, env, shell: true, stdio: ['inherit', 'pipe', 'inherit'] });
let tail = '';
child.stdout.on('data', (d) => { tail += d; process.stdout.write(d); });
child.on('exit', (code) => {
  writeFileSync(join(HERE, 'runs', `${runId}.json`),
    JSON.stringify({ runId, policyPath, cmd, exit: code, at: Date.now(), tail: tail.slice(-2000) }, null, 2));
  console.log(`[train] exit ${code} → runs/${runId}.json`);
});
