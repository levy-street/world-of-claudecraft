import { initMarketingMusic } from './marketing_music';
import { mountSharedMarketingHeader } from './shared_marketing_header';

mountSharedMarketingHeader({ page: 'community' });
initMarketingMusic();

const header = document.querySelector<HTMLElement>('.homepage-header');
const menu = document.getElementById('header-menu-container');
const toggle = document.getElementById('mobile-menu-toggle') as HTMLButtonElement | null;
const scrim = document.querySelector<HTMLElement>('.header-menu-scrim');
const disclosureMedia = window.matchMedia('(max-width: 1151px)');

function syncDrawerTop(): void {
  if (!header) return;
  header.style.setProperty(
    '--site-header-drawer-viewport-top',
    `${Math.ceil(header.getBoundingClientRect().bottom)}px`,
  );
}

function setMenuOpen(requestedOpen: boolean, restoreFocus = false): void {
  if (!header || !menu || !toggle) return;
  syncDrawerTop();
  const open = disclosureMedia.matches && requestedOpen;
  header.classList.toggle('menu-open', open);
  document.body.classList.toggle('site-header-menu-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  menu.inert = disclosureMedia.matches && !open;
  menu.setAttribute('aria-hidden', disclosureMedia.matches ? String(!open) : 'false');
  if (!open && restoreFocus) toggle.focus();
}

toggle?.addEventListener('click', () => {
  setMenuOpen(!header?.classList.contains('menu-open'));
});

scrim?.addEventListener('click', () => setMenuOpen(false, true));

menu?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => setMenuOpen(false));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && header?.classList.contains('menu-open')) {
    event.preventDefault();
    setMenuOpen(false, true);
  }
});

document.addEventListener('pointerdown', (event) => {
  if (
    header?.classList.contains('menu-open') &&
    event.target instanceof Node &&
    !header.contains(event.target)
  ) {
    setMenuOpen(false);
  }
});

window.addEventListener('resize', syncDrawerTop, { passive: true });
disclosureMedia.addEventListener('change', () => setMenuOpen(false));
setMenuOpen(false);
