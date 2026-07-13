type SharedHeaderPage = 'play' | 'community';

interface SharedHeaderOptions {
  page: SharedHeaderPage;
}

const navArc = `<svg class="nav-arc" viewBox="0 0 160 18" preserveAspectRatio="none" aria-hidden="true" focusable="false" shape-rendering="geometricPrecision"><use class="nav-arc__under" href="#site-nav-arc-path"></use><use class="nav-arc__core" href="#site-nav-arc-path"></use><g class="nav-arc__spark"><circle class="nav-arc__spark-halo" cx="80" cy="12.625" r="1.9"></circle><circle class="nav-arc__spark-core" cx="80" cy="12.625" r="0.9"></circle></g></svg>`;

function navLink(
  id: string,
  label: string,
  href: string,
  options: { active?: boolean; i18n?: string; itemClass?: string } = {},
): string {
  const active = options.active ? ' active" aria-current="page' : '';
  const i18n = options.i18n ? ` data-i18n="${options.i18n}"` : '';
  const itemClass = options.itemClass ? ` ${options.itemClass}` : '';
  return `<li class="nav-item${itemClass}"><a class="nav-link${active}" id="${id}" href="${href}"><span class="nav-link-label"${i18n}>${label}</span>${navArc}</a></li>`;
}

function menuButton(id: string, label: string, i18n: string): string {
  return `<li class="nav-item"><button type="button" class="nav-link" id="${id}"><span class="nav-link-label" data-i18n="${i18n}">${label}</span>${navArc}</button></li>`;
}

export function headerMarkup(page: SharedHeaderPage): string {
  const community = page === 'community';
  const login = community
    ? navLink('nav-btn-login', 'Login/Register', '/play', {
        i18n: 'nav.loginRegister',
        itemClass: 'nav-item-login',
      })
    : `<li class="nav-item nav-item-login"><button type="button" class="nav-link" id="nav-btn-login"><span class="nav-link-label" data-i18n="nav.loginRegister">Login/Register</span>${navArc}</button></li>`;
  const accountItems = community
    ? ''
    : `<li class="nav-item" id="nav-item-account" hidden><button type="button" class="nav-link" id="nav-btn-account"><span class="nav-link-label" data-i18n="nav.account">Account</span>${navArc}</button></li>
        <li class="nav-item" id="nav-item-logout" hidden><button type="button" class="nav-link" id="nav-btn-logout"><span class="nav-link-label" data-i18n="nav.logout">Logout</span>${navArc}</button></li>`;
  const music = `<button type="button" class="homepage-music-btn homepage-music-btn--drawer" id="homepage-music-toggle" data-homepage-music-toggle data-i18n-title="hud.options.music" data-i18n-aria="hud.options.music" title="Music" aria-label="Music" aria-pressed="true"><span class="header-control-icon header-control-icon--music-on" aria-hidden="true"></span><span class="header-control-icon header-control-icon--music-muted" aria-hidden="true"></span></button>`;

  return `<header class="homepage-header">
  <div class="header-logo-container">
    <button type="button" class="header-logo-btn" id="header-logo-btn" data-i18n-aria="a11y.goHome" data-i18n-title="a11y.goHome" aria-label="Go to homepage" title="Go to homepage">
      <img class="header-logo" src="/woc-logo-square-320-v1.webp" srcset="/woc-logo-square-128-v1.webp 128w, /woc-logo-square-192-v1.webp 192w" sizes="(max-width: 767px) 50px, 96px" width="96" height="96" data-i18n-alt="serverUnavailable.logoAlt" alt="World of ClaudeCraft" />
    </button>
  </div>
  <svg class="visually-hidden site-nav-arc-defs" width="0" height="0" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="site-nav-arc-body-gradient" gradientUnits="userSpaceOnUse" x1="4" x2="156"><stop offset="0" stop-color="#cf8210" stop-opacity=".55"></stop><stop offset=".14" stop-color="#efa91a" stop-opacity=".94"></stop><stop offset=".36" stop-color="#ffc52a"></stop><stop offset=".5" stop-color="#ffd846"></stop><stop offset=".64" stop-color="#ffc52a"></stop><stop offset=".86" stop-color="#efa91a" stop-opacity=".94"></stop><stop offset="1" stop-color="#cf8210" stop-opacity=".55"></stop></linearGradient>
      <linearGradient id="site-nav-arc-gradient" gradientUnits="userSpaceOnUse" x1="4" x2="156"><stop offset="0" stop-color="#df9415" stop-opacity=".9"></stop><stop offset=".14" stop-color="#f6b11d"></stop><stop offset=".36" stop-color="#ffca2b"></stop><stop offset=".5" stop-color="#ffe24b"></stop><stop offset=".64" stop-color="#ffca2b"></stop><stop offset=".86" stop-color="#f6b11d"></stop><stop offset="1" stop-color="#df9415" stop-opacity=".9"></stop></linearGradient>
      <path id="site-nav-arc-path" d="M4 2.5 C39 16 121 16 156 2.5" pathLength="100"></path>
    </defs>
  </svg>
  <span class="mobile-current-nav-label" id="mobile-current-nav-label" aria-hidden="true" data-i18n="nav.${community ? 'communityBuilt' : 'play'}">${community ? 'Community Built' : 'Play'}</span>
  <button type="button" class="homepage-music-btn homepage-music-btn--compact" id="homepage-music-toggle-mobile" data-homepage-music-toggle data-i18n-title="hud.options.music" data-i18n-aria="hud.options.music" title="Music" aria-label="Music" aria-pressed="true"><span class="header-control-icon header-control-icon--music-on" aria-hidden="true"></span><span class="header-control-icon header-control-icon--music-muted" aria-hidden="true"></span></button>
  <button type="button" class="mobile-menu-toggle" id="mobile-menu-toggle" data-i18n-aria="a11y.toggleMenu" aria-label="Toggle menu" aria-controls="header-menu-container" aria-expanded="false"><span class="header-control-icon header-control-icon--menu" aria-hidden="true"></span><span class="header-control-icon header-control-icon--close" aria-hidden="true"></span></button>
  <div class="header-menu-container" id="header-menu-container">
    <nav data-i18n-aria="a11y.mainNavigation" aria-label="Main navigation" class="homepage-nav">
      <ul class="nav-list" role="list">
        ${navLink('nav-btn-play', 'Play', '/', { active: !community, i18n: 'nav.play' })}
        ${navLink('nav-btn-highscores', 'High Scores', '/highscores', { i18n: 'nav.highscores' })}
        ${menuButton('nav-btn-wiki', 'Wiki', 'nav.wiki')}
        ${navLink('nav-btn-patch-notes', 'Patch Notes', '/patch-notes', { i18n: 'landing.patchNotesLabel' })}
        ${navLink('nav-btn-news', 'News', '/news', { i18n: 'nav.news' })}
        ${navLink('nav-btn-community-built', 'Community Built', '/community', { active: community, i18n: 'nav.communityBuilt' })}
        ${navLink('nav-btn-download', 'Download', '/download', { i18n: 'nav.download' })}
        ${login}
        ${accountItems}
      </ul>
    </nav>
    <div class="header-actions">
      ${music}
      <a class="donate-cta" href="https://ko-fi.com/worldofclaudecraft" target="_blank" rel="noopener noreferrer" data-i18n-title="a11y.donateProject" data-i18n-aria="a11y.donateProject" title="Support the project" aria-label="Donate to support World of ClaudeCraft"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg><span data-i18n="nav.donate">Donate</span></a>
    </div>
  </div>
</header>
<div class="header-menu-scrim" aria-hidden="true"></div>`;
}

export function mountSharedMarketingHeader(options: SharedHeaderOptions): void {
  const root = document.querySelector<HTMLElement>('[data-shared-marketing-header]');
  if (!root) return;
  root.outerHTML = headerMarkup(options.page);

  if (options.page === 'community') {
    document.getElementById('header-logo-btn')?.addEventListener('click', () => {
      window.location.assign('/');
    });
    document.getElementById('nav-btn-wiki')?.addEventListener('click', () => {
      window.location.assign('/wiki');
    });
  }
}
