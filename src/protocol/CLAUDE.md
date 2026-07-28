# Shared wire protocol cores

This directory contains host-agnostic protocol codecs shared by browser and server.

- No DOM, WebSocket, database, renderer, or simulation imports.
- Decode untrusted data with explicit byte, string, collection, depth, and value
  limits before allocating from declared lengths.
- Preserve unknown fields through bounded extension blocks.
- Encoders are deterministic for semantically identical inputs.
- Protocol versions are exact integers and independent from world-layout epochs.
- Pair every codec with cross-import round-trip, malformed-input, and size tests.
