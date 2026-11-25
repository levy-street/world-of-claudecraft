// The encyclopedia's page renderer, shared by the in-browser reader (reader.js) and the
// static site build (scripts/wiki_site/build.mjs). It turns a page's wikitext into
// the article view: the body markup plus the layout passes that reshape it. Anything that
// only binds behavior (filters, tooltips, the image viewer) stays with the caller.
import { layoutArticle } from './article_layout.js';
import {
  browseTrails,
  directoryLink,
  displayTitle,
  isCollection,
  isDirectory,
  subjects,
  tilePreview,
} from './browse.js';
import { directoryArt } from './directory_art.js';
import { layoutDirectory } from './directory_layout.js';
import { markZoomable } from './image_viewer.js';
import { renderMath, renderScale } from './math.js';
import { mountRelatedPages, relatedPageIndex } from './related_pages.js';

export const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
export const href = (title) => '#' + encodeURIComponent(title);
export const link = (title, label = title) =>
  '<a href="' + escapeHtml(href(title)) + '">' + escapeHtml(label) + '</a>';
function safeChart(markup, mapUrl) {
  const parsed = new DOMParser().parseFromString(markup, 'text/html').body.firstElementChild;
  if (!parsed?.classList.contains('woc-map')) return '';
  const chart = document.createElement('div');
  chart.className = 'woc-map';
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', 'Route map. Its marked locations are listed below.');
  if (/^[\d.]+\s*\/\s*[\d.]+$/.test(parsed.style.aspectRatio))
    chart.style.aspectRatio = parsed.style.aspectRatio;
  const zone = parsed.dataset.zone;
  if (zone && /^[a-z0-9_]+$/.test(zone)) {
    const url = mapUrl(zone);
    if (url) {
      chart.style.backgroundImage = 'url("' + url + '")';
      chart.style.backgroundSize = parsed.style.backgroundSize;
      chart.style.backgroundPosition = parsed.style.backgroundPosition;
    }
  }
  for (const source of parsed.children) {
    if (!['woc-pin', 'woc-radius', 'woc-landmark'].includes(source.className)) continue;
    const pin = document.createElement('span');
    pin.className = source.className;
    for (const prop of ['left', 'top', 'width', 'height'])
      if (/^[-.\d]+%$/.test(source.style[prop])) pin.style[prop] = source.style[prop];
    pin.title = source.title;
    pin.textContent = source.textContent;
    chart.append(pin);
  }
  return chart.outerHTML;
}

export function inline(s) {
  const tokens = [];
  function keep(value) {
    tokens.push(value);
    return '\uE000' + (tokens.length - 1) + '\uE001';
  }
  const icon = s.match(/^<woc-art path="(\/ui\/[A-Za-z0-9_/-]+\.webp)" size="icon" \/>\s*/);
  if (icon) s = s.slice(icon[0].length);
  // An in-game snapshot of a boss attack, set beside the attack's line.
  const shot = s.match(
    /^<woc-art path="(\/encyclopedia-attacks\/[\w.-]+\.webp)" size="attack" \/>\s*/,
  );
  if (shot) s = s.slice(shot[0].length);
  s = s
    .replace(
      /<woc-math(?: label="([^"]*)")?(?: note="([^"]*)")?>([\s\S]*?)<\/woc-math>/g,
      (_, label, note, expr) => keep(label ? renderScale(label, expr, note) : renderMath(expr)),
    )
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, title, label) =>
      keep(link(title, label || title)),
    )
    .replace(/\[(https?:\/\/[^\s\]]+) ([^\]]+)\]/g, (_, url, label) =>
      keep('<a href="' + escapeHtml(url) + '" rel="noreferrer">' + escapeHtml(label) + '</a>'),
    );
  const content = escapeHtml(s)
    .replace(/&#39;&#39;&#39;(.*?)&#39;&#39;&#39;/g, '<strong>$1</strong>')
    .replace(/&#39;&#39;(.*?)&#39;&#39;/g, '<em>$1</em>')
    .replace(/\uE000(\d+)\uE001/g, (_, i) => tokens[Number(i)]);
  if (shot)
    return (
      '<img class="attack-shot" data-game-art="' +
      escapeHtml(shot[1]) +
      '" alt="" width="192" height="146" loading="lazy" decoding="async"><span>' +
      content +
      '</span>'
    );
  if (!icon) return content;
  return (
    '<img class="ability-icon" data-game-art="' +
    escapeHtml(icon[1]) +
    '" alt="" width="32" height="32" loading="lazy" decoding="async"><span>' +
    content +
    '</span>'
  );
}

export function renderBody(body, mapUrl, indexIcon, directoryClass, groupTile) {
  const lines = body.split('\n'),
    output = [],
    headings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('[[Category:')) continue;
    if (line.startsWith('<div class="woc-map"')) {
      output.push(safeChart(line, mapUrl));
      continue;
    }
    const header = line.match(/^(={2,3})\s*(.+?)\s*\1$/);
    if (header) {
      const id = 'part-' + headings.length;
      headings.push([
        id,
        header[2].replace(
          /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
          (_, target, label) => label ?? target,
        ),
      ]);
      const tag = header[1].length === 3 ? 'h3' : 'h2';
      output.push('<' + tag + ' id="' + id + '">' + inline(header[2]) + '</' + tag + '>');
      continue;
    }
    if (line.startsWith('{|')) {
      // Keep the table's own class (item-table, loot-table) so it can be styled and enhanced.
      const tableClass = (/class="([\w -]+)"/.exec(line)?.[1] ?? '')
        .split(' ')
        .filter((name) => name && name !== 'wikitable')
        .join(' ');
      const rows = [];
      let cells = [];
      while (++i < lines.length) {
        const value = lines[i].trim();
        if (value === '|-' || value === '|}') {
          if (cells.length) rows.push('<tr>' + cells.join('') + '</tr>');
          cells = [];
          if (value === '|}') break;
        } else if (value.startsWith('!') || value.startsWith('|')) {
          const tag = value[0] === '!' ? 'th' : 'td';
          for (const cell of value.slice(1).split(tag === 'th' ? '!!' : '||'))
            cells.push('<' + tag + '>' + inline(cell.trim()) + '</' + tag + '>');
        }
      }
      output.push(
        '<div class="scroll"><table' +
          (tableClass ? ' class="' + tableClass + '"' : '') +
          '>' +
          rows.join('') +
          '</table></div>',
      );
      continue;
    }
    if (/^\* |^# /.test(line)) {
      const type = line[0] === '*' ? 'ul' : 'ol',
        rows = [line.slice(2)];
      while (i + 1 < lines.length && lines[i + 1].startsWith(line.slice(0, 2)))
        rows.push(lines[++i].slice(2));
      const listClass =
        type === 'ul'
          ? directoryClass?.(rows)
          : headings.at(-1)?.[1] === 'Action route'
            ? 'route-flow'
            : '';
      output.push(
        '<' +
          type +
          (listClass ? ' class="' + listClass + '"' : '') +
          '>' +
          rows
            .map(
              (row) =>
                '<li>' +
                (listClass === 'browse-groups'
                  ? groupTile(row)
                  : (indexIcon?.(row.match(/^\[\[([^\]|]+)/)?.[1]) ?? '') + inline(row)) +
                '</li>',
            )
            .join('') +
          '</' +
          type +
          '>',
      );
      continue;
    }
    // A leading colon is a hatnote: a see-also line that sits above the article.
    if (line.startsWith(":''")) {
      output.push('<p class="hatnote">' + inline(line.slice(1)) + '</p>');
      continue;
    }
    output.push('<p>' + inline(line) + '</p>');
  }
  return { markup: output.join(''), headings };
}

export function addIndexFilter(view) {
  const lists = [...view.querySelectorAll('.browse-records')];
  const rows = lists.flatMap((list) => [...list.children]);
  if (rows.length < 35) return;
  const form = document.createElement('search');
  form.className = 'group-filter';
  form.innerHTML =
    '<label for="group-filter">Find an entry in this list</label><textarea id="group-filter" rows="1" placeholder="Filter by name" spellcheck="false"></textarea><small aria-live="polite"></small>';
  view.querySelector('article').before(form);
  const field = form.querySelector('textarea');
  const result = form.querySelector('small');
  const names = rows.map((row) => row.textContent.toLowerCase());
  field.addEventListener('input', () => {
    const query = field.value.trim().toLowerCase();
    let visible = 0;
    rows.forEach((row, i) => {
      row.hidden = !names[i].includes(query);
      if (!row.hidden) visible++;
    });
    for (const list of lists) {
      list.hidden = ![...list.children].some((row) => !row.hidden);
      const heading = list.previousElementSibling;
      if (heading?.matches('h2,h3')) heading.hidden = list.hidden;
    }
    field.style.height = 'auto';
    field.style.height = field.scrollHeight + 2 + 'px';
    result.textContent = query ? visible + ' matching entries' : '';
  });
}

/** One article from the seed: its wikitext minus the picture lines, its art and categories. */
export function pageRecord(title, source) {
  const artwork = source.match(
    /^<woc-art path="(\/(?:ui|map_bg|textures\/loading)\/[\w/-]+\.(?:webp|png|jpg))" \/>\n/,
  );
  const art = artwork?.[1] || directoryArt(title);
  let text = artwork ? source.slice(artwork[0].length) : source;
  // The large model render, when a creature or NPC has one.
  const modelLine = text.match(
    /^<woc-art path="(\/(?:encyclopedia|guide)-stills\/[\w.-]+\.webp)" size="model" \/>\n/m,
  );
  const model = modelLine?.[1] ?? '';
  if (modelLine) text = text.replace(modelLine[0], '');
  const categories = [...text.matchAll(/\[\[Category:([^\]]+)\]\]/g)].map((m) => m[1]);
  return { title, text, art, model, categories, sort: title.toLocaleLowerCase('en') };
}

/** A small lazy picture the caller fills in (data-game-art), or nothing without a path. */
export const image = (path, className) =>
  path
    ? '<img class="' +
      className +
      '" data-game-art="' +
      escapeHtml(path) +
      '" alt="" width="32" height="32" loading="lazy" decoding="async">'
    : '';

/** Everything the views share across pages: the sorted list, hubs, trails and tile art. */
export function buildSite(pages, assetUrl = (path) => path) {
  const all = [...pages.values()].sort((a, b) => a.title.localeCompare(b.title, 'en'));
  const groups = subjects.map(([name, entries]) => [
    name,
    entries.filter(([key]) => pages.has(key)),
  ]);
  const trails = browseTrails(pages);
  const related = relatedPageIndex(pages);
  const tileArt = new Map();
  for (const [title, page] of pages) {
    if (!isDirectory(page)) continue;
    // A group's picture is the first entry it lists, in a bullet list or a table.
    for (const match of page.text.matchAll(/^(?:\*|\|) (?:<woc-art [^>]*\/> )?\[\[([^\]|]+)/gm)) {
      const art = pages.get(match[1])?.art;
      if (art) {
        tileArt.set(title, art);
        break;
      }
    }
  }
  const groupTile = (row) => {
    const child = directoryLink(row);
    const note = row
      .slice(row.indexOf(']]') + 2)
      .trim()
      .replace(/^·\s*/, '')
      .replace(/^\((\d+)\)$/, (_, n) => n + (n === '1' ? ' entry' : ' entries'));
    const art = pages.get(child.title)?.art || tileArt.get(child.title);
    const preview = tilePreview(pages.get(child.title)?.text ?? '');
    return (
      '<a class="browse-tile' +
      (art ? '' : ' no-art') +
      '" href="' +
      href(child.title) +
      '">' +
      (art ? '<span class="tile-art">' + image(art, 'index-icon') + '</span>' : '') +
      '<span class="tile-copy"><strong>' +
      escapeHtml(child.label) +
      '</strong>' +
      (note ? '<small>' + inline(note) + '</small>' : '') +
      (preview.length > 1
        ? '<span class="tile-preview">' + escapeHtml(preview.join(', ')) + '</span>'
        : '') +
      '</span></a>'
    );
  };
  return { pages, all, groups, trails, related, groupTile, assetUrl };
}

/** The left-hand browse navigation. */
export function navMarkup(site, open) {
  return (
    site.groups
      .map(
        ([name, entries]) =>
          '<details class="topic-nav"' +
          (open ? ' open' : '') +
          '><summary>' +
          escapeHtml(name) +
          '</summary><div>' +
          entries
            .map(
              ([key, label]) =>
                '<a class="navlink" href="' + href(key) + '">' + escapeHtml(label) + '</a>',
            )
            .join('') +
          '</div></details>',
      )
      .join('') +
    '<a class="navlink full-index" href="' +
    href('All Pages') +
    '">A to Z index</a>'
  );
}

/** The encyclopedia's front page. */
export function mainPageMarkup(site) {
  return (
    '<div class="hero"><p class="overline">Eastbrook archives · Player reference</p><h1>Player Encyclopedia</h1><p class="intro">Find an item’s source, follow a quest route, or see how an ability scales.</p><div class="hero-actions"><a href="#Items">Browse items</a><a href="#Quests">Find a quest</a></div></div>' +
    site.groups
      .map(
        ([name, entries]) =>
          '<section class="home-section"><h2>' +
          escapeHtml(name) +
          '</h2><div class="directory">' +
          entries
            .map(
              ([key, label, description]) =>
                '<a class="entry" href="' +
                href(key) +
                '">' +
                image(directoryArt(key), 'entry-icon') +
                '<strong>' +
                escapeHtml(label) +
                '</strong><small>' +
                escapeHtml(description) +
                '</small></a>',
            )
            .join('') +
          '</div></section>',
      )
      .join('') +
    '<p class="foot">' +
    site.all.length.toLocaleString('en') +
    ' articles · ' +
    link('All Pages', 'A to Z index') +
    ' · ' +
    link('Quick Start', 'Getting started') +
    ' · ' +
    link('Sources Used', 'Sources') +
    '</p>'
  );
}

/** The breadcrumb trail above an article: its hub, then the groups between. */
export function pageParents(site, current) {
  const { pages, trails } = site;
  const page = pages.get(current);
  const category =
    page.categories.find((c) => pages.get(c)?.categories.includes('Raids')) ??
    page.categories.find((c) => c !== current && pages.has(c));
  return (
    trails.get(current) ??
    (category ? [...(trails.get(category) ?? []), { title: category, label: category }] : [])
  );
}

/**
 * Renders one article into `view` and runs the layout passes over it. `wide` opens the
 * contents and browse lists as a wide screen shows them. Returns whether the page is a
 * directory, so the caller can add its list filter. `seeAllLinks` swaps the lazy
 * "Show all" lists in the related pages box for a link to the group's own page.
 */
export function renderArticle(view, site, current, wide, { seeAllLinks = false } = {}) {
  const { pages } = site;
  const page = pages.get(current);
  const directory = isDirectory(page);
  const indexIcon =
    directory || current === 'All Pages'
      ? (title) => image(pages.get(title)?.art, 'index-icon')
      : undefined;
  const directoryClass = (rows) => {
    if (!directory || !rows.every((row) => directoryLink(row))) return '';
    if (
      isCollection(page) &&
      !rows.every((row) => pages.get(directoryLink(row).title)?.categories[0] === page.title)
    )
      return '';
    return rows.every((row) => isDirectory(pages.get(directoryLink(row).title))) ||
      current === 'Gameplay Systems'
      ? 'browse-groups'
      : 'browse-records';
  };
  const mapUrl = (id) => site.assetUrl('/map_bg/' + id + '.webp');
  const { markup, headings } = renderBody(
    page.text,
    mapUrl,
    indexIcon,
    directoryClass,
    site.groupTile,
  );
  const parents = pageParents(site, current);
  view.innerHTML =
    '<div class="crumb">' +
    link('Main Page', 'Encyclopedia') +
    parents.map(({ title, label }) => ' / ' + link(title, label)).join('') +
    '</div><div class="article-heading">' +
    (page.model
      ? image(page.model, 'article-art model')
      : image(
          page.art,
          /^\/(?:map_bg|textures\/loading)/.test(page.art) ? 'article-art wide' : 'article-art',
        )) +
    '<h1>' +
    escapeHtml(displayTitle(current)) +
    '</h1></div><div class="tags">' +
    page.categories
      // Lowercase categories are internal sort keys (biome, family, quality), not topics.
      .filter((c) => c !== 'Portals' && !c.endsWith(' directories') && !/^[a-z]/.test(c))
      .map((c) =>
        pages.has(c) && c !== current
          ? '<a class="tag" href="' + href(c) + '">' + escapeHtml(displayTitle(c)) + '</a>'
          : '<span class="tag">' + escapeHtml(displayTitle(c)) + '</span>',
      )
      .join('') +
    '</div>' +
    ((directory || current === 'All Pages') && headings.length > 2
      ? '<nav class="jump" aria-label="On this page">' +
        headings
          .map(
            ([id, title]) =>
              '<a href="' +
              href(current) +
              '" data-part="' +
              id +
              '">' +
              escapeHtml(title) +
              '</a>',
          )
          .join('') +
        '</nav>'
      : '') +
    '<article>' +
    markup +
    '</article><p class="foot">' +
    link('Main Page', 'Return to the encyclopedia') +
    '</p>';
  if (directory) layoutDirectory(view, page, wide);
  else if (current !== 'All Pages')
    layoutArticle(
      view,
      page,
      wide,
      page.categories.find((c) => pages.get(c)?.categories.includes('Zones')),
    );
  if (current !== 'All Pages') mountRelatedPages(view, page, site.related, pages, { seeAllLinks });
  markZoomable(view);
  return directory;
}
