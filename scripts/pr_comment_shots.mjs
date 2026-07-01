// Posts (or updates) a sticky PR comment pointing at the screenshot artifact produced
// by pr_screenshots.mjs. GitHub Actions artifacts are not directly embeddable as images
// in a comment, so this links the downloadable artifact and lists which frames it holds.
// Best-effort and non-blocking: it never fails the job.
//
// Env (set by the workflow):
//   GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER   standard Actions context
//   ARTIFACT_URL   download URL of the uploaded screenshots artifact (optional)
//   RUN_URL        link to the workflow run (fallback when ARTIFACT_URL is absent)
//   SHOTS_DIR      directory holding manifest.json (default pr-shots)
import fs from 'node:fs';
import { upsertStickyComment } from './gh_sticky_comment.mjs';

const MARKER = '<!-- pr-ai-screenshots -->';
const OUT = process.env.SHOTS_DIR ?? 'pr-shots';
const prNumber = process.env.PR_NUMBER;

let manifest = { captured: [], errors: [] };
try {
  manifest = JSON.parse(fs.readFileSync(`${OUT}/manifest.json`, 'utf8'));
} catch {
  // No manifest means the capture step did not run or produced nothing.
}

const artifact = process.env.ARTIFACT_URL || process.env.RUN_URL || '';
const list = manifest.captured.length
  ? manifest.captured.map((f) => `- \`${f}\``).join('\n')
  : '_No screenshots were captured for this run._';

const body = [
  '## Screenshots of this change',
  '',
  artifact
    ? `Download the rendered client screenshots: [**pr-screenshots** artifact](${artifact})`
    : 'Screenshots were captured but no artifact link was available.',
  '',
  '<details><summary>Captured frames</summary>',
  '',
  list,
  '',
  '</details>',
  '',
  manifest.errors?.length
    ? `<details><summary>Capture notes (${manifest.errors.length})</summary>\n\n\`\`\`\n${manifest.errors.join('\n')}\n\`\`\`\n\n</details>`
    : '',
  '',
  '<sub>Automated, non-blocking. Offline client tour (character select, desktop HUD, mobile HUD).</sub>',
]
  .filter((l) => l !== null)
  .join('\n');

try {
  const result = await upsertStickyComment({ marker: MARKER, body, prNumber });
  console.log(`screenshot comment: ${result ?? 'skipped'}`);
} catch (e) {
  // Non-blocking: a comment failure must not fail the screenshots job.
  console.log(`screenshot comment failed (non-blocking): ${e.message}`);
}
