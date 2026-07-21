// Posts (or updates) a sticky PR comment that EMBEDS the screenshots pr_screenshots.mjs
// captured, inline, so a reviewer sees them without downloading anything. The PNGs are
// uploaded to a bot-owned orphan branch (gh_image_host.mjs) and referenced by their raw
// URL. Best-effort and non-blocking: it never fails the job.
//
// When the capture step found no visual change (nothing captured), it posts nothing on a
// fresh PR, and flips an existing screenshot comment to a short "no visual changes" note
// so a stale gallery never lingers after a later non-visual push.
//
// Env (set by the workflow):
//   GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER   standard Actions context (token needs
//                                                contents:write to host the images)
//   GITHUB_RUN_ID   run id, used to key the uploaded image paths (optional)
//   SHOTS_DIR       directory holding manifest.json + the PNGs (default pr-shots)
import fs from 'node:fs';
import { uploadScreenshots } from './gh_image_host.mjs';
import { upsertStickyComment } from './gh_sticky_comment.mjs';

const MARKER = '<!-- pr-ai-screenshots -->';
const OUT = process.env.SHOTS_DIR ?? 'pr-shots';
const prNumber = process.env.PR_NUMBER;
// Key hosted image paths by run id AND attempt: GITHUB_RUN_ID is stable across re-runs,
// and a Contents-API PUT to an existing path without its sha fails with 422, which would
// silently drop every image on a re-run. The attempt suffix keeps each upload path fresh.
// (Both are default Actions env vars; no workflow wiring needed.)
const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
const runId = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_RUN_ID}${runAttempt ? `-${runAttempt}` : ''}`
  : undefined;

let manifest = { mode: 'no-visual', captured: [], errors: [] };
try {
  manifest = JSON.parse(fs.readFileSync(`${OUT}/manifest.json`, 'utf8'));
} catch {
  // No manifest means the capture step did not run or produced nothing.
}

// Turn a captured file name into a readable caption ("01-hud-desktop.png" -> "hud desktop").
function caption(file) {
  return file
    .replace(/\.png$/i, '')
    .replace(/^\d+-/, '')
    .replace(/[-_]/g, ' ');
}

const notes = manifest.errors?.length
  ? `<details><summary>Capture notes (${manifest.errors.length})</summary>\n\n\`\`\`\n${manifest.errors.join('\n')}\n\`\`\`\n\n</details>`
  : '';

async function run() {
  // No frames: do not spam a plain PR, but correct a prior gallery if one exists.
  if (!manifest.captured?.length) {
    const body = [
      '## Screenshots of this change',
      '',
      'No visual changes detected in the latest commit, so no screenshots were captured.',
      '',
      '<sub>Automated, non-blocking. Shots are taken only for changes to the renderer, HUD/UI, styles, or client controls.</sub>',
    ].join('\n');
    const result = await upsertStickyComment({ marker: MARKER, body, prNumber, updateOnly: true });
    console.log(`screenshot comment: ${result ?? 'skipped (no visual change, no prior comment)'}`);
    return;
  }

  // Host the images, then embed whatever uploaded successfully.
  const uploaded = await uploadScreenshots({
    files: manifest.captured,
    readFile: (name) => fs.readFileSync(`${OUT}/${name}`),
    prNumber,
    runId,
  });

  let gallery;
  if (uploaded.length) {
    gallery = uploaded
      .map((u) => `**${caption(u.name)}**\n\n![${caption(u.name)}](${u.url})`)
      .join('\n\n');
  } else {
    // Upload path unavailable (for example a fork PR's read-only token): degrade to a note
    // rather than posting broken image links.
    gallery = '_Screenshots were captured but could not be hosted for inline embedding._';
  }

  const body = [
    '## Screenshots of this change',
    '',
    gallery,
    '',
    notes,
    '',
    '<sub>Automated, non-blocking. Offline client render of the sections this diff touches.</sub>',
  ]
    .filter((l) => l !== '')
    .join('\n');

  const result = await upsertStickyComment({ marker: MARKER, body, prNumber });
  console.log(`screenshot comment: ${result ?? 'skipped'}`);
}

try {
  await run();
} catch (e) {
  // Non-blocking: a comment failure must not fail the screenshots job.
  console.log(`screenshot comment failed (non-blocking): ${e.message}`);
}
