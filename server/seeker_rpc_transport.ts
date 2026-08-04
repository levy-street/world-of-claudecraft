export const SEEKER_RPC_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

interface RpcResponse {
  error?: unknown;
  result?: unknown;
}

export function validatedSeekerRpcUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('Solana RPC URL must use HTTPS');
  if (url.username || url.password) {
    throw new Error('Solana RPC URL must not contain credentials');
  }
  return url;
}

function declaredContentLength(response: Response): number | null {
  const value = response.headers.get('content-length');
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new Error('Solana RPC returned an invalid Content-Length');
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new Error('Solana RPC returned an invalid Content-Length');
  }
  return length;
}

export async function readBoundedJsonResponse(
  response: Response,
  maxBytes = SEEKER_RPC_MAX_RESPONSE_BYTES,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('Solana RPC response limit must be a positive integer');
  }
  const declaredLength = declaredContentLength(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new Error('Solana RPC response exceeded the byte limit');
  }
  if (!response.body) throw new Error('Solana RPC returned an empty response');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('Solana RPC response exceeded the byte limit');
        throw new Error('Solana RPC response exceeded the byte limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

export async function seekerRpcResult(
  rpcUrl: string,
  method: 'getTokenAccountsByOwner' | 'getMultipleAccounts',
  params: unknown[],
  signal?: AbortSignal,
): Promise<unknown> {
  const url = validatedSeekerRpcUrl(rpcUrl);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    redirect: 'error',
    signal,
  });
  if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status}`);
  const body = (await readBoundedJsonResponse(response)) as RpcResponse;
  if (!body || typeof body !== 'object' || body.error !== undefined || !('result' in body)) {
    throw new Error('Solana RPC returned an invalid response');
  }
  return body.result;
}
