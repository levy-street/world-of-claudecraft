// Whether the boss-fight track decodes its PCM fallback up front.
//
// music.ts plays the boss track through a media element and keeps a decoded
// copy for when the element's play() is refused. That copy was fetched and
// decoded on the engage edge of every fight, whether the element played or
// not, and kept for the page life: 274.7 s of stereo is about 100.6 MiB of
// float32 at 48 kHz. On the iOS memory profile the decode waits for a refusal
// instead, so a host whose element plays (the native shell never refuses)
// never holds it. Every other host keeps the prefetch.

import { GFX, type GfxSettings } from '../render/gfx';

export function bossPcmPrefetchAllowed(
  profile: Pick<GfxSettings, 'iosMemoryProfile'> = GFX,
): boolean {
  return !profile.iosMemoryProfile;
}
