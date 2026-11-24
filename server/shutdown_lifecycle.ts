import type { CharacterDepartures } from './character_departures';

export const DEPARTURE_SHUTDOWN_WAIT_MS = 20_000;

export async function saveShutdownCharacters(
  departures: CharacterDepartures,
  saveConnected: () => Promise<void>,
): Promise<void> {
  const drain = departures.shutdownDrain(DEPARTURE_SHUTDOWN_WAIT_MS);
  const failures = new Set<unknown>();
  const remember = (error: unknown) => {
    failures.add(error);
  };
  await drain().catch(remember);
  // An earlier failed departure must not prevent healthy connected players
  // from reaching their own final save. Failure still forbids clean teardown.
  await saveConnected().catch(remember);
  await drain(failures.size === 0).catch(remember);
  if (failures.size > 0) {
    const messages = [...failures].map((error) =>
      error instanceof Error ? error.message : String(error),
    );
    throw new AggregateError(
      [...failures],
      `shutdown character persistence failed: ${messages.join('; ')}`,
    );
  }
}

/** SIGINT and SIGTERM must share the entire operation, including failure. A
 * second signal cannot retry teardown behind still-running character saves. */
export function createShutdownHandler(
  shutdown: () => Promise<void>,
  failed: (error: unknown) => void,
): () => Promise<void> {
  let running: Promise<void> | undefined;
  return () => {
    if (running) return running;
    let resolve!: () => void;
    running = new Promise<void>((done) => {
      resolve = done;
    });
    const fail = (error: unknown) => {
      failed(error);
      resolve();
    };
    try {
      void shutdown().then(resolve, fail);
    } catch (error) {
      fail(error);
    }
    return running;
  };
}
