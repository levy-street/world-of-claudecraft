// libvips caches recent operations, and an operation that read a file by PATH
// keeps that file's handle open while it sits in the cache. Linux lets the same
// process overwrite or delete an open file; Windows refuses (sharp's "unable to
// open for write", rmSync's EPERM). A suite that reads fixtures through sharp
// in-process, its own code or the module under test, and then rewrites or
// removes them calls this once at load. It only drops the cache on Windows;
// output bytes never depend on the cache, and Linux keeps it as before.
import sharp from 'sharp';

export function releaseSharpFileHandles(): void {
  if (process.platform === 'win32') sharp.cache(false);
}
