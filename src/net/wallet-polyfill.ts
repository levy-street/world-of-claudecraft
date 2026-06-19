// Solana / Reown libraries assume a Node-ish global environment (`Buffer`,
// `global`). Vite targets the browser, so shim them before any wallet code
// loads. wallet.ts imports this module FIRST so it evaluates ahead of the
// @reown / @solana modules in the import graph.
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: typeof globalThis };
if (!g.Buffer) g.Buffer = Buffer;
if (!g.global) g.global = globalThis;
