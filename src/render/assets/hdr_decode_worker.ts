// Web Worker: fetch + RGBE-decode an equirect .hdr OFF the main thread. An
// 8MB 2k HDRI takes RGBELoader.parse over a second of pure CPU (per-pixel
// RGBE to half-float conversion), which was a measured full-frame stall every
// time zone streaming brought in a new biome's sky. The decoded pixel buffer
// transfers back zero-copy; the main thread only builds the DataTexture.
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { resampleHdrRgba } from '../hdr_resample';

export interface HdrDecodeRequest {
  id: number;
  url: string;
  maxWidth?: number;
}

export interface HdrDecodeResponse {
  id: number;
  ok: boolean;
  error?: string;
  width?: number;
  height?: number;
  // HalfFloatType (Uint16Array) with the default RGBELoader configuration.
  data?: Uint16Array | Float32Array;
  type?: number;
}

self.onmessage = async (e: MessageEvent<HdrDecodeRequest>) => {
  const { id, url, maxWidth } = e.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`hdr fetch failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const parsed = new RGBELoader().parse(buffer) as {
      width: number;
      height: number;
      data: Uint16Array | Float32Array;
      type: number;
    };
    const resized =
      maxWidth && maxWidth > 0
        ? resampleHdrRgba(parsed.data, parsed.width, parsed.height, maxWidth)
        : parsed;
    const out: HdrDecodeResponse = {
      id,
      ok: true,
      width: resized.width,
      height: resized.height,
      data: resized.data,
      type: parsed.type,
    };
    (self as unknown as Worker).postMessage(out, [resized.data.buffer as ArrayBuffer]);
  } catch (err) {
    const out: HdrDecodeResponse = { id, ok: false, error: String(err) };
    (self as unknown as Worker).postMessage(out);
  }
};
