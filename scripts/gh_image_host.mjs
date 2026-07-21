// Host PR screenshots so they can be embedded inline in a comment. GitHub Actions
// artifacts are not embeddable as images, and markdown does not render data: URIs, so the
// only way to show a picture in the comment is a URL GitHub can fetch. This uploads each
// PNG to a dedicated orphan branch via the REST API and returns its raw.githubusercontent
// URL, which renders in markdown on a public repo.
//
// Best-effort and non-blocking: on a fork PR the Actions token is read-only, so the branch
// create / file upload 403s; callers get an empty list back and simply post no images.
//
// Needs a token with contents:write (set the screenshots job's permissions accordingly).
// No npm deps: Node 18+ global fetch only.

const DEFAULT_BRANCH = 'bot-pr-screenshots';

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

// Create the assets branch as an orphan (no repo files, just a README) if it does not
// exist yet. Returns true when the branch is present and writable, false otherwise.
async function ensureBranch({ api, repo, branch, headers }) {
  const refRes = await fetch(`${api}/repos/${repo}/git/ref/heads/${branch}`, { headers });
  if (refRes.ok) return true;
  if (refRes.status !== 404) {
    console.log(`[gh_image_host] cannot read branch ${branch} (HTTP ${refRes.status}); skipping.`);
    return false;
  }

  const readme = Buffer.from(
    'Bot-managed branch holding rendered PR screenshots for inline comment embedding.\n' +
      'Files live under pr-<number>/<run-id>/. Safe to prune; regenerated on the next PR run.\n',
    'utf8',
  ).toString('base64');

  const blob = await fetch(`${api}/repos/${repo}/git/blobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content: readme, encoding: 'base64' }),
  });
  if (!blob.ok) {
    console.log(`[gh_image_host] blob create failed (HTTP ${blob.status}); skipping embedding.`);
    return false;
  }
  const blobSha = (await blob.json()).sha;

  const tree = await fetch(`${api}/repos/${repo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blobSha }],
    }),
  });
  if (!tree.ok) return false;
  const treeSha = (await tree.json()).sha;

  const commit = await fetch(`${api}/repos/${repo}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: 'init pr-screenshots asset branch',
      tree: treeSha,
      parents: [],
    }),
  });
  if (!commit.ok) return false;
  const commitSha = (await commit.json()).sha;

  const ref = await fetch(`${api}/repos/${repo}/git/refs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
  });
  // A concurrent run may have created it first (422); treat that as success.
  if (!ref.ok && ref.status !== 422) {
    console.log(`[gh_image_host] branch create failed (HTTP ${ref.status}); skipping embedding.`);
    return false;
  }
  return true;
}

// Upload the given PNG files and return [{ name, url }] with a raw URL per uploaded image.
// files is a list of basenames present in `dir`. Paths are keyed by PR number and run id so
// each run gets fresh, immutable URLs (no CDN-cache staleness between pushes).
export async function uploadScreenshots({
  files,
  readFile,
  prNumber,
  runId,
  token = process.env.GITHUB_TOKEN,
  repo = process.env.GITHUB_REPOSITORY,
  api = process.env.GITHUB_API_URL ?? 'https://api.github.com',
  rawBase = process.env.GITHUB_RAW_BASE ?? 'https://raw.githubusercontent.com',
  branch = DEFAULT_BRANCH,
}) {
  if (!token || !repo || !prNumber || !files?.length) return [];
  const headers = ghHeaders(token);

  if (!(await ensureBranch({ api, repo, branch, headers }))) return [];

  const uploaded = [];
  for (const name of files) {
    try {
      const content = readFile(name).toString('base64');
      const path = `pr-${prNumber}/${runId ?? 'latest'}/${name}`;
      const put = await fetch(`${api}/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `pr-${prNumber}: ${name}`,
          content,
          branch,
        }),
      });
      if (!put.ok) {
        console.log(`[gh_image_host] upload ${name} failed (HTTP ${put.status}); skipping it.`);
        continue;
      }
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      uploaded.push({ name, url: `${rawBase}/${repo}/${branch}/${encodedPath}` });
    } catch (e) {
      console.log(`[gh_image_host] upload ${name} errored (${e.message}); skipping it.`);
    }
  }
  return uploaded;
}
