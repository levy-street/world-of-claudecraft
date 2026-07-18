import { describe, expect, it } from 'vitest';
import {
  loadNewsInto,
  type NewsReleaseEntry,
  renderReleaseArticle,
  renderReleaseBody,
  renderWelcomeNews,
  stripReleaseNotesPreamble,
} from '../src/ui/news_feed';

describe('renderReleaseBody', () => {
  it('escapes raw HTML in the source markdown', () => {
    expect(renderReleaseBody('<script>alert(1)</script>')).not.toContain('<script>');
    expect(renderReleaseBody('<script>alert(1)</script>')).toContain('&lt;script&gt;');
  });

  it('renders headings, bullets, bold, italics, code, and safe links', () => {
    const html = renderReleaseBody(
      '# Title\n\n- one\n- two\n\n**bold** and *italic* and `code`\n\n[a link](https://example.com)',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">a link</a>',
    );
  });

  it('drops a non-http(s) link target, rendering it as plain text', () => {
    const html = renderReleaseBody('[danger](javascript:alert(1))');
    expect(html).not.toContain('<a href');
  });
});

class FakeHost {
  innerHTML = '';
}

describe('loadNewsInto', () => {
  it('paints an error state when the fetch rejects', async () => {
    const host = new FakeHost();
    await loadNewsInto(host as unknown as HTMLElement, async () => {
      throw new Error('network');
    });
    expect(host.innerHTML).toContain('news-error');
  });

  it('paints an empty state when there are no releases', async () => {
    const host = new FakeHost();
    await loadNewsInto(host as unknown as HTMLElement, async () => []);
    expect(host.innerHTML).toContain('news-empty');
  });

  it('paints one article per release on success', async () => {
    const host = new FakeHost();
    const releases: NewsReleaseEntry[] = [
      {
        id: 1,
        tag: 'v1.0.0',
        name: 'v1.0.0',
        body: '- fixed a bug',
        url: 'https://example.com/releases/1',
        prerelease: false,
        publishedAt: '2026-01-01T00:00:00Z',
      },
    ];
    await loadNewsInto(host as unknown as HTMLElement, async () => releases);
    expect(host.innerHTML).toContain('news-item');
    expect(host.innerHTML).toContain('fixed a bug');
  });

  it('is a no-op with a null host', async () => {
    await expect(loadNewsInto(null, async () => [])).resolves.toBeUndefined();
  });
});

describe('renderReleaseArticle: NEW badge', () => {
  const release: NewsReleaseEntry = {
    id: 1,
    tag: 'v1.0.0',
    name: 'v1.0.0',
    body: 'notes',
    url: 'https://example.com/releases/1',
    prerelease: false,
    publishedAt: '2026-01-01T00:00:00Z',
  };

  it('omits the NEW badge by default', () => {
    expect(renderReleaseArticle(release)).not.toContain('news-badge');
  });

  it('renders the NEW badge when isNew is true', () => {
    const html = renderReleaseArticle(release, { isNew: true });
    expect(html).toContain('news-badge');
  });

  it('does not render the NEW badge when isNew is explicitly false', () => {
    expect(renderReleaseArticle(release, { isNew: false })).not.toContain('news-badge');
  });
});

describe('renderWelcomeNews: the Welcome Screen compact news column', () => {
  const releases = (n: number): (NewsReleaseEntry & { isNew: boolean })[] =>
    Array.from({ length: n }, (_, i) => ({
      id: n - i,
      tag: `v${n - i}.0.0`,
      name: `v${n - i}.0.0`,
      body: `notes for ${n - i}`,
      url: `https://example.com/releases/${n - i}`,
      prerelease: false,
      publishedAt: '2026-01-01T00:00:00Z',
      isNew: i === 0,
    }));

  it('renders the empty state when there are no releases', () => {
    expect(renderWelcomeNews([], 'https://example.com/releases')).toContain('news-empty');
  });

  it('renders the latest release fully expanded (a news-item article) with its NEW badge', () => {
    const html = renderWelcomeNews(releases(1), 'https://example.com/releases');
    expect(html).toContain('news-item');
    expect(html).toContain('notes for 1');
    expect(html).toContain('news-badge');
  });

  it('collapses every OLDER release to a version + date <details> row that expands in place', () => {
    const html = renderWelcomeNews(releases(3), 'https://example.com/releases');
    // The latest is a full article, not a collapsed row.
    expect(html).toContain('news-item');
    // The two older releases are native <details> disclosures (expand in place,
    // no JS wiring needed): one per older release.
    expect((html.match(/<details class="ws-news-collapsed">/g) ?? []).length).toBe(2);
    expect(html).toContain('v2.0.0');
    expect(html).toContain('v1.0.0');
    // Each collapsed row still carries its rendered body, just inside the
    // native disclosure rather than expanded up front.
    expect(html).toContain('notes for 2');
    expect(html).toContain('notes for 1');
  });

  it('marks every NEW release, not only the expanded latest: a collapsed row for an older release also carries the badge when it is new too', () => {
    const all = releases(3).map((r) => ({ ...r, isNew: true }));
    const html = renderWelcomeNews(all, 'https://example.com/releases');
    expect((html.match(/news-badge/g) ?? []).length).toBe(3);
  });

  it('a not-new older release renders its collapsed row without a badge', () => {
    const html = renderWelcomeNews(releases(3), 'https://example.com/releases');
    // releases(3) marks only index 0 (the latest, v3) as new; v2/v1 are not.
    expect((html.match(/news-badge/g) ?? []).length).toBe(1);
  });

  it('appends a "View all updates on GitHub" link at the bottom, pointed at the given URL', () => {
    const html = renderWelcomeNews(releases(2), 'https://github.com/example/repo/releases');
    expect(html).toContain('ws-news-view-all');
    expect(html).toContain('href="https://github.com/example/repo/releases"');
    expect(html.indexOf('ws-news-view-all')).toBeGreaterThan(html.indexOf('ws-news-collapsed'));
  });

  it('escapes the URL passed for the view-all link', () => {
    const html = renderWelcomeNews(releases(1), 'https://example.com/"><script>x</script>');
    expect(html).not.toContain('<script>x</script>');
  });
});

describe('stripReleaseNotesPreamble', () => {
  const v26 = [
    '# World of ClaudeCraft v0.26.0 Release Notes',
    '',
    '**Release:** v0.26.0',
    '**Date:** 2026-07-15',
    '**Previous release:** v0.25.0',
    '',
    'v0.26.0 is a dungeon finder release.',
  ].join('\n');

  it('strips the full h1 + Release/Date/Previous-release preamble', () => {
    expect(stripReleaseNotesPreamble(v26)).toBe('v0.26.0 is a dungeon finder release.');
  });

  it('strips the shape with no Date row (the v0.24.2 variant)', () => {
    const md = '# World of ClaudeCraft v0.24.2 Release Notes\n\n**Release:** v0.24.2\n\nBody.';
    expect(stripReleaseNotesPreamble(md)).toBe('Body.');
  });

  it('strips the hyphenated h1 variant', () => {
    const md = '# World of ClaudeCraft - v0.24.0 Release Notes\n\nBody.';
    expect(stripReleaseNotesPreamble(md)).toBe('Body.');
  });

  it('normalizes CRLF bodies before matching', () => {
    const md = '# X Release Notes\r\n\r\n**Release:** v1\r\n\r\nBody.';
    expect(stripReleaseNotesPreamble(md)).toBe('Body.');
  });

  it('leaves a preamble-free body unchanged', () => {
    expect(stripReleaseNotesPreamble('Just prose.')).toBe('Just prose.');
  });

  it('preserves a meaningful opening h1 and mid-body Release lines', () => {
    const md = '# Big Feature\n\nProse.\n\n**Release:** cadence note.';
    expect(stripReleaseNotesPreamble(md)).toBe(md);
  });
});

describe('welcome news strips the redundant preamble at render time', () => {
  it('renders neither the Release Notes h1 nor the metadata rows', () => {
    const body =
      '# World of ClaudeCraft v0.26.0 Release Notes\n\n**Release:** v0.26.0\n\nThe real intro.';
    const html = renderWelcomeNews(
      [
        {
          id: 1,
          tag: 'v0.26.0',
          name: 'World of ClaudeCraft v0.26.0',
          publishedAt: '2026-07-15T00:00:00Z',
          url: 'https://example.com/releases/v0.26.0',
          prerelease: false,
          body,
          isNew: true,
        },
      ],
      'https://example.com/releases',
    );
    expect(html).not.toContain('Release Notes</h1>');
    expect(html).not.toContain('<strong>Release:</strong>');
    expect(html).toContain('The real intro.');
  });
});
