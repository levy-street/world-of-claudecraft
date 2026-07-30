// Read an outbound fetch Response body under a HARD byte cap enforced while
// streaming. `await response.text()` buffers the whole body before any length
// check can run, so against a misbehaving or compromised upstream a post-hoc
// cap is decorative: the memory is already spent. Shared by the rift upgrader
// and asset-pipeline bridges (both talk to operator-configured services, but
// the cap must still mean what it says).
export async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('response exceeds byte limit');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    // No stream on this Response implementation (undici always has one; test
    // fakes may not): fall back to the buffered read, cap after.
    const text = await response.text();
    if (text.length > maxBytes) throw new Error('response exceeds byte limit');
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('response exceeds byte limit');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
