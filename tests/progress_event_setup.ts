// Node has no DOM `ProgressEvent`, but three's FileLoader constructs one on
// EVERY streamed chunk of a fetch response (three.core.js, the ReadableStream
// progress tracker), whether or not a progress callback was registered. Any
// loader fetch that succeeds inside a Node-environment test file (a data: or
// blob: URL, a stubbed Response with a body) therefore throws a ReferenceError
// inside the stream's read promise: an unhandled rejection that vitest pins on
// whichever test file happens to be running in that worker at the time (the
// loader outlives its own file), and fails the whole shard with every test
// green. Browsers and the jsdom / happy-dom environments have the class; this
// gives the plain node environment the same minimal one. Setup is a no-op
// wherever ProgressEvent already exists.

class NodeProgressEvent extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;

  constructor(type: string, init: ProgressEventInit = {}) {
    super(type, init);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

if (typeof globalThis.ProgressEvent === 'undefined') {
  (globalThis as { ProgressEvent: unknown }).ProgressEvent = NodeProgressEvent;
}
