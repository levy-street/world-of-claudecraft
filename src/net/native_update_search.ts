import { checkNativeAppUpdate, openNativeAppUpdate } from './native_app_update';
import { applyPendingOtaUpdate, type OtaGlobalScope, pendingOtaBundleId } from './native_ota';
import { NATIVE_APP } from './online';

export type NativeUpdateSearchResult = 'updating' | 'none' | 'unavailable' | 'failed';

interface ListenerHandle {
  remove(): Promise<void> | void;
}

interface ManualUpdater {
  triggerUpdateCheck(): Promise<unknown>;
  addListener(
    name: string,
    listener: (event: unknown) => void,
  ): Promise<ListenerHandle> | ListenerHandle;
}

export interface NativeUpdateSearchOptions {
  native?: boolean;
  scope?: OtaGlobalScope;
  timeoutMs?: number;
  checkStore?: typeof checkNativeAppUpdate;
  openStore?: typeof openNativeAppUpdate;
}

/** Search again from the incompatible-client screen. The installed OTA gate owns downloads/apply. */
export async function searchNativeUpdates(
  currentVersion: string,
  opts: NativeUpdateSearchOptions = {},
): Promise<NativeUpdateSearchResult> {
  const native = opts.native ?? NATIVE_APP;
  if (!native) return 'unavailable';
  const scope = opts.scope ?? (window as unknown as OtaGlobalScope);
  const handles: ListenerHandle[] = [];
  let closed = false;
  const remove = (handle: ListenerHandle): void => {
    try {
      void Promise.resolve(handle.remove()).catch(() => {});
    } catch {
      // A bridge removal failure leaves only an inert callback.
    }
  };
  const cleanup = (): void => {
    closed = true;
    for (const handle of handles.splice(0)) remove(handle);
  };
  const searchStore = async (
    missing: NativeUpdateSearchResult = 'unavailable',
  ): Promise<NativeUpdateSearchResult> => {
    const status = await (opts.checkStore ?? checkNativeAppUpdate)(currentVersion);
    if (closed) return 'failed';
    if (!status) return missing;
    if (!status.available) return 'none';
    await (opts.openStore ?? openNativeAppUpdate)(status.storeUrl);
    return 'updating';
  };
  const run = async (): Promise<NativeUpdateSearchResult> => {
    const pending = await pendingOtaBundleId({ native, scope });
    if (closed) return 'failed';
    if (pending) {
      return (await applyPendingOtaUpdate({
        native,
        scope,
        bundleId: pending,
        cancelled: () => closed,
      }))
        ? 'updating'
        : 'failed';
    }
    const candidate = scope.Capacitor?.Plugins?.CapacitorUpdater as
      | Partial<ManualUpdater>
      | undefined;
    if (
      typeof candidate?.triggerUpdateCheck !== 'function' ||
      typeof candidate.addListener !== 'function'
    ) {
      return searchStore();
    }
    const plugin = candidate as ManualUpdater;
    let answer: (result: NativeUpdateSearchResult) => void = () => {};
    const result = new Promise<NativeUpdateSearchResult>((resolve) => {
      answer = resolve;
    });
    const listen = async (name: string, value: NativeUpdateSearchResult): Promise<void> => {
      const handle = await plugin.addListener(name, () => {
        if (!closed) answer(value);
      });
      if (closed) remove(handle);
      else handles.push(handle);
    };
    const classification = Promise.resolve(
      plugin.addListener('updateCheckResult', (event) => {
        if (closed) return;
        const kind = (event as { kind?: unknown } | null)?.kind;
        if (kind === 'blocked') answer('unavailable');
        else if (kind === 'failed') answer('failed');
        else if (kind === 'up_to_date') answer('none');
      }),
    ).then((handle) => {
      if (closed) remove(handle);
      else handles.push(handle);
    });
    await Promise.all([
      classification,
      listen('updateAvailable', 'updating'),
      listen('noNeedUpdate', 'none'),
      listen('downloadFailed', 'failed'),
      listen('updateFailed', 'failed'),
    ]);
    if (closed) return 'failed';
    // Capgo 8.51.2 checks and downloads natively, reporting the answer through events.
    const trigger = Promise.resolve()
      .then(async () => {
        if (closed) return;
        const value = await plugin.triggerUpdateCheck();
        if (!closed && (value as { status?: unknown } | null)?.status === 'unavailable') {
          answer('unavailable');
        }
      })
      .catch((err: unknown) => {
        if (closed) return;
        if ((err as { code?: unknown } | null)?.code === 'UNIMPLEMENTED') {
          answer('unavailable');
        } else answer('failed');
      });
    // An event can arrive while the trigger call is still returning through the bridge.
    void trigger;
    const outcome = await result;
    if (closed) return 'failed';
    if (outcome === 'none') return searchStore('none');
    if (outcome === 'unavailable') return searchStore();
    return outcome;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<NativeUpdateSearchResult>((resolve) => {
        timer = setTimeout(() => {
          cleanup();
          resolve('failed');
        }, opts.timeoutMs ?? 60_000);
      }),
    ]);
  } catch {
    return 'failed';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    cleanup();
  }
}
