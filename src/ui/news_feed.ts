// News & Updates feed: renders GitHub release notes for the home page's
// "News & Updates" panel and the character-select screen's news panel.
// Extracted out of main.ts (the sanctioned firewall) so the sanitizing
// markdown renderer and the fetch/paint loop have their own tested home.
//
// renderReleaseBody is pure and DOM-free; loadNewsInto is a thin consumer that
// takes an injected fetch and paints into a host element. The compact-feed
// helpers (markNewReleases / nextLastSeenReleaseId / renderCompactNews) are
// pure too; the character-select consumer is src/ui/charselect_news.ts.
import { formatDateTime, t } from './i18n';

export interface NewsReleaseEntry {
  id: number;
  tag: string;
  name: string;
  body: string;
  url: string;
  prerelease: boolean;
  publishedAt: string;
}

/** The minimal release shape the NEW-badge marker logic needs. */
export interface ReleaseSummary {
  id: number;
  publishedAt: string;
}

const MAX_RELEASES_SHOWN = 5;

/**
 * Marks each release NEW relative to the stored last-seen id, then caps the
 * list at 5. Generic over T so a caller holding the FULL release shape
 * (body/url/prerelease, see NewsReleaseEntry) gets those fields back too: the
 * compact news layout (renderCompactNews) needs the full article to render the
 * expanded latest release.
 */
export function markNewReleases<T extends ReleaseSummary>(
  releases: T[],
  lastSeenReleaseId: number | null,
): (T & { isNew: boolean })[] {
  return releases
    .slice(0, MAX_RELEASES_SHOWN)
    .map((r) => ({ ...r, isNew: lastSeenReleaseId === null || r.id > lastSeenReleaseId }));
}

/** The next last-seen marker to persist once the player has viewed the feed. */
export function nextLastSeenReleaseId(
  releases: ReleaseSummary[],
  previous: number | null,
): number | null {
  const max = releases.reduce((m, r) => Math.max(m, r.id), Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(max)) return previous;
  return previous === null ? max : Math.max(previous, max);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

// Minimal, safe Markdown -> HTML for GitHub release notes. The input is escaped
// FIRST, so every regex below operates on inert text; the only markup we emit is
// our own whitelisted tags. Deliberately tiny (no tables/images/blockquotes),
// enough to make patch notes readable without pulling in a markdown dependency.
// Consecutive plain lines JOIN into one paragraph (standard Markdown semantics:
// only a blank line breaks a paragraph). GitHub release notes arrive hard-wrapped
// near 72 columns, so per-line paragraphs rendered every source wrap as its own
// choppy one-line paragraph.
export function renderReleaseBody(md: string): string {
  const inline = (s: string): string =>
    escapeHtml(s)
      // [text](url), only http(s) links survive; anything else renders as text.
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        (_m, text, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
      )
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  const out: string[] = [];
  let inList = false;
  let paragraph: string[] = [];
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      out.push(`<p>${paragraph.join(' ')}</p>`);
      paragraph = [];
    }
  };
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(3, heading[1].length); // collapse h1-h6 -> h1-h3
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet) {
      flushParagraph();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
    } else if (line.trim() === '') {
      flushParagraph();
      closeList();
    } else {
      closeList();
      paragraph.push(inline(line.trim()));
    }
  }
  flushParagraph();
  closeList();
  return out.join('');
}

function newsItemFoot(url: string): string {
  return url
    ? `<div class="news-item-foot"><a class="news-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${t('news.viewOnGithub')}</a></div>`
    : '';
}

/** Strips the release body's own redundant preamble (the "<name> Release
 *  Notes" h1 plus the Release/Date/Previous-release definition rows): the
 *  article chrome already shows name, tag, and date, so the preamble printed
 *  the same facts up to four times. Anchored to the LEADING run only; a
 *  mid-body "**Release:**" line or a meaningful opening h1 survives. */
export function stripReleaseNotesPreamble(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .replace(
      /^\s*#\s+[^\n]*Release Notes[^\n]*\n(?:\s*\n)*(?:\*\*(?:Release|Date|Previous release):\*\*[^\n]*\n(?:\s*\n)*)*/,
      '',
    );
}

/** One release rendered as the "News & Updates" article markup (expanded form). */
export function renderReleaseArticle(r: NewsReleaseEntry, opts?: { isNew?: boolean }): string {
  const when = r.publishedAt
    ? `<span class="news-date">${formatDateTime(new Date(r.publishedAt), { dateStyle: 'medium' })}</span>`
    : '';
  const tag = r.tag ? `<span class="news-tag">${escapeHtml(r.tag)}</span>` : '';
  const newBadge = opts?.isNew ? `<span class="news-badge">${t('news.new')}</span>` : '';
  const badge = r.prerelease ? `<span class="news-badge">${t('news.prerelease')}</span>` : '';
  const title = escapeHtml(r.name || r.tag || '');
  return (
    `<article class="news-item">` +
    `<div class="news-item-head">` +
    `<h3 class="news-item-title">${title}</h3><div class="news-item-meta">${tag}${newBadge}${badge}${when}</div></div>` +
    `<div class="news-body">${renderReleaseBody(stripReleaseNotesPreamble(r.body))}</div>${newsItemFoot(r.url)}</article>`
  );
}

export function newsLoadingHtml(): string {
  return `<div class="news-loading">${t('news.loading')}</div>`;
}

export function newsErrorHtml(): string {
  return `<div class="news-error">${t('news.error')}</div>`;
}

export function newsEmptyHtml(): string {
  return `<div class="news-empty">${t('news.empty')}</div>`;
}

let newsLoading = false;

/**
 * Fetches releases (via the injected loader) and paints them into `host`.
 * Guarded against overlapping calls the same way the original main.ts loop was.
 * This is the homepage "News & Updates" panel's full-list view: every fetched
 * release, fully expanded, uncapped. The character-select panel's compact feed
 * (latest expanded, older collapsed, capped at 5) is renderCompactNews below.
 */
export async function loadNewsInto(
  host: HTMLElement | null,
  fetchReleases: () => Promise<NewsReleaseEntry[]>,
): Promise<void> {
  if (!host || newsLoading) return;
  newsLoading = true;
  host.innerHTML = newsLoadingHtml();
  let releases: NewsReleaseEntry[] = [];
  try {
    releases = await fetchReleases();
  } catch {
    host.innerHTML = newsErrorHtml();
    newsLoading = false;
    return;
  }
  newsLoading = false;
  if (releases.length === 0) {
    host.innerHTML = newsEmptyHtml();
    return;
  }
  host.innerHTML = releases.map((r) => renderReleaseArticle(r)).join('');
}

function renderCompactNewsCollapsedRow(r: NewsReleaseEntry & { isNew?: boolean }): string {
  const when = r.publishedAt
    ? `<span class="news-collapsed-date">${formatDateTime(new Date(r.publishedAt), { dateStyle: 'medium' })}</span>`
    : '';
  const newBadge = r.isNew ? `<span class="news-badge">${t('news.new')}</span>` : '';
  const label = escapeHtml(r.name || r.tag || '');
  return (
    `<details class="news-collapsed">` +
    `<summary class="news-collapsed-summary">` +
    `<span class="news-collapsed-version">${label}${newBadge}</span>${when}` +
    `</summary>` +
    `<div class="news-body">${renderReleaseBody(stripReleaseNotesPreamble(r.body))}</div>${newsItemFoot(r.url)}` +
    `</details>`
  );
}

/**
 * The compact "News and Updates" feed: the latest release fully expanded
 * (title, date, NEW badge, rendered body), older releases (the caller has
 * already capped the list via markNewReleases) collapsed to version + date
 * rows that expand in place (a native <details>/<summary> disclosure, same
 * pattern as the guide FAQ: src/guide/pages/faq.ts), plus a "View all updates
 * on GitHub" link at the bottom. DOM-free: returns a markup string, painted by
 * the caller (the character-select panel, src/ui/charselect_news.ts).
 */
export function renderCompactNews(
  releases: (NewsReleaseEntry & { isNew: boolean })[],
  githubReleasesUrl: string,
): string {
  if (releases.length === 0) return newsEmptyHtml();
  const [latest, ...older] = releases;
  const parts = [
    renderReleaseArticle(latest, { isNew: latest.isNew }),
    ...older.map(renderCompactNewsCollapsedRow),
    `<div class="news-view-all"><a href="${escapeHtml(githubReleasesUrl)}" target="_blank" rel="noopener noreferrer">${t('news.viewAll')}</a></div>`,
  ];
  return parts.join('');
}
