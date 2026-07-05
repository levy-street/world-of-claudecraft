// @solana/web3.js assumes a Node-ish global environment (`Buffer`, `global`).
// Vite targets the browser, so shim them before any code that imports web3.js
// loads. wallet.ts imports this module FIRST so it evaluates ahead of the
// @solana/web3.js module in the import graph (used only by the marketplace
// split-payment builder).
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: typeof globalThis };
if (!g.Buffer) g.Buffer = Buffer;
if (!g.global) g.global = globalThis;
