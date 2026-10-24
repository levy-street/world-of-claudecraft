// The dedicated boss-fight loop's asset handling, lifted out of MusicDirector
// (music.ts sits at its monolith ceiling): which track a boss fight plays, the
// streamed <audio> element, the decoded fallback buffer and its source node.
// MusicDirector keeps the mix (the boss gain, the duck, the enable and menu
// gates) and asks this for the sound itself.
//
// A boss with a dedicated production of its own is a row in
// BOSS_TRACK_URLS; every other boss fight keeps the shared default loop.

/** The shared boss-fight loop every boss without its own track plays. */
export const DEFAULT_BOSS_TRACK_URL = '/audio/dungeon-boss-fight.mp3';

/** Boss template id to its own fight track. Hydra heads share one encounter cue. */
export const BOSS_TRACK_URLS: Readonly<Record<string, string>> = {
  morthen: '/audio/music/boss_morthen.mp3?v=664edb19bfe2',
  sexton_marrow: '/audio/music/boss_sexton_marrow.mp3?v=6f57b2380d05',
  rimeweb: '/audio/music/boss_rimeweb.mp3?v=964cbe52e766',
  cantor_ilvane: '/audio/music/boss_cantor_ilvane.mp3?v=bfc9e92331e7',
  crypt_knellwyrm: '/audio/music/boss_crypt_knellwyrm.mp3?v=87bbe6faffa7',
  knight_commander_olen: '/audio/music/boss_knight_commander_olen.mp3?v=6d7f30388338',
  gaoler_ossick: '/audio/music/boss_gaoler_ossick.mp3?v=a303cf1a7df5',
  vael_the_mistcaller: '/audio/music/boss_vael_the_mistcaller.mp3?v=40ae26b99931',
  korgath_the_bound: '/audio/music/boss_korgath_the_bound.mp3?v=c1850e0db7e1',
  grand_necromancer_velkhar: '/audio/music/boss_grand_necromancer_velkhar.mp3?v=83428ec74728',
  korzul_the_gravewyrm: '/audio/music/boss_korzul_the_gravewyrm.mp3?v=ca10564cb613',
  wildheart_beastmaster: '/audio/music/boss_wildheart_beastmaster.mp3?v=f0f648c63ddb',
  the_gorgebloom: '/audio/music/boss_the_gorgebloom.mp3?v=a657f10af536',
  wildheart_high_priest: '/audio/music/boss_wildheart_high_priest.mp3?v=ab150b2c36f3',
  choirmother_selthe: '/audio/music/boss_choirmother_selthe.mp3?v=8da9fa646949',
  mere_hydra_head_left: '/audio/music/boss_mere_hydra.mp3?v=046af2f68534',
  mere_hydra_head_center: '/audio/music/boss_mere_hydra.mp3?v=046af2f68534',
  mere_hydra_head_right: '/audio/music/boss_mere_hydra.mp3?v=046af2f68534',
  tideglass_colossus: '/audio/music/boss_tideglass_colossus.mp3?v=d18a194458a7',
  ysolei: '/audio/music/boss_ysolei.mp3?v=82d59ef43e4d',
};

/** The fight track for a boss template, or null when it has none of its own. */
export function bossTrackFor(templateId: string): string | null {
  return Object.hasOwn(BOSS_TRACK_URLS, templateId) ? BOSS_TRACK_URLS[templateId] : null;
}

export class BossLoopTrack {
  private url = DEFAULT_BOSS_TRACK_URL;
  private el: HTMLAudioElement | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private loading = false;

  get currentUrl(): string {
    return this.url;
  }

  get hasBuffer(): boolean {
    return this.buffer !== null;
  }

  /** Take over the mix, then point the loop at the requested track. */
  retarget(
    url: string,
    streamsToPause: Iterable<{ el: HTMLAudioElement | null }> | null = null,
  ): void {
    if (streamsToPause) for (const stream of streamsToPause) stream.el?.pause();
    if (url === this.url) return;
    this.el?.pause();
    this.stopSource();
    this.el = null;
    this.buffer = null;
    this.url = url;
  }

  /** The streamed element for the current track (null where Audio is missing). */
  element(): HTMLAudioElement | null {
    if (this.el) return this.el;
    if (typeof Audio !== 'function') return null;
    const el = new Audio(this.url);
    el.loop = true;
    el.preload = 'auto';
    this.el = el;
    return el;
  }

  pause(): void {
    this.el?.pause();
  }

  /** Back to the top, for a fresh dungeon run. */
  rewind(): void {
    if (this.el) {
      try {
        this.el.currentTime = 0;
      } catch {
        /* browser may reject seeking before metadata */
      }
    }
    this.stopSource();
  }

  /** Fetch and decode the fallback buffer once; `ready` runs when it lands. */
  loadBuffer(ctx: AudioContext, ready: () => void): void {
    if (this.buffer || this.loading || typeof fetch !== 'function') return;
    this.loading = true;
    const url = this.url;
    void fetch(url)
      .then((res) => res.arrayBuffer())
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((buffer) => {
        this.loading = false;
        // A retarget while this was in flight keeps the newer track.
        if (url !== this.url) return;
        this.buffer = buffer;
        ready();
      })
      .catch(() => {
        this.loading = false;
      });
  }

  startSource(ctx: AudioContext, gain: GainNode): void {
    if (!this.buffer || this.source) return;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(gain);
    src.start();
    this.source = src;
  }

  stopSource(): void {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      /* already stopped */
    }
    this.source.disconnect();
    this.source = null;
  }
}
