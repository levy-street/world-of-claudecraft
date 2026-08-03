// Lifecycle pretest for `npm test`: regenerate i18n + wiki artifacts that the
// suite and S3/guide guards require. When the full local gate has already run
// generate-once (i18n:gen, freshness, wiki:content), it sets WOC_SKIP_PRETEST=1
// so a single gate run does not pay for the same gens again. Standalone
// `npm test` never sets that env and always regenerates.
import { spawnSync } from 'node:child_process';
import { shouldSkipPretest } from './lib/gate_artifact_skip.mjs';

// npm/npx resolve to .cmd files on Windows; spawnSync needs a shell there.
const shell = process.platform === 'win32';

if (shouldSkipPretest(process.env)) {
  console.log('[pretest] skip: WOC_SKIP_PRETEST=1 (gate already generated i18n + wiki)');
  process.exit(0);
}

// Same composition as the historical package.json pretest chain:
// i18n:build + i18n:admin + i18n:scan + wiki:content, via the i18n:gen alias.
const steps = [
  ['npm', ['run', 'i18n:gen']],
  ['npm', ['run', 'wiki:content']],
];

for (const [cmd, args] of steps) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell, env: process.env });
  if (res.error) {
    console.error(`[pretest] failed to spawn ${cmd}: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}
