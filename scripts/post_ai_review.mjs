// Validate and post structured Codex review output from a fresh GitHub Actions job.
// This process receives a GitHub posting token but never receives the OpenAI credential.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertStickyComment } from './gh_sticky_comment.mjs';
import { redactSecrets } from './redact_secrets.mjs';

const ASSESSMENTS = new Set(['looks_correct', 'needs_changes', 'blocked']);
const SEVERITIES = new Set(['high', 'medium', 'low']);
const CATEGORIES = new Set(['correctness', 'security', 'invariants', 'tests', 'maintainability']);
const ID_RE = /^[1-9][0-9]*$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ACTOR_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const MAX_OUTPUT_CHARS = 100_000;
export const MAX_COMMENT_BYTES = 60_000;
const COMMENT_FOOTER =
  '<sub>Automated, static, and non-blocking. No PR code was executed; CI remains authoritative.</sub>';

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unexpected fields`);
  }
}

function boundedText(value, maxLength, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid ${label}`);
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      throw new Error(`${label} contains control characters`);
    }
  }
  return value;
}

export function validateReview(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Review output must be an object');
  }
  exactKeys(value, ['assessment', 'summary', 'findings'], 'Review output');
  if (!ASSESSMENTS.has(value.assessment)) throw new Error('Invalid review assessment');
  const summary = boundedText(value.summary, 2_000, 'review summary');
  if (!Array.isArray(value.findings) || value.findings.length > 20) {
    throw new Error('Invalid review findings');
  }

  const findings = value.findings.map((finding, index) => {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
      throw new Error(`Finding ${index + 1} must be an object`);
    }
    exactKeys(
      finding,
      ['severity', 'category', 'path', 'line', 'message', 'recommendation'],
      `Finding ${index + 1}`,
    );
    if (!SEVERITIES.has(finding.severity)) throw new Error(`Invalid finding ${index + 1} severity`);
    if (!CATEGORIES.has(finding.category)) throw new Error(`Invalid finding ${index + 1} category`);
    if (finding.line !== null && (!Number.isInteger(finding.line) || finding.line < 1)) {
      throw new Error(`Invalid finding ${index + 1} line`);
    }
    return {
      severity: finding.severity,
      category: finding.category,
      path: boundedText(finding.path, 500, `finding ${index + 1} path`),
      line: finding.line,
      message: boundedText(finding.message, 2_000, `finding ${index + 1} message`),
      recommendation: boundedText(
        finding.recommendation,
        1_000,
        `finding ${index + 1} recommendation`,
      ),
    };
  });
  return { assessment: value.assessment, summary, findings };
}

function markdownText(value) {
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;')
    .replace(/\bhttps?:\/\//gi, (url) => url.replace(':', '&#58;'))
    .replace(/([\\`*_[\]])/g, '\\$1');
}

function inlinePath(value) {
  return value.replace(/`/g, "'").replace(/\s+/g, ' ').trim();
}

export function renderReview(review, requestActor = '') {
  const labels = {
    looks_correct: 'Looks correct',
    needs_changes: 'Needs changes',
    blocked: 'Blocked',
  };
  const lines = [
    '## AI review',
    '',
    `**Assessment:** ${labels[review.assessment]}`,
    '',
    markdownText(review.summary),
  ];
  if (requestActor) lines.push('', `Requested by @${requestActor}.`);

  if (review.findings.length > 0) {
    lines.push('', '### Findings', '');
    for (let index = 0; index < review.findings.length; index++) {
      const finding = review.findings[index];
      const location = finding.line === null ? finding.path : `${finding.path}:${finding.line}`;
      const item = [
        `- **${finding.severity.toUpperCase()} | ${finding.category}** \`${inlinePath(location)}\`: ${markdownText(finding.message)}`,
        `  - Recommendation: ${markdownText(finding.recommendation)}`,
      ];
      const omittedAfter = review.findings.length - index - 1;
      const trial = [...lines, ...item];
      if (omittedAfter > 0) {
        trial.push('', `_${omittedAfter} additional findings omitted to fit the comment limit._`);
      }
      trial.push('', COMMENT_FOOTER);
      if (Buffer.byteLength(trial.join('\n'), 'utf8') > MAX_COMMENT_BYTES) {
        const omitted = review.findings.length - index;
        lines.push('', `_${omitted} additional findings omitted to fit the comment limit._`);
        break;
      }
      lines.push(...item);
    }
  } else {
    lines.push('', 'No actionable findings were identified by the static review.');
  }

  lines.push('', COMMENT_FOOTER);
  const rendered = lines.join('\n');
  if (Buffer.byteLength(rendered, 'utf8') > MAX_COMMENT_BYTES) {
    throw new Error('Rendered review exceeds the GitHub comment limit');
  }
  return rendered;
}

function validatePostContext(env) {
  const repository = String(env.GITHUB_REPOSITORY ?? '');
  const prNumber = String(env.AI_REVIEW_PR_NUMBER ?? '');
  const mode = String(env.AI_REVIEW_MODE ?? '');
  if (!REPO_RE.test(repository)) throw new Error('Invalid posting repository');
  if (!ID_RE.test(prNumber)) throw new Error('Invalid posting PR number');
  if (mode !== 'automatic' && mode !== 'requested') throw new Error('Invalid posting mode');

  let commentId = '';
  let actor = '';
  if (mode === 'requested') {
    commentId = String(env.AI_REVIEW_REQUEST_COMMENT_ID ?? '');
    actor = String(env.AI_REVIEW_REQUEST_ACTOR ?? '');
    if (!ID_RE.test(commentId) || !ACTOR_RE.test(actor)) {
      throw new Error('Invalid requested-review context');
    }
  }
  return { repository, prNumber, mode, commentId, actor };
}

async function post(env) {
  const context = validatePostContext(env);
  const outcome = String(env.AI_REVIEW_CODEX_OUTCOME ?? '');
  const raw = String(env.AI_REVIEW_FINAL_JSON ?? '');
  let body;

  if (outcome !== 'success' || !raw || raw.length > MAX_OUTPUT_CHARS) {
    body = [
      '## AI review',
      '',
      'The automated static review did not produce valid output. This is non-blocking; use the normal CI results and human review.',
      '',
      '<sub>No PR code was executed by the reviewer.</sub>',
    ].join('\n');
  } else {
    try {
      body = renderReview(validateReview(JSON.parse(raw)), context.actor);
    } catch {
      body = [
        '## AI review',
        '',
        'The automated static review returned malformed output, so no model-generated feedback was posted. This is non-blocking.',
        '',
        '<sub>No PR code was executed by the reviewer.</sub>',
      ].join('\n');
    }
  }

  const token = env.GITHUB_TOKEN;
  const redacted = redactSecrets(body, token ? [token] : []).text;
  const marker =
    context.mode === 'automatic'
      ? '<!-- pr-ai-review -->'
      : `<!-- pr-ai-review-comment-${context.commentId} -->`;
  const result = await upsertStickyComment({
    marker,
    body: redacted,
    prNumber: context.prNumber,
    token,
    repo: context.repository,
  });
  console.log(`AI review comment: ${result ?? 'skipped'}`);
}

const INVOKED_AS_SCRIPT =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOKED_AS_SCRIPT) {
  post(process.env).catch((error) => {
    console.log(`[post_ai_review] could not post non-blocking review: ${error.message}`);
  });
}
