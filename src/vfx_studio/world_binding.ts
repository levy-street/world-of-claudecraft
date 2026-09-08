/** Stable read-through world identity for a retained preview renderer. Methods
 * dispatch to the current world, even when a consumer saved the function before
 * a session replacement. No binding or wrapper allocation occurs per frame. */
export function bindStudioWorld<T extends object>(current: () => T): T {
  const methods = new Map<PropertyKey, (...args: unknown[]) => unknown>();
  return new Proxy({} as T, {
    get(_target, key) {
      const world = current();
      const value = Reflect.get(world, key, world);
      if (typeof value !== 'function') return value;
      let method = methods.get(key);
      if (!method) {
        method = (...args) => {
          const next = current();
          const callback = Reflect.get(next, key, next);
          if (typeof callback !== 'function') throw new Error('Studio world method changed type');
          return Reflect.apply(callback, next, args);
        };
        methods.set(key, method);
      }
      return method;
    },
    has: (_target, key) => key in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(current(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    set: () => {
      throw new Error('Studio renderer world binding is read-only');
    },
  });
}
