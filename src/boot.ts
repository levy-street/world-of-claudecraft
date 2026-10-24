// index.html's entry. A plain first visit paints the landing page without the game
// client: src/ui/landing_first.ts lifts the boot splash once the stylesheets are in,
// prefetches the client after the page has loaded, and starts it on the visitor's
// first interaction. Every other visit (src/ui/landing_first_core.ts, bootModeFor)
// starts the client straight away, exactly as before. play.html loads src/main.ts
// directly. The style barrel is imported here so the build links it from the HTML.
import './styles/index.css';
import { DESKTOP_APP, NATIVE_APP } from './client_origin';
import { BOOT_PENDING_CLASS, BOOT_SPLASH_ID } from './ui/boot_splash_core';
import { ART_DEFERRED_CLASS, afterLoadSettles, runLandingFirst } from './ui/landing_first';
import { bootModeFor } from './ui/landing_first_core';

function storageGetter(storage: () => Storage): (key: string) => string | null {
  return (key) => {
    try {
      return storage().getItem(key);
    } catch {
      return null;
    }
  };
}

const startClient = () => import('./main');

// The backdrop video's poster only shows in the native and desktop shells (the website
// hides the video), so index.html carries it as data-poster rather than every visit
// downloading it, and the shells apply it here, before main.ts reads it.
if (NATIVE_APP || DESKTOP_APP) {
  const video = document.getElementById('bg-home') as HTMLVideoElement | null;
  if (video?.dataset.poster) video.poster = video.dataset.poster;
}

// index.html marks the slideshow's later scenes deferred so their images do not compete
// with the first paint (src/styles/shell.website.css); release them once it settles.
afterLoadSettles(() => {
  document.getElementById('start-screen-backdrop')?.classList.remove('scenes-deferred');
});

const mode = bootModeFor({
  pathname: location.pathname,
  search: location.search,
  nativeApp: NATIVE_APP,
  desktopApp: DESKTOP_APP,
  stored: storageGetter(() => localStorage),
  session: storageGetter(() => sessionStorage),
});

if (mode === 'game') {
  // The client paints behind the boot splash as before, artwork included.
  document.getElementById('start-screen')?.classList.remove(ART_DEFERRED_CLASS);
  startClient().catch((err: unknown) => {
    // A dynamic import that fails (or throws while evaluating) rejects here rather than
    // firing the script error the inline splash fail-safe listens for, so release the
    // splash the same way it would: show the page instead of a spinner.
    console.error('game client failed to load:', err);
    document.body.classList.remove(BOOT_PENDING_CLASS);
    document.getElementById(BOOT_SPLASH_ID)?.remove();
  });
} else {
  runLandingFirst(startClient);
}
