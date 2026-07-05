// Shared, deterministic helpers for the in-game challenge protocol. Pure and
// host-agnostic so an answer signed in the browser client verifies on the Node
// server. Lives in src/sim/ because that is the only directory the server may
// import from (same reason as move_input.ts); kept free of Math.random/Date.now
// so the sim-purity backstop (tests/architecture.test.ts) stays green.


function hashCyrb53(str: string, salt = 0): string {
  let h1 = 0xdeadbeef ^ salt;
  let h2 = 0x41c6ce57 ^ salt;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(36);
}

export function signChallenge(nonce: string, response: string, seed: string): string {
  return hashCyrb53(JSON.stringify([nonce, response, seed]));
}

export function verifyChallenge(nonce: string, response: string, sig: string, seed: string): boolean {
  return signChallenge(nonce, response, seed) === sig;
}
