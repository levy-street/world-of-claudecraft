import { layoutArticle, sectionRoute } from './article_layout.js';
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
import { mountWikiTooltips } from './hover_tooltip.js';
import { mountRelatedPages, relatedPageIndex } from './related_pages.js';
import { tooltipLookup } from './tooltip_content.js';

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
const href = (title) => '#' + encodeURIComponent(title);
const link = (title, label = title) =>
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

function inline(s) {
  const tokens = [];
  function keep(value) {
    tokens.push(value);
    return '\uE000' + (tokens.length - 1) + '\uE001';
  }
  const icon = s.match(/^<woc-art path="(\/ui\/[A-Za-z0-9_/-]+\.webp)" size="icon" \/>\s*/);
  if (icon) s = s.slice(icon[0].length);
  s = s
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
  if (!icon) return content;
  return (
    '<img class="ability-icon" data-game-art="' +
    escapeHtml(icon[1]) +
    '" alt="" width="32" height="32" loading="lazy" decoding="async"><span>' +
    content +
    '</span>'
  );
}

function renderBody(body, mapUrl, indexIcon, directoryClass, groupTile) {
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
      output.push('<div class="scroll"><table>' + rows.join('') + '</table></div>');
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
    output.push('<p>' + inline(line) + '</p>');
  }
  return { markup: output.join(''), headings };
}

function addIndexFilter(view) {
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

async function readPayload(url, packed) {
  if (packed) {
    const bytes = Uint8Array.from(atob(packed), (s) => s.charCodeAt(0));
    return new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();
  }
  const response = await fetch(url);
  if (!response.ok) throw Error('Could not load the encyclopedia data.');
  return response.text();
}

export async function openReader({ seedUrl, packed, cardsUrl, packedCards, assetUrl }) {
  const view = document.querySelector('#view'),
    input = document.querySelector('#lookup'),
    nav = document.querySelector('#navigation');
  const cover = assetUrl('/website-hero-eastbrook-v1.webp');
  const mapUrl = (id) => assetUrl('/map_bg/' + id + '.webp');
  const image = (path, className) =>
    path
      ? '<img class="' +
        className +
        '" data-game-art="' +
        escapeHtml(path) +
        '" alt="" width="32" height="32" loading="lazy" decoding="async">'
      : '';
  const observer = new IntersectionObserver(
    (changes) => {
      for (const { target, isIntersecting } of changes)
        if (isIntersecting) {
          target.src = assetUrl(target.dataset.gameArt);
          observer.unobserve(target);
        }
    },
    { rootMargin: '300px' },
  );
  function loadArt() {
    observer.disconnect();
    for (const el of view.querySelectorAll('[data-game-art]')) observer.observe(el);
  }
  try {
    const lookupReady =
      cardsUrl || packedCards
        ? readPayload(cardsUrl, packedCards)
            .then((text) => tooltipLookup(JSON.parse(text), assetUrl))
            .catch((error) => {
              console.error('Unable to load encyclopedia tooltips', error);
              return null;
            })
        : null;
    const xmlText = await readPayload(seedUrl, packed);
    const dom = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (dom.querySelector('parsererror')) throw Error('Could not read the article index.');
    const pages = new Map();
    for (const page of dom.getElementsByTagName('page')) {
      const title = page.getElementsByTagName('title')[0].textContent;
      if (title.startsWith('MediaWiki:')) continue;
      const source = page.getElementsByTagName('text')[0].textContent;
      const artwork = source.match(
        /^<woc-art path="(\/(?:ui|map_bg|textures\/loading)\/[\w/-]+\.(?:webp|png|jpg))" \/>\n/,
      );
      const art = artwork?.[1] || directoryArt(title);
      const text = artwork ? source.slice(artwork[0].length) : source;
      const categories = [...text.matchAll(/\[\[Category:([^\]]+)\]\]/g)].map((m) => m[1]);
      pages.set(title, { title, text, art, categories, sort: title.toLocaleLowerCase('en') });
    }
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
      for (const match of page.text.matchAll(/^\* \[\[([^\]|]+)/gm)) {
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
    const wideNav = window.matchMedia('(min-width: 768px)');
    const drawer = document.querySelector('.browse-drawer');
    if (drawer) drawer.open = wideNav.matches;
    nav.innerHTML =
      groups
        .map(
          ([name, entries]) =>
            '<details class="topic-nav"' +
            (wideNav.matches ? ' open' : '') +
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
      '">A to Z index</a>';
    function openNavGroups(open) {
      for (const group of nav.querySelectorAll('details')) group.open = open;
    }
    wideNav.addEventListener('change', (event) => {
      openNavGroups(event.matches);
      if (drawer) drawer.open = event.matches;
      const contents = view.querySelector('.directory-contents');
      if (contents) contents.open = event.matches;
    });
    nav.addEventListener('click', (event) => {
      if (!wideNav.matches && event.target.closest('a')) {
        openNavGroups(false);
        if (drawer) drawer.open = false;
      }
    });
    document.documentElement.style.setProperty('--cover', 'url("' + cover + '")');
    let timer;
    function route() {
      try {
        return sectionRoute(location.hash).article;
      } catch {
        return 'Main Page';
      }
    }
    function search(q, limit = 70) {
      view.classList.remove('wiki-directory', 'activity-directory');
      const search = q.toLocaleLowerCase('en').trim(),
        terms = search.split(/\s+/).filter(Boolean);
      const named = all.filter((p) => terms.every((t) => p.sort.includes(t)));
      const namedSet = new Set(named);
      const full =
        terms.length && q.length >= 3
          ? all.filter(
              (p) =>
                !namedSet.has(p) &&
                !p.categories.includes('Portals') &&
                p.title !== 'All Pages' &&
                terms.every((t) => p.text.toLowerCase().includes(t)),
            )
          : [];
      const found = [...named, ...full];
      view.innerHTML =
        '<p class="overline">Article search</p><h1>' +
        escapeHtml(q || 'All articles') +
        '</h1><p>' +
        found.length.toLocaleString('en') +
        ' results</p><ul class="results">' +
        found
          .slice(0, limit)
          .map(
            (p) =>
              '<li class="result">' +
              image(p.art, 'result-icon') +
              link(p.title) +
              ' <small>' +
              escapeHtml(p.categories[0] || 'Reference') +
              '</small></li>',
          )
          .join('') +
        '</ul>' +
        (found.length > limit ? '<button id="more">Show more results</button>' : '');
      loadArt();
      document.querySelector('#more')?.addEventListener('click', () => search(q, limit + 100));
    }
    function show() {
      view.classList.remove('wiki-directory', 'activity-directory');
      const current = route();
      for (const a of nav.querySelectorAll('a')) {
        if (a.hash === href(current)) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
      if (current.startsWith('search=')) {
        const q = current.slice(7);
        input.value = q;
        search(q);
        return;
      }
      input.value = '';
      view.dataset.article = current;
      const page = pages.get(current);
      document.title =
        (current === 'Main Page' ? 'Player Encyclopedia' : displayTitle(current)) +
        ' | World of ClaudeCraft';
      if (!page) {
        view.innerHTML =
          '<h1>Article unavailable</h1><p>' +
          link('All Pages', 'Browse the complete index') +
          '</p>';
        return;
      }
      if (current === 'Main Page') {
        view.innerHTML =
          '<div class="hero"><p class="overline">Eastbrook archives · Player reference</p><h1>Player Encyclopedia</h1><p class="intro">Find an item’s source, follow a quest route, or see how an ability scales.</p><div class="hero-actions"><a href="#Items">Browse items</a><a href="#Quests">Find a quest</a></div></div>' +
          groups
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
          all.length.toLocaleString('en') +
          ' articles · ' +
          link('All Pages', 'A to Z index') +
          ' · ' +
          link('Quick Start', 'Getting started') +
          ' · ' +
          link('Sources Used', 'Sources') +
          '</p>';
        loadArt();
        return;
      }
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
      const { markup, headings } = renderBody(
        page.text,
        mapUrl,
        indexIcon,
        directoryClass,
        groupTile,
      );
      const category =
        page.categories.find((c) => pages.get(c)?.categories.includes('Raids')) ??
        page.categories.find((c) => c !== current && pages.has(c));
      const parents =
        trails.get(current) ??
        (category ? [...(trails.get(category) ?? []), { title: category, label: category }] : []);
      view.innerHTML =
        '<div class="crumb">' +
        link('Main Page', 'Encyclopedia') +
        parents.map(({ title, label }) => ' / ' + link(title, label)).join('') +
        '</div><div class="article-heading">' +
        image(
          page.art,
          /^\/(?:map_bg|textures\/loading)/.test(page.art) ? 'article-art wide' : 'article-art',
        ) +
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
      if (directory) {
        layoutDirectory(view, page, wideNav.matches);
        addIndexFilter(view);
      } else if (current !== 'All Pages')
        layoutArticle(
          view,
          page,
          wideNav.matches,
          page.categories.find((c) => pages.get(c)?.categories.includes('Zones')),
        );
      if (current !== 'All Pages') mountRelatedPages(view, page, related, pages);
      loadArt();
      for (const a of view.querySelectorAll('[data-part]')) {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById(a.dataset.part)?.scrollIntoView();
        });
      }
    }
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = input.value;
        history.replaceState(null, '', href('search=' + s));
        search(s);
      }, 140);
    });
    window.addEventListener('hashchange', () => {
      clearTimeout(timer);
      show();
      if (!scrollToSection()) {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        view.focus({ preventScroll: true });
      }
    });
    function scrollToSection() {
      let target;
      try {
        const section = sectionRoute(location.hash).section;
        target = section && document.getElementById('section-' + section);
      } catch {
        return false;
      }
      if (!target) return false;
      for (let node = target.parentElement; node; node = node.parentElement) {
        if (node.tagName === 'DETAILS') node.open = true;
      }
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      target.focus({ preventScroll: true });
      return true;
    }
    show();
    scrollToSection();
    const lookup = await lookupReady;
    if (lookup) mountWikiTooltips(view, lookup);
  } catch (error) {
    view.textContent = 'The encyclopedia could not open. ' + error.message;
  }
}
