// The nameplate surface's badge / raid-marker / emote image cache, lifted out of
// nameplate_canvas.ts (which is on the monolith ratchet) so the surface keeps
// only its drawing code. LRU by Map insertion order with a bounded exponential
// retry for a URL that fails to decode, both driven off a frame counter the
// surface bumps once per painted frame: a failed avatar must not re-request an
// image every frame, and a live working set above the cap must still evict the
// least recently used entry rather than whatever was inserted first.

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
  private rev = 0;

  beginFrame(): void {
    this.frame++;
  }

  /** Monotonic stamp of every decode outcome (a badge, raid marker or emote
   *  icon becoming drawable, or failing and later retrying). Image loads are
   *  ASYNCHRONOUS: the plate state that names the url does not change when the
   *  bytes land, so the surface's repaint gate needs this to know that an
   *  otherwise identical frame would now draw a picture where it drew nothing. */
  revision(): number {
    return this.rev;
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
      this.rev++;
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
      this.rev++;
    });
    image.referrerPolicy = 'no-referrer';
    image.src = url;
    if (image.complete && image.naturalWidth > 0) {
      entry.status = 'ready';
      this.rev++;
    }
    return entry;
  }

  private trim(): void {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= NAMEPLATE_IMAGE_CACHE_LIMIT) return;
      this.entries.delete(key);
    }
  }
}
