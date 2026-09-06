// The nameplate compositor's image cache: one HTMLImageElement per URL, LRU
// trimmed to NAMEPLATE_IMAGE_CACHE_LIMIT, with a bounded exponential retry after a
// failed load so a missing badge or aura icon never re-requests every frame.
// Lifted out of nameplate_canvas.ts so that file stays a compositor; the surface
// owns one instance and drives it through beginFrame()/get().

export const NAMEPLATE_IMAGE_CACHE_LIMIT = 160;
export const NAMEPLATE_IMAGE_RETRY_BASE_FRAMES = 30;
const NAMEPLATE_IMAGE_RETRY_MAX_FRAMES = 600;

interface CachedImage {
  image: HTMLImageElement;
  status: 'loading' | 'ready' | 'failed';
  failures: number;
  retryFrame: number;
}

export class NameplateImageCache {
  private readonly entries = new Map<string, CachedImage>();
  private frame = 0;

  beginFrame(): void {
    this.frame++;
  }

  get(url: string): HTMLImageElement | null {
    if (!url) return null;
    let entry = this.entries.get(url);
    if (!entry) {
      entry = this.load(url, 0);
      this.entries.set(url, entry);
      this.trim();
    } else if (entry.status === 'failed' && this.frame >= entry.retryFrame) {
      entry = this.load(url, entry.failures);
      this.entries.set(url, entry);
    }
    // Map insertion order is the LRU order. Every hit moves to the back, so a
    // live working set above the cap evicts the least recently used URL even
    // when every entry was touched in this frame.
    this.entries.delete(url);
    this.entries.set(url, entry);
    return entry.status === 'ready' ? entry.image : null;
  }

  private load(url: string, failures: number): CachedImage {
    const image = document.createElement('img');
    const entry: CachedImage = {
      image,
      status: 'loading',
      failures,
      retryFrame: this.frame,
    };
    image.addEventListener('load', () => {
      if (this.entries.get(url) !== entry) return;
      entry.status = 'ready';
      entry.failures = 0;
    });
    image.addEventListener('error', () => {
      if (this.entries.get(url) !== entry) return;
      entry.status = 'failed';
      entry.failures++;
      const delay = Math.min(
        NAMEPLATE_IMAGE_RETRY_MAX_FRAMES,
        NAMEPLATE_IMAGE_RETRY_BASE_FRAMES * 2 ** Math.min(5, entry.failures - 1),
      );
      entry.retryFrame = this.frame + delay;
    });
    image.referrerPolicy = 'no-referrer';
    image.src = url;
    if (image.complete && image.naturalWidth > 0) entry.status = 'ready';
    return entry;
  }

  private trim(): void {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= NAMEPLATE_IMAGE_CACHE_LIMIT) return;
      this.entries.delete(key);
    }
  }
}
