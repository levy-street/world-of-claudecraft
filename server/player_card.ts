// Shareable player cards + referral capture (server side).
//
// Three public surfaces:
//   POST /api/card?character=<id>   (authed) — store/replace this character's
//                                    client-composited PNG, return its slug+URL.
//   GET  /p/<slug>                  — an Open-Graph HTML page that unfurls on X /
//                                    Discord and links into the game with ?ref.
//   GET  /p/<slug>/card.png         — the stored PNG (the og:image).
//
// Cards are stored as bytes in Postgres (shared by every realm process), so a
// shared link resolves no matter which realm serves the request. Referral
// capture only records the relationship; reward payout is out of scope.
import type http from 'node:http';
import { json, readBinaryBody, isPng, isUniqueViolation } from './http_util';
import {
  getCharacter,
  slugAvailable,
  upsertPlayerCard,
  getPlayerCardBySlug,
  getPlayerCardMetaBySlug,
  accountForSlug,
  recordReferral,
} from './db';

// A composited card is ~1200×630 @2× PNG — comfortably under this bound, which
// is generous enough to never reject a legitimate upload yet caps memory.
const MAX_CARD_BYTES = 4 * 1024 * 1024;

const CLASS_DISPLAY: Record<string, string> = {
  warrior: 'Warrior', paladin: 'Paladin', hunter: 'Hunter', rogue: 'Rogue',
  priest: 'Priest', mage: 'Mage', warlock: 'Warlock', druid: 'Druid', shaman: 'Shaman',
};

function classDisplay(cls: string): string {
  return CLASS_DISPLAY[cls] ?? (cls ? cls[0].toUpperCase() + cls.slice(1) : 'Adventurer');
}

// Build a URL/file-safe slug from a character name. Lowercased, non-alphanumerics
// collapsed to single hyphens, trimmed, capped. May be empty (e.g. an all-symbol
// name) — callers fall back to a character-id slug.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Validate a slug arriving from an untrusted URL before it is used in a query.
// Slugs are only ever used as SQL parameters (never file paths), but this keeps
// lookups bounded and 404s clean.
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function requestOrigin(req: http.IncomingMessage): string {
  const fwd = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const proto = fwd || ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
  const host = req.headers.host ?? 'localhost';
  return `${proto}://${host}`;
}

// POST /api/card?character=<id>  (body: image/png)  → { url, ref }
export async function handleCardUpload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const params = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
  const characterId = Number(params.get('character'));
  if (!Number.isInteger(characterId) || characterId <= 0) {
    return json(res, 400, { error: 'character id is required' });
  }
  const character = await getCharacter(accountId, characterId);
  if (!character) return json(res, 404, { error: 'character not found' });

  let png: Buffer;
  try {
    png = await readBinaryBody(req, MAX_CARD_BYTES);
  } catch (err) {
    const tooLarge = err instanceof Error && err.message === 'body too large';
    return json(res, tooLarge ? 413 : 400, { error: tooLarge ? 'image too large' : 'could not read image' });
  }
  if (!isPng(png)) return json(res, 400, { error: 'expected a PNG image' });

  const base = slugify(character.name) || `player-${characterId}`;
  const title = `${character.name} — Level ${character.level} ${classDisplay(character.class)}`;
  const description = `${character.name} is forging a legend in World of Claudecraft. Join the realm.`;

  // Prefer the clean name slug; fall back to a character-id-suffixed slug when
  // the name slug is taken by a different character. Retry once under a unique
  // violation in case the slug is claimed between the check and the upsert.
  let slug = (await slugAvailable(base, characterId)) ? base : `${base}-${characterId}`.slice(0, 64);
  try {
    await upsertPlayerCard({ characterId, accountId, slug, png, title, description });
  } catch (err) {
    // The only recoverable collision is the clean base slug racing another
    // character between the check and the upsert; retry once with the
    // character-id-suffixed slug (globally unique — it embeds this char's id).
    // An already-suffixed slug can't legitimately collide, so surface it.
    if (!isUniqueViolation(err) || slug !== base) throw err;
    slug = `${base}-${characterId}`.slice(0, 64);
    await upsertPlayerCard({ characterId, accountId, slug, png, title, description });
  }
  return json(res, 200, { url: `/p/${slug}`, ref: slug });
}

// GET /p/<slug>  and  GET /p/<slug>/card.png
export async function handleCardRoutes(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const path = (req.url ?? '').split('?')[0];
    const m = /^\/p\/([^/]+)(\/card\.png)?\/?$/.exec(path);
    const slug = m ? decodeURIComponent(m[1]).toLowerCase() : '';
    if (!m || !isValidSlug(slug)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    if (m[2]) return await serveCardImage(res, slug);
    return await serveCardPage(req, res, slug);
  } catch (err) {
    console.error('player-card route error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('internal error');
  }
}

async function serveCardImage(res: http.ServerResponse, slug: string): Promise<void> {
  const card = await getPlayerCardBySlug(slug);
  if (!card) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': card.png.length,
    // Cards can be re-published, so revalidate fairly often rather than caching
    // immutably like content-hashed build assets.
    'Cache-Control': 'public, max-age=300',
  });
  res.end(card.png);
}

async function serveCardPage(req: http.IncomingMessage, res: http.ServerResponse, slug: string): Promise<void> {
  // Metadata-only read — the HTML page never needs the (up to ~4 MB) PNG bytes.
  const card = await getPlayerCardMetaBySlug(slug);
  const origin = requestOrigin(req);
  if (!card) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(missingCardHtml(origin));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120' });
  res.end(cardPageHtml({ slug, title: card.title, description: card.description, origin }));
}

function cardPageHtml(opts: { slug: string; title: string; description: string; origin: string }): string {
  const { slug, title, description, origin } = opts;
  const pageUrl = `${origin}/p/${slug}`;
  const imageUrl = `${pageUrl}/card.png`;
  const playUrl = `${origin}/?ref=${encodeURIComponent(slug)}`;
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t} · World of Claudecraft</title>
<meta name="description" content="${d}">
<meta property="og:type" content="website">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${escapeHtml(imageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${escapeHtml(imageUrl)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Alegreya+Sans:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root { --gold: #ffd100; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 22px; padding: 32px 16px;
    background: radial-gradient(circle at 50% 18%, #241910, #0a0805 70%);
    color: #ece2c4; font-family: 'Alegreya Sans', system-ui, sans-serif; text-align: center; }
  h1 { font-family: 'Cinzel', Georgia, serif; color: var(--gold); font-size: clamp(22px, 4vw, 34px);
    margin: 0; text-shadow: 0 2px 10px rgba(0,0,0,.6); }
  p { margin: 0; color: #c9bb92; max-width: 640px; line-height: 1.5; }
  img.card { width: min(720px, 96vw); height: auto; border-radius: 12px;
    box-shadow: 0 12px 48px rgba(0,0,0,.6); border: 1px solid #4a3a18; }
  a.cta { display: inline-block; margin-top: 6px; padding: 13px 30px; border-radius: 8px;
    font-family: 'Cinzel', serif; font-weight: 700; font-size: 17px; text-decoration: none;
    color: #2a1d05; background: linear-gradient(#ffe27a, #e0a52a); box-shadow: 0 4px 18px rgba(224,165,42,.4); }
  a.cta:hover { filter: brightness(1.08); }
  footer { color: #7c6f4e; font-size: 13px; }
</style>
</head>
<body>
  <h1>${t}</h1>
  <img class="card" src="${escapeHtml(imageUrl)}" alt="${t}" width="1200" height="630">
  <p>${d}</p>
  <a class="cta" href="${escapeHtml(playUrl)}">Forge your legend →</a>
  <footer>World of Claudecraft</footer>
</body>
</html>`;
}

function missingCardHtml(origin: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Card not found · World of Claudecraft</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 16px; background: radial-gradient(circle at 50% 18%, #241910, #0a0805 70%);
    color: #ece2c4; font-family: system-ui, sans-serif; text-align: center; padding: 24px; }
  a { color: #ffd100; }
</style></head>
<body><h1>This card has wandered off.</h1>
<p>It may have been retired or never existed.</p>
<p><a href="${escapeHtml(origin)}/">Enter World of Claudecraft →</a></p>
</body></html>`;
}

// Record a referral when a brand-new account registered via ?ref=<slug>. Safe to
// call with any untrusted `ref`: invalid slugs, unknown slugs, and self-referrals
// are silently ignored.
export async function captureReferral(refereeAccountId: number, ref: unknown): Promise<void> {
  const slug = typeof ref === 'string' ? ref.trim().toLowerCase() : '';
  if (!isValidSlug(slug)) return;
  const referrer = await accountForSlug(slug);
  if (referrer === null || referrer === refereeAccountId) return;
  await recordReferral(refereeAccountId, referrer, slug);
}
