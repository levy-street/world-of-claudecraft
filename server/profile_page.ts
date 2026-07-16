// Public, crawlable profile surfaces — the #1 SEO lever. No auth, server-rendered.
//   GET /c/:name              → an indexed HTML profile card (OG/Twitter meta,
//                               server-side links to leaderboard + class wiki).
//   GET /avatar/:class/:skin.png → deterministic class+skin portrait.
//   GET /sitemap-characters.xml  → every active character's /c/ URL for crawlers.
//
// The card data is the PUBLIC character-sheet subset (never stats/vitals/gold/
// pos), so the page leaks nothing the public JSON wouldn't.

import type * as http from 'node:http';
import { avatarPng, isPlayerClass, isValidSkin } from './avatar';
import {
  type CharacterSheet,
  characterSheet,
  type SheetRank,
  sheetTitleText,
} from './character_sheet';
import {
  findCharacterReportTargetByName,
  getCharacterById,
  guildNameForCharacter,
  lifetimeXpRankForCharacter,
  listCharacterNamesForSitemap,
} from './db';
import { logger } from './http/logger';
import { publicReadRateLimited } from './ratelimit';
import { publicOriginFromRequest, REALM } from './realm';

function publicOrigin(req: http.IncomingMessage): string {
  return publicOriginFromRequest(req);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toSheetRank(rank: { rank: number; total: number } | null): SheetRank | null {
  return rank ? { scope: 'realm', rank: rank.rank, total: rank.total } : null;
}

const GAME_NAME = 'World of ClaudeCraft';

// ── GET /c/:name ───────────────────────────────────────────────────────────

export async function handleProfilePage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    if (!publicReadRateLimited(req).allowed) {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('rate limited');
      return;
    }
    const path = (req.url ?? '').split('?')[0];
    const m = /^\/c\/([^/]+)\/?$/.exec(path);
    const origin = publicOrigin(req);
    if (!m) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(missingProfileHtml(origin));
      return;
    }
    let rawName = '';
    try {
      rawName = decodeURIComponent(m[1]);
    } catch {
      rawName = m[1];
    }
    const target = await findCharacterReportTargetByName(rawName);
    const row = target ? await getCharacterById(target.characterId) : null;
    if (!row) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(missingProfileHtml(origin));
      return;
    }
    const [guild, rank] = await Promise.all([
      guildNameForCharacter(row.id),
      lifetimeXpRankForCharacter(row.id),
    ]);
    const sheet = characterSheet({
      row,
      visibility: 'public',
      realm: REALM,
      origin,
      guild,
      rank: toSheetRank(rank),
    });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120',
    });
    res.end(profileHtml(sheet, origin));
  } catch (err) {
    logger.error({ err }, 'profile page error');
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('internal error');
  }
}

function profileTitle(sheet: CharacterSheet): string {
  const spec = sheet.spec ? `${sheet.spec} ` : '';
  return `${sheet.name} — Lv ${sheet.level} ${spec}${sheet.classLabel}`;
}

function profileDescription(sheet: CharacterSheet): string {
  const parts = [`Level ${sheet.level} ${sheet.classLabel}`];
  if (sheet.spec) parts.push(sheet.spec);
  parts.push(`in the ${sheet.zone} zone on ${sheet.realm}`);
  if (sheet.guild) parts.push(`· <${sheet.guild}>`);
  if (sheet.rank) parts.push(`· realm rank #${sheet.rank.rank} of ${sheet.rank.total}`);
  return `${parts.join(' ')}. View ${sheet.name}'s profile on ${GAME_NAME}.`;
}

function profileHtml(sheet: CharacterSheet, origin: string): string {
  const title = escapeHtml(profileTitle(sheet));
  const desc = escapeHtml(profileDescription(sheet));
  const pageUrl = escapeHtml(sheet.profileUrl);
  const avatar = escapeHtml(sheet.avatarUrl);
  const leaderboardUrl = escapeHtml(`${origin}/leaderboard`);
  const classWikiUrl = escapeHtml(`${origin}/wiki/classes/${sheet.class}`);
  const playUrl = escapeHtml(`${origin}/play`);
  const name = escapeHtml(sheet.name);
  const gameName = escapeHtml(GAME_NAME);
  const arena1 = sheet.arena['1v1'];
  const arenaLine = arena1
    ? `<li>Arena 1v1: <strong>${arena1.rating}</strong> (${arena1.wins}W / ${arena1.losses}L)</li>`
    : '';
  const rankLine = sheet.rank
    ? `<li>Realm rank: <strong>#${sheet.rank.rank}</strong> of ${sheet.rank.total}</li>`
    : '';
  const guildLine = sheet.guild
    ? `<li>Guild: <strong>&lt;${escapeHtml(sheet.guild)}&gt;</strong></li>`
    : '';
  // The selected Book of Deeds title, under the name. sheetTitleText returns
  // null for unset/stale/non-title ids, so the line simply disappears (never
  // a raw deed id, never a crash on an old state blob).
  const earnedTitle = sheetTitleText(sheet.deeds.activeTitle);
  const deedTitleLine = earnedTitle ? `<p class="deed-title">${escapeHtml(earnedTitle)}</p>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${gameName}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="profile">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${avatar}">
<meta property="og:image:width" content="256">
<meta property="og:image:height" content="256">
<meta property="og:url" content="${pageUrl}">
<meta property="og:site_name" content="${gameName}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${avatar}">
<style>
  :root { --gold: #ffd100; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; min-height: 100dvh; display: flex; padding: 32px 16px;
    background: radial-gradient(circle at 50% 18%, #241910, #0a0805 70%);
    color: #ece2c4; font-family: system-ui, sans-serif; text-align: center; }
  main { margin: auto; width: 100%; max-width: 560px; display: flex; flex-direction: column;
    align-items: center; gap: 18px; }
  img.avatar { width: 160px; height: 160px; border-radius: 16px; border: 1px solid #4a3a18;
    box-shadow: 0 12px 48px rgba(0,0,0,.6); image-rendering: pixelated; }
  h1 { color: var(--gold); font-size: clamp(22px, 4vw, 32px); margin: 0; overflow-wrap: anywhere; }
  p.deed-title { margin: -10px 0 0; color: #caa64a; font-size: 15px; }
  p.sub { margin: 0; color: #c9bb92; }
  ul { list-style: none; padding: 0; margin: 8px 0; color: #d8ca9c; line-height: 1.8; }
  nav { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 8px; }
  a.btn { display: inline-block; padding: 11px 22px; border-radius: 8px; font-weight: 700;
    text-decoration: none; color: #2a1d05; background: linear-gradient(#ffe27a, #e0a52a); }
  a.link { color: var(--gold); }
  footer { color: #7c6f4e; font-size: 13px; margin-top: 6px; }
</style>
</head>
<body>
  <main>
    <img class="avatar" src="${avatar}" alt="${name} portrait" width="256" height="256">
    <h1>${name}</h1>
    ${deedTitleLine}
    <p class="sub">Level ${sheet.level} ${escapeHtml(sheet.classLabel)}${sheet.spec ? ` · ${escapeHtml(sheet.spec)}` : ''} · ${escapeHtml(sheet.realm)}</p>
    <ul>
      <li>Zone: <strong>${escapeHtml(sheet.zone)}</strong></li>
      ${guildLine}
      ${rankLine}
      ${arenaLine}
    </ul>
    <nav>
      <a class="btn" href="${playUrl}">Play ${gameName}</a>
      <a class="link" href="${leaderboardUrl}">Leaderboard</a>
      <a class="link" href="${classWikiUrl}">${escapeHtml(sheet.classLabel)} guide</a>
    </nav>
    <footer>${gameName}</footer>
  </main>
</body>
</html>`;
}

function missingProfileHtml(origin: string): string {
  const home = escapeHtml(`${origin}/`);
  const gameName = escapeHtml(GAME_NAME);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Character not found · ${gameName}</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${home}">
<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;
justify-content:center;gap:16px;background:radial-gradient(circle at 50% 18%,#241910,#0a0805 70%);
color:#ece2c4;font-family:system-ui,sans-serif;text-align:center;padding:24px}a{color:#ffd100}</style>
</head><body><h1>Character not found</h1>
<p>No such character on this realm.</p>
<p><a href="/">Back to ${gameName}</a></p>
</body></html>`;
}

// ── GET /avatar/:class/:skin.png ───────────────────────────────────────────

export async function handleAvatar(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const path = (req.url ?? '').split('?')[0];
    const m = /^\/avatar\/([a-z]+)\/(\d+)\.png$/.exec(path);
    if (!m || !isPlayerClass(m[1]) || !isValidSkin(Number(m[2]))) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const png = avatarPng(m[1], Number(m[2]));
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': png.length,
      // Deterministic art keyed by class+skin — cache hard.
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(png);
  } catch (err) {
    logger.error({ err }, 'avatar error');
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('internal error');
  }
}

// ── GET /sitemap-characters.xml ────────────────────────────────────────────

const SITEMAP_MAX = 50000; // sitemap protocol per-file URL cap

export async function handleCharacterSitemap(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const origin = publicOrigin(req);
    const names = await listCharacterNamesForSitemap(SITEMAP_MAX);
    const urls = names
      .map(
        (name) =>
          `  <url><loc>${escapeXml(`${origin}/c/${encodeURIComponent(name)}`)}</loc><changefreq>daily</changefreq></url>`,
      )
      .join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
    res.writeHead(200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(xml);
  } catch (err) {
    logger.error({ err }, 'character sitemap error');
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('internal error');
  }
}
