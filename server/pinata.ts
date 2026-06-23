// Pinata IPFS pinning for hosted creator skins. Env-gated on PINATA_JWT_SECRET
// (mirrors marketplaceEnabled): hosted upload is unavailable until configured.
// The only network reader/writer for IPFS; uses global fetch with a manually
// assembled multipart body so it needs no FormData/Blob polyfill.
import { randomBytes } from 'node:crypto';

const PINATA_JWT = (process.env.PINATA_JWT_SECRET ?? process.env.PINATA_JWT ?? '').trim();
const PINATA_API = (process.env.PINATA_API_URL ?? 'https://api.pinata.cloud').replace(/\/+$/, '');
const PINATA_GATEWAY = (process.env.PINATA_GATEWAY ?? 'https://gateway.pinata.cloud').replace(/\/+$/, '');

/** Whether hosted (IPFS-pinned) skins can be created — true once a JWT is set. */
export function pinataEnabled(): boolean {
  return PINATA_JWT.length > 0;
}

/** Public gateway URL for a CID (used server-side to proxy the bytes). */
export function ipfsGatewayUrl(cid: string): string {
  return `${PINATA_GATEWAY}/ipfs/${cid}`;
}

/** Pin PNG bytes to IPFS via Pinata; returns the content CID. Throws on any
 *  non-2xx so the caller fails the upload cleanly (no half-created listing). */
export async function pinFileToIPFS(bytes: Buffer, name: string): Promise<string> {
  if (!pinataEnabled()) throw new Error('pinata not configured');
  const boundary = `----woc${randomBytes(16).toString('hex')}`;
  const safeName = name.replace(/[^a-z0-9_-]/gi, '').slice(0, 48) || 'skin';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}.png"\r\n` +
    `Content-Type: image/png\r\n\r\n`,
  );
  const tail = Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="pinataMetadata"\r\n\r\n` +
    `${JSON.stringify({ name: safeName })}\r\n--${boundary}--\r\n`,
  );
  const res = await fetch(`${PINATA_API}/pinning/pinFileToIPFS`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat([head, bytes, tail]),
  });
  if (!res.ok) throw new Error(`pinata pin failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { IpfsHash?: string };
  if (!data.IpfsHash) throw new Error('pinata response missing IpfsHash');
  return data.IpfsHash;
}

/** Unpin a CID (best-effort cost cleanup when a hosted skin is removed). A 404
 *  means already-unpinned, which is success for our purposes. */
export async function unpinFromIPFS(cid: string): Promise<void> {
  if (!pinataEnabled()) return;
  const res = await fetch(`${PINATA_API}/pinning/unpin/${encodeURIComponent(cid)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`pinata unpin failed: ${res.status}`);
}
