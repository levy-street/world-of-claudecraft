const SOUND_KEY = 'woc_expedition_sound';
let enabled: boolean | undefined;
let listening = false;

/** One cached preference shared by the notification poll and the Groups control. */
export function notificationSoundEnabled(): boolean {
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.addEventListener('storage', (event) => {
      if (event.key === SOUND_KEY) enabled = event.newValue === '1';
      else if (event.key === null) enabled = false;
    });
  }
  if (enabled === undefined) {
    try {
      enabled = localStorage.getItem(SOUND_KEY) === '1';
    } catch {
      enabled = false;
    }
  }
  return enabled;
}

export function setNotificationSound(value: boolean): void {
  enabled = value;
  try {
    localStorage.setItem(SOUND_KEY, value ? '1' : '0');
  } catch {
    // The preference remains usable for this session without storage.
  }
}
