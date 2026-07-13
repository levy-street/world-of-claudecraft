const MARKETING_MUSIC_MUTED_KEY = 'woc_homepage_music_muted';
const MARKETING_MUSIC_VOLUME = 0.225;

let marketingMusic: HTMLAudioElement | null = null;
let marketingMusicStarted = false;
let marketingMusicMuted = readMarketingMusicMuted();
let marketingMusicControlsWired = false;
let removeMarketingMusicGestureListeners: (() => void) | null = null;

function readMarketingMusicMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MARKETING_MUSIC_MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMarketingMusicMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MARKETING_MUSIC_MUTED_KEY, muted ? '1' : '0');
  } catch {
    // Private browsing or storage failures should not block the control.
  }
}

function syncMarketingMusicToggle(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-homepage-music-toggle]').forEach((btn) => {
    btn.classList.toggle('is-muted', marketingMusicMuted);
    btn.setAttribute('aria-pressed', String(!marketingMusicMuted));
  });
}

function createMarketingMusic(): HTMLAudioElement {
  const el = new Audio();
  el.preload = 'none';
  el.src = '/audio/main-theme.mp3';
  el.loop = true;
  el.muted = marketingMusicMuted;
  el.volume = MARKETING_MUSIC_VOLUME;
  marketingMusic = el;
  return el;
}

function playMarketingMusic(): void {
  if (marketingMusicMuted || marketingMusicStarted) return;
  const el = marketingMusic ?? createMarketingMusic();
  void el
    .play()
    .then(() => {
      marketingMusicStarted = true;
      removeMarketingMusicGestureListeners?.();
      removeMarketingMusicGestureListeners = null;
    })
    .catch(() => {
      // A later trusted gesture or explicit unmute can retry.
    });
}

function setMarketingMusicMuted(muted: boolean): void {
  marketingMusicMuted = muted;
  saveMarketingMusicMuted(muted);
  const el = marketingMusic;
  if (el) el.muted = muted;
  if (muted) {
    el?.pause();
    marketingMusicStarted = false;
  } else {
    playMarketingMusic();
  }
  syncMarketingMusicToggle();
}

// Looping marketing theme. Startup only installs gesture listeners: the audio
// element and its URL are created after a trusted interaction or explicit unmute,
// so the theme never consumes bandwidth during the initial page load.
export function initMarketingMusic(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-homepage-music-toggle]');
  if (!buttons.length) return;

  syncMarketingMusicToggle();
  if (!marketingMusicControlsWired) {
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        setMarketingMusicMuted(!marketingMusicMuted);
      });
    });
    marketingMusicControlsWired = true;
  }

  if (marketingMusic || removeMarketingMusicGestureListeners) return;
  const gestureEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
  removeMarketingMusicGestureListeners = (): void => {
    gestureEvents.forEach((event) => {
      window.removeEventListener(event, onGesture);
    });
  };
  const onGesture = (): void => playMarketingMusic();
  gestureEvents.forEach((event) => {
    window.addEventListener(event, onGesture, { passive: true });
  });
}

export function fadeOutMarketingMusic(durationMs = 1600): void {
  const el = marketingMusic;
  if (!el) return;
  marketingMusic = null;
  removeMarketingMusicGestureListeners?.();
  removeMarketingMusicGestureListeners = null;
  const startVolume = el.volume;
  const steps = 32;
  let step = 0;
  const intervalId = window.setInterval(() => {
    step += 1;
    el.volume = Math.max(0, startVolume * (1 - step / steps));
    if (step >= steps) {
      window.clearInterval(intervalId);
      el.pause();
      marketingMusicStarted = false;
    }
  }, durationMs / steps);
}
