// Build the trusted, static Codex PR-review harness used by pr-ai.yml.
//
// `resolve` validates the GitHub event and records only bounded review context.
// `build` verifies the nested PR checkout, snapshots policy from the trusted base
// checkout, and writes a prompt outside the untrusted repository. It never executes
// code, hooks, package managers, or tools from the pull request.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_RE = /^[0-9a-f]{40}$/;
const ID_RE = /^[1-9][0-9]*$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ACTOR_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const WRITE_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const MAX_FOCUS_CHARS = 2_000;

function required(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing ${label}`);
  return value;
}

function validateSha(value, label) {
  const text = String(value ?? '');
  if (!SHA_RE.test(text)) throw new Error(`Invalid ${label}`);
  return text;
}

function validateId(value, label) {
  const text = String(value ?? '');
  if (!ID_RE.test(text)) throw new Error(`Invalid ${label}`);
  return text;
}

function validateRepo(value) {
  const text = String(value ?? '');
  if (!REPO_RE.test(text)) throw new Error('Invalid repository');
  return text;
}

function validateActor(value) {
  const text = String(value ?? '');
  if (!ACTOR_RE.test(text)) throw new Error('Invalid request actor');
  return text;
}

function isForbiddenControl(character) {
  const code = character.codePointAt(0) ?? 0;
  return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
}

function sanitizeFocus(value) {
  return [...String(value ?? '')]
    .filter((character) => !isForbiddenControl(character))
    .join('')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
    .slice(0, MAX_FOCUS_CHARS);
}

export function parseReviewCommand(body) {
  const text = String(body ?? '').trim();
  if (text === '/review') return { command: 'review', focus: '' };
  const match = /^\/suggest[ \t]+([\s\S]+)$/.exec(text);
  if (!match) return null;
  const focus = sanitizeFocus(match[1]);
  return focus ? { command: 'suggest', focus } : null;
}

function validateContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid review context');
  }
  const mode = value.mode;
  if (mode !== 'automatic' && mode !== 'requested') throw new Error('Invalid review mode');
  const context = {
    mode,
    repository: validateRepo(value.repository),
    prNumber: validateId(value.prNumber, 'PR number'),
    baseSha: validateSha(value.baseSha, 'base SHA'),
    headSha: validateSha(value.headSha, 'head SHA'),
    requestCommentId: '',
    requestActor: '',
    focus: '',
  };
  if (mode === 'requested') {
    context.requestCommentId = validateId(value.requestCommentId, 'request comment id');
    context.requestActor = validateActor(value.requestActor);
    context.focus = sanitizeFocus(value.focus);
  }
  return context;
}

export function contextFromPullRequestEvent(event, repository) {
  const repo = validateRepo(repository);
  const pr = event?.pull_request;
  if (!pr || pr.head?.repo?.full_name !== repo || pr.base?.repo?.full_name !== repo) {
    throw new Error('Automatic reviews require a same-repository pull request');
  }
  return validateContext({
    mode: 'automatic',
    repository: repo,
    prNumber: event.number,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
  });
}

async function fetchPullRequest(apiUrl, repository, prNumber, token) {
  const response = await fetch(`${apiUrl}/repos/${repository}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub PR lookup failed with HTTP ${response.status}`);
  return response.json();
}

async function resolveEvent(event, env) {
  const repository = validateRepo(env.AI_REVIEW_REPOSITORY);
  if (event.pull_request) return contextFromPullRequestEvent(event, repository);

  if (!event.issue?.pull_request || !event.comment)
    throw new Error('Event is not a PR review request');
  if (!WRITE_ASSOCIATIONS.has(event.comment.author_association)) {
    throw new Error('Review requester lacks a trusted repository association');
  }
  const command = parseReviewCommand(event.comment.body);
  if (!command) throw new Error('Comment is not an exact /review or /suggest command');

  const prNumber = validateId(event.issue.number, 'PR number');
  const apiUrl = required(env.AI_REVIEW_API_URL, 'GitHub API URL').replace(/\/$/, '');
  const token = required(env.AI_REVIEW_TOKEN, 'GitHub token');
  const pr = await fetchPullRequest(apiUrl, repository, prNumber, token);
  if (pr.state !== 'open' || pr.base?.repo?.full_name !== repository) {
    throw new Error('Review request does not target an open PR in this repository');
  }

  return validateContext({
    mode: 'requested',
    repository,
    prNumber,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    requestCommentId: event.comment.id,
    requestActor: event.comment.user?.login,
    focus: command.focus,
  });
}

function writeActionsOutput(file, values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

async function resolveCommand(env) {
  const eventPath = required(env.AI_REVIEW_EVENT_PATH, 'event path');
  const contextFile = required(env.AI_REVIEW_CONTEXT_FILE, 'context file');
  const outputFile = required(env.GITHUB_OUTPUT, 'GITHUB_OUTPUT');
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const context = await resolveEvent(event, env);

  fs.mkdirSync(path.dirname(contextFile), { recursive: true });
  fs.writeFileSync(contextFile, `${JSON.stringify(context)}\n`, { mode: 0o600 });
  fs.chmodSync(contextFile, 0o600);
  writeActionsOutput(outputFile, {
    pr_number: context.prNumber,
    base_sha: context.baseSha,
    head_sha: context.headSha,
    review_mode: context.mode,
    request_comment_id: context.requestCommentId,
    request_actor: context.requestActor,
  });
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertNoSymlink(target, label, anchor = target) {
  const resolved = path.resolve(target);
  const resolvedAnchor = path.resolve(anchor);
  if (!isWithin(resolvedAnchor, resolved)) throw new Error(`${label} escapes its trusted anchor`);
  let cursor = resolvedAnchor;
  const parts = path.relative(resolvedAnchor, resolved).split(path.sep).filter(Boolean);
  for (const part of ['', ...parts]) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`${label} contains a symlink`);
    }
  }
}

function git(prDir, args, options = {}) {
  const result = spawnSync('git', ['-C', prDir, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`Git verification failed: git ${args.join(' ')}`);
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function normalizeOrigin(origin) {
  return origin.trim().replace(/\.git$/, '');
}

function localClaudePaths(changedPaths, policyDir) {
  const candidates = new Set();
  for (const changed of changedPaths) {
    if (!changed || changed.includes('\0') || path.posix.isAbsolute(changed)) continue;
    const normalized = path.posix.normalize(changed);
    if (normalized === '..' || normalized.startsWith('../')) continue;
    let dir = path.posix.dirname(normalized);
    while (dir && dir !== '.') {
      candidates.add(`${dir}/CLAUDE.md`);
      dir = path.posix.dirname(dir);
    }
  }
  return [...candidates].filter((relative) => fs.existsSync(path.join(policyDir, relative))).sort();
}

function snapshotPolicy(policyDir, outputDir, changedPaths) {
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const sources = ['AGENTS.md', 'CLAUDE.md', ...localClaudePaths(changedPaths, policyDir)];
  const entries = [];
  for (const [index, relative] of sources.entries()) {
    const source = path.resolve(policyDir, relative);
    if (!isWithin(policyDir, source) || !fs.existsSync(source)) continue;
    const outputName = `policy-${String(index + 1).padStart(2, '0')}.txt`;
    const body = fs.readFileSync(source, 'utf8');
    fs.writeFileSync(path.join(outputDir, outputName), `SOURCE: ${relative}\n\n${body}`, {
      mode: 0o600,
    });
    entries.push({ source: relative, file: `trusted-policy/${outputName}` });
  }
  fs.writeFileSync(
    path.join(outputDir, 'index.txt'),
    `${entries.map((entry) => `${entry.file} <- ${entry.source}`).join('\n')}\n`,
    { mode: 0o600 },
  );
  return entries;
}

export function renderReviewPrompt(template, values) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_token, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Review prompt has unresolved token ${key}`);
    return String(values[key]);
  });
}

export function buildReviewHarness(env) {
  const contextFile = required(env.AI_REVIEW_CONTEXT_FILE, 'context file');
  const context = validateContext(JSON.parse(fs.readFileSync(contextFile, 'utf8')));
  const prDir = path.resolve(required(env.AI_REVIEW_PR_DIR, 'PR directory'));
  const harnessDir = path.resolve(required(env.AI_REVIEW_HARNESS_DIR, 'harness directory'));
  const trustedDir = path.resolve(required(env.AI_REVIEW_TRUSTED_DIR, 'trusted directory'));
  const policyDir = path.resolve(required(env.AI_REVIEW_POLICY_DIR, 'policy directory'));
  const codexHome = path.resolve(required(env.AI_REVIEW_CODEX_HOME, 'Codex home'));
  const untrustedRoot = path.join(harnessDir, 'untrusted');

  if (!isWithin(untrustedRoot, prDir))
    throw new Error('PR checkout must be below review/untrusted');
  if (isWithin(untrustedRoot, trustedDir) || isWithin(untrustedRoot, policyDir)) {
    throw new Error('Trusted inputs cannot be inside the untrusted tree');
  }
  for (const [target, label, anchor] of [
    [harnessDir, 'harness path', harnessDir],
    [prDir, 'PR path', harnessDir],
    [trustedDir, 'trusted path', trustedDir],
    [policyDir, 'policy path', policyDir],
    [codexHome, 'Codex home', codexHome],
  ]) {
    assertNoSymlink(target, label, anchor);
  }

  const head = git(prDir, ['rev-parse', 'HEAD']).stdout.trim();
  if (head !== context.headSha) throw new Error('Checked-out PR head does not match the event');
  git(prDir, ['cat-file', '-e', `${context.baseSha}^{commit}`]);
  git(prDir, ['cat-file', '-e', `${context.headSha}^{commit}`]);
  const mergeBase = validateSha(
    git(prDir, ['merge-base', context.baseSha, context.headSha]).stdout.trim(),
    'merge base',
  );

  const origin = normalizeOrigin(git(prDir, ['remote', 'get-url', 'origin']).stdout);
  const expectedOrigin = `https://github.com/${context.repository}`;
  if (origin.toLowerCase() !== expectedOrigin.toLowerCase()) {
    throw new Error('PR checkout origin is unexpected or credential-bearing');
  }
  const extraHeader = git(prDir, ['config', '--local', '--get-regexp', '^http'], {
    allowFailure: true,
  });
  if (extraHeader.status === 0 && extraHeader.stdout.trim()) {
    throw new Error('Checkout credentials remain in PR Git configuration');
  }

  const changedRaw = git(prDir, [
    'diff',
    '--name-only',
    '-z',
    '--diff-filter=ACDMRTUXB',
    mergeBase,
    context.headSha,
  ]).stdout;
  const changedPaths = changedRaw.split('\0').filter(Boolean);
  if (changedPaths.length === 0) throw new Error('Pull request has no changed files');

  const policyOutput = path.join(harnessDir, 'trusted-policy');
  const policyEntries = snapshotPolicy(policyDir, policyOutput, changedPaths);
  if (!policyEntries.some((entry) => entry.source === 'CLAUDE.md')) {
    throw new Error('Trusted base policy is missing the root CLAUDE.md');
  }
  const templatePath = path.join(trustedDir, '.github/codex/prompts/pr-review.md');
  const template = fs.readFileSync(templatePath, 'utf8');
  const focus = context.focus
    ? context.focus
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    : '> No additional emphasis was requested.';
  const prompt = renderReviewPrompt(template, {
    PR_NUMBER: context.prNumber,
    BASE_SHA: context.baseSha,
    MERGE_BASE: mergeBase,
    HEAD_SHA: context.headSha,
    REVIEW_MODE: context.mode,
    CHANGED_COUNT: changedPaths.length,
    POLICY_FILES: policyEntries.map((entry) => `- ${entry.file} from ${entry.source}`).join('\n'),
    REQUESTED_FOCUS: focus,
  });
  fs.writeFileSync(path.join(harnessDir, 'review-prompt.md'), prompt, { mode: 0o600 });

  fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  fs.chmodSync(codexHome, 0o700);
  if (fs.readdirSync(codexHome).length !== 0) throw new Error('Codex home must start empty');
  console.log(`Prepared static review for PR #${context.prNumber}: ${changedPaths.length} files`);
}

async function main() {
  const command = process.argv[2];
  if (command === 'resolve') await resolveCommand(process.env);
  else if (command === 'build') buildReviewHarness(process.env);
  else throw new Error('Usage: prepare_ai_review.mjs <resolve|build>');
}

const INVOKED_AS_SCRIPT =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOKED_AS_SCRIPT) {
  main().catch((error) => {
    console.error(`[prepare_ai_review] ${error.message}`);
    process.exitCode = 1;
  });
}
