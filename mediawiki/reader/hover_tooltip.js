// The index, search results and article body all use the same canonical links.
// Delegate from the reader so replacing an article never leaves stale listeners.
export function mountWikiTooltips(view, lookup, { titleForLink } = {}) {
  const doc = view.ownerDocument;
  const win = doc.defaultView;
  const tip = doc.createElement('div');
  tip.className = 'wiki-game-tooltip';
  tip.id = 'wiki-game-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  doc.body.append(tip);
  const events = new AbortController();
  const opts = { signal: events.signal };
  let anchor = null;
  let leaveTimer;
  let holdTimer;
  let hold = null;
  let heldAnchor = null;
  const linkSelector = titleForLink ? 'a[href]' : 'a[href^="#"]';

  function targetFor(node) {
    if (!(node instanceof Element) || !view.contains(node)) return null;
    const link = node.closest(linkSelector);
    if (link) return link;
    if (node.matches('.ability-icon, .woc-inline-art, .index-icon, .result-icon')) {
      return node.closest('li')?.querySelector(linkSelector) ?? null;
    }
    return node.closest('.article-art, .woc-page-art, .article-heading h1');
  }

  function titleFor(el) {
    if (el.tagName !== 'A') return view.dataset.article;
    if (titleForLink) return titleForLink(el);
    try {
      const target = el.hash.slice(1);
      return target.includes('#') ? null : decodeURIComponent(target);
    } catch {
      return null;
    }
  }

  function hide() {
    win.clearTimeout(leaveTimer);
    if (anchor) {
      const ids = (anchor.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== tip.id);
      if (ids.length) anchor.setAttribute('aria-describedby', ids.join(' '));
      else anchor.removeAttribute('aria-describedby');
    }
    anchor = null;
    tip.hidden = true;
    tip.replaceChildren();
  }

  function position() {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = doc.documentElement.clientWidth;
    const height = doc.documentElement.clientHeight;
    if (!view.contains(anchor) || !rect.width || rect.bottom <= 0 || rect.top >= height) {
      hide();
      return;
    }
    const margin = 8,
      gap = 5;
    const tipWidth = tip.offsetWidth;
    const right = rect.right + gap + tipWidth <= width - margin;
    const left = rect.left - gap - tipWidth >= margin;
    const above = rect.top - gap - margin;
    const below = height - rect.bottom - gap - margin;
    const maxHeight = height - margin * 2;
    const side = right || left;
    tip.style.maxHeight =
      (side ? maxHeight : Math.min(maxHeight, Math.max(above, below, 64))) + 'px';
    const x = right ? rect.right + gap : left ? rect.left - gap - tipWidth : rect.left;
    const y = side
      ? rect.top
      : below >= above
        ? rect.bottom + gap
        : rect.top - gap - tip.offsetHeight;
    tip.style.left = Math.max(margin, Math.min(x, width - margin - tipWidth)) + 'px';
    tip.style.top = Math.max(margin, Math.min(y, height - margin - tip.offsetHeight)) + 'px';
  }

  function show(el) {
    win.clearTimeout(leaveTimer);
    if (!el || !view.contains(el)) {
      hide();
      return false;
    }
    if (anchor === el) return true;
    const title = titleFor(el);
    const fragment = title && lookup(title);
    hide();
    if (!fragment) return false;
    anchor = el;
    const ids = el.getAttribute('aria-describedby');
    el.setAttribute('aria-describedby', ids ? ids + ' ' + tip.id : tip.id);
    tip.append(fragment);
    tip.hidden = false;
    tip.scrollTop = 0;
    position();
    return !tip.hidden;
  }

  function scheduleLeave(related) {
    if (!anchor || tip.contains(related) || targetFor(related) === anchor) return;
    win.clearTimeout(leaveTimer);
    leaveTimer = win.setTimeout(() => {
      if (!tip.matches(':hover') && doc.activeElement !== anchor) hide();
    }, 160);
  }

  function cancelHold() {
    win.clearTimeout(holdTimer);
    hold = null;
  }

  view.addEventListener(
    'pointerover',
    (e) => {
      if (e.pointerType === 'touch') return;
      const el = targetFor(e.target);
      if (el) show(el);
    },
    opts,
  );
  view.addEventListener(
    'pointerout',
    (e) => {
      if (e.pointerType !== 'touch') scheduleLeave(e.relatedTarget);
    },
    opts,
  );
  tip.addEventListener('pointerenter', () => win.clearTimeout(leaveTimer), opts);
  tip.addEventListener('pointerleave', (e) => scheduleLeave(e.relatedTarget), opts);
  view.addEventListener('focusin', (e) => show(targetFor(e.target)), opts);
  view.addEventListener('focusout', (e) => scheduleLeave(e.relatedTarget), opts);

  doc.addEventListener(
    'pointerdown',
    (e) => {
      cancelHold();
      heldAnchor = null;
      if (tip.contains(e.target)) return;
      const el = targetFor(e.target);
      if (el !== anchor) hide();
      if (e.pointerType !== 'touch' || !el) return;
      hold = { el, x: e.clientX, y: e.clientY };
      holdTimer = win.setTimeout(() => {
        if (show(el)) heldAnchor = el;
        cancelHold();
      }, 480);
    },
    opts,
  );
  doc.addEventListener(
    'pointermove',
    (e) => {
      if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) cancelHold();
    },
    opts,
  );
  doc.addEventListener('pointercancel', cancelHold, opts);
  doc.addEventListener('pointerup', cancelHold, opts);
  view.addEventListener(
    'contextmenu',
    (e) => {
      if (heldAnchor && heldAnchor === targetFor(e.target)) e.preventDefault();
      else if (hold && hold.el === targetFor(e.target) && show(hold.el)) {
        heldAnchor = hold.el;
        cancelHold();
        e.preventDefault();
      }
    },
    opts,
  );
  view.addEventListener(
    'click',
    (e) => {
      if (heldAnchor && heldAnchor === targetFor(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
      heldAnchor = null;
    },
    { ...opts, capture: true },
  );

  doc.addEventListener(
    'keydown',
    (e) => {
      if (!anchor) return;
      if (e.key === 'Escape') {
        hide();
        return;
      }
      if (doc.activeElement !== anchor || tip.scrollHeight <= tip.clientHeight) return;
      const delta = {
        ArrowDown: 32,
        ArrowUp: -32,
        PageDown: tip.clientHeight,
        PageUp: -tip.clientHeight,
      }[e.key];
      if (delta) {
        e.preventDefault();
        tip.scrollTop += delta;
      }
    },
    opts,
  );
  win.addEventListener('resize', position, opts);
  win.addEventListener(
    'scroll',
    (e) => {
      if (!tip.contains(e.target instanceof Node ? e.target : null)) position();
    },
    { ...opts, capture: true, passive: true },
  );
  win.addEventListener('hashchange', hide, opts);
  view.addEventListener('input', hide, opts);
  const refresh = () => {
    if (anchor && !view.contains(anchor)) hide();
    if (hold && !view.contains(hold.el)) cancelHold();
    const isGameArticle = [...view.querySelectorAll('.tags .tag')].some((tag) =>
      ['Items', 'Abilities'].includes(tag.textContent),
    );
    const heading = isGameArticle && view.querySelector('.article-heading h1');
    if (heading) heading.tabIndex = 0;
  };
  const changes = new MutationObserver(refresh);
  changes.observe(view, { childList: true });
  refresh();
  // If the catalog arrived after the article, honour a pointer or focus already on a link.
  const focused = targetFor(doc.activeElement);
  if (!focused || !show(focused)) {
    const hovered = targetFor([...view.querySelectorAll(':hover')].at(-1));
    if (hovered) show(hovered);
  }
  return () => {
    hide();
    cancelHold();
    changes.disconnect();
    events.abort();
    tip.remove();
  };
}
