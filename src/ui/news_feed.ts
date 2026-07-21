// News & Updates feed: renders GitHub release notes for the home page's
// "News & Updates" panel and the post-login Welcome Screen's news column.
// Extracted out of main.ts (the sanctioned firewall) so the sanitizing
// markdown renderer and the fetch/paint loop have their own tested home.
//
// renderReleaseBody is pure and DOM-free; loadNewsInto is a thin consumer that
// takes an injected fetch (so it composes with either the char-select origin's
// api.releases or a fresh Welcome Screen fetch) and paints into a host element.
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
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(3, heading[1].length); // collapse h1-h6 -> h1-h3
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
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
  const newBadge = opts?.isNew ? `<span class="news-badge">${t('welcome.news.new')}</span>` : '';
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
 * Guarded against overlapping calls the same way the original main.ts loop was
 * (a Welcome Screen open + a home-page News panel open could otherwise race).
 * This is the homepage "News & Updates" panel's full-list view: every fetched
 * release, fully expanded, uncapped. The Welcome Screen's compact column
 * (latest expanded, older collapsed, capped at 5) is renderWelcomeNews below.
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

function renderWelcomeNewsCollapsedRow(r: NewsReleaseEntry & { isNew?: boolean }): string {
  const when = r.publishedAt
    ? `<span class="ws-news-collapsed-date">${formatDateTime(new Date(r.publishedAt), { dateStyle: 'medium' })}</span>`
    : '';
  const newBadge = r.isNew ? `<span class="news-badge">${t('welcome.news.new')}</span>` : '';
  const label = escapeHtml(r.name || r.tag || '');
  return (
    `<details class="ws-news-collapsed">` +
    `<summary class="ws-news-collapsed-summary">` +
    `<span class="ws-news-collapsed-version">${label}${newBadge}</span>${when}` +
    `</summary>` +
    `<div class="news-body">${renderReleaseBody(stripReleaseNotesPreamble(r.body))}</div>${newsItemFoot(r.url)}` +
    `</details>`
  );
}

/**
 * The Welcome Screen's compact "News and Updates" column: the latest release
 * fully expanded (title, date, NEW badge, rendered body), older releases (the
 * caller has already capped the list, see markNewReleases/MAX_RELEASES_SHOWN in
 * welcome_screen_view.ts) collapsed to version + date rows that expand in place
 * (a native <details>/<summary> disclosure, same pattern as the guide FAQ:
 * src/guide/pages/faq.ts), plus a "View all updates on GitHub" link at the
 * bottom. DOM-free: returns a markup string, painted by the caller.
 */
export function renderWelcomeNews(
  releases: (NewsReleaseEntry & { isNew: boolean })[],
  githubReleasesUrl: string,
): string {
  if (releases.length === 0) return newsEmptyHtml();
  const [latest, ...older] = releases;
  const parts = [
    renderReleaseArticle(latest, { isNew: latest.isNew }),
    ...older.map(renderWelcomeNewsCollapsedRow),
    `<div class="ws-news-view-all"><a href="${escapeHtml(githubReleasesUrl)}" target="_blank" rel="noopener noreferrer">${t('welcome.news.viewAll')}</a></div>`,
  ];
  return parts.join('');
}
