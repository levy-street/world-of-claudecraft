// The /c/<name> SSR profile page's Book of Deeds title line. Drives the REAL
// handleProfilePage with the db layer mocked (the social_frames partial-mock
// pattern): a titled character renders the English title under the <h1>, an
// untitled or stale-titled one renders no line at all, and the page never
// leaks the raw deed id. English is correct here BY DESIGN (the page is
// lang="en" throughout); every localized surface resolves ids client-side.
import { describe, expect, it, vi } from 'vitest';

const mockGetCharacterById = vi.fn();

vi.mock('../server/db', () => ({
  findCharacterReportTargetByName: vi.fn(async (name: string) =>
    name === 'Hilda' ? { characterId: 42 } : null,
  ),
  getCharacterById: (...args: unknown[]) => mockGetCharacterById(...args),
  guildNameForCharacter: vi.fn(async () => null),
  lifetimeXpRankForCharacter: vi.fn(async () => null),
  listCharacterNamesForSitemap: vi.fn(async () => []),
}));

import { handleProfilePage } from '../server/profile_page';

function charRow(state: Record<string, unknown>) {
  return {
    id: 42,
    account_id: 7,
    name: 'Hilda',
    class: 'warrior',
    level: 12,
    realm: 'Claudemoon',
    state,
    is_gm: false,
    force_rename: false,
  };
}

async function renderProfile(state: Record<string, unknown>): Promise<string> {
  mockGetCharacterById.mockResolvedValueOnce(charRow(state));
  const req = {
    url: '/c/Hilda',
    headers: { host: 'worldofclaudecraft.com' },
    socket: { remoteAddress: `10.1.2.${Math.floor(Math.random() * 250)}` },
  } as never;
  let body = '';
  let status = 0;
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk?: string) => {
      body += chunk ?? '';
    },
  } as never;
  await handleProfilePage(req, res);
  expect(status).toBe(200);
  return body;
}

describe('profile page Book of Deeds title line', () => {
  it('renders the English title under the name for an earned selection', async () => {
    const html = await renderProfile({
      level: 12,
      deeds: { prog_veteran: '2026-07-08' },
      renown: 25,
      activeTitle: 'prog_veteran',
    });
    expect(html).toContain('<h1>Hilda</h1>');
    expect(html).toContain('<p class="deed-title">Veteran</p>');
    // the raw deed id never reaches the page
    expect(html).not.toContain('prog_veteran');
  });

  it('renders no title line for an untitled character (element absent, not empty)', async () => {
    const html = await renderProfile({ level: 12 });
    expect(html).toContain('<h1>Hilda</h1>');
    // the stylesheet rule stays; the ELEMENT never renders
    expect(html).not.toContain('<p class="deed-title">');
  });

  it('degrades a stale/content-drifted id to no line, never a crash or raw id', async () => {
    const html = await renderProfile({ level: 12, activeTitle: 'removed_deed' });
    expect(html).toContain('<h1>Hilda</h1>');
    expect(html).not.toContain('<p class="deed-title">');
    expect(html).not.toContain('removed_deed');
  });

  it('escapes the title text through the page escaper (uniform-style guard)', async () => {
    // Authored titles are plain English today; the pin is that the render
    // path routes through escapeHtml like every other dynamic value.
    const html = await renderProfile({
      level: 12,
      deeds: { hid_saul_footnote: '2026-07-08' },
      activeTitle: 'hid_saul_footnote',
    });
    expect(html).toContain('<p class="deed-title">the Footnote</p>');
  });
});
