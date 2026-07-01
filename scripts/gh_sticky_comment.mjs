// Shared helper: post or update a single "sticky" comment on a pull request via the
// GitHub REST API. A sticky comment carries a hidden HTML marker so reruns edit the
// same comment instead of stacking a new one every push. Used by the PR-assist jobs
// (ai_review.mjs, pr_comment_shots.mjs). No npm deps: Node 18+ global fetch only.
//
// Auth + target come from the standard GitHub Actions environment:
//   GITHUB_TOKEN       token with pull-requests:write (the default Actions token)
//   GITHUB_REPOSITORY  owner/repo
//   GITHUB_API_URL     API base (defaults to https://api.github.com)
// The PR number is passed in by the caller.

const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

// Upsert a sticky comment. Returns 'created' | 'updated', or null when it could not
// post (no token, no PR number, or a non-write token, e.g. a fork PR). Never throws on
// a missing token so callers can stay non-blocking; real API errors do throw.
export async function upsertStickyComment({ marker, body, prNumber, token, repo }) {
  token = token ?? process.env.GITHUB_TOKEN;
  repo = repo ?? process.env.GITHUB_REPOSITORY;
  if (!token || !repo || !prNumber) {
    console.log('[gh_sticky_comment] missing token/repo/prNumber; skipping comment.');
    return null;
  }
  const fullBody = `${marker}\n${body}`;
  const headers = ghHeaders(token);

  // Find an existing sticky comment by its marker (first page is plenty for a PR).
  const listUrl = `${API}/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
  const listRes = await fetch(listUrl, { headers });
  if (!listRes.ok) {
    // A read-only token (fork PR) typically 403s here; degrade gracefully.
    console.log(`[gh_sticky_comment] cannot list comments (HTTP ${listRes.status}); skipping.`);
    return null;
  }
  const comments = await listRes.json();
  const existing = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker));

  if (existing) {
    const res = await fetch(`${API}/repos/${repo}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body: fullBody }),
    });
    if (!res.ok) throw new Error(`PATCH comment failed: HTTP ${res.status} ${await res.text()}`);
    return 'updated';
  }

  const res = await fetch(`${API}/repos/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ body: fullBody }),
  });
  if (!res.ok) {
    if (res.status === 403) {
      console.log('[gh_sticky_comment] no write access (likely a fork PR); skipping comment.');
      return null;
    }
    throw new Error(`POST comment failed: HTTP ${res.status} ${await res.text()}`);
  }
  return 'created';
}
