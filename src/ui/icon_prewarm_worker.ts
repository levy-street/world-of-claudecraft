import { type IconKind, renderProceduralIconPng } from './icons';

type WorkerRequest = { requestId: number; kind: IconKind; id: string; size: number };
type WorkerResponse = { requestId: number; blob?: Blob; error?: string };
type WorkerScope = {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse): void;
};

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  const { requestId, kind, id, size } = event.data;
  void renderProceduralIconPng(kind, id, size)
    .then((blob) => scope.postMessage({ requestId, blob }))
    .catch((error: unknown) =>
      scope.postMessage({
        requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
});
