// GHSA-mrhx-c7xc-m3w5: backport upstream PR6652 without changing Zod majors.
// Exercise the copies actually resolved by both consumers and both module formats.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z as Zod, ZodTypeAny } from 'zod';

const require = createRequire(import.meta.url);

for (const consumer of ['@reown/appkit-wallet', 'chromium-bidi']) {
  const consumerRequire = createRequire(require.resolve(consumer));
  const packagePath = consumerRequire.resolve('zod/package.json');
  const pkg = require(packagePath) as { main: string; module: string; version: string };
  const formats = [pkg.main, pkg.module];
  if (pkg.version === '3.22.4') formats.push('./lib/index.umd.js');

  for (const format of formats) {
    describe(`${consumer}: Zod ${pkg.version} ${format}`, () => {
      const load = async (): Promise<typeof Zod> => {
        const file = path.resolve(path.dirname(packagePath), format);
        const mod = await import(/* @vite-ignore */ pathToFileURL(file).href);
        return mod.z ?? mod.default.z;
      };

      for (const constraint of ['array.max', 'array.length', 'set.max', 'set.size']) {
        for (const async of [false, true]) {
          it(`${constraint} rejects oversize before visiting elements (${async ? 'async' : 'sync'})`, async () => {
            const z = await load();
            let visits = 0;
            let refinements = 0;
            const element = z.preprocess((value) => {
              visits++;
              return value;
            }, z.string());
            const collection: ZodTypeAny =
              constraint === 'array.max'
                ? z.array(element).max(2, 'too many')
                : constraint === 'array.length'
                  ? z.array(element).length(2, 'too many')
                  : constraint === 'set.max'
                    ? z.set(element).max(2, 'too many')
                    : z.set(element).size(2, 'too many');
            const schema = z.object({
              values: collection.refine(() => {
                refinements++;
                return true;
              }),
            });
            const values = Array.from({ length: 1000 }, (_, i) => i);
            const input = { values: constraint.startsWith('set') ? new Set(values) : values };
            const result = async ? await schema.safeParseAsync(input) : schema.safeParse(input);
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.issues).toHaveLength(1);
              expect(result.error.issues[0]).toMatchObject({
                code: 'too_big',
                maximum: 2,
                message: 'too many',
                path: ['values'],
              });
            }
            expect(visits).toBe(0);
            expect(refinements).toBe(0);
          });
        }
      }

      it('preserves valid transforms, undersize errors, and unbounded collections', async () => {
        const z = await load();
        const element = z.string().transform((value) => value.toUpperCase());
        expect(z.array(element).length(2).parse(['a', 'b'])).toEqual(['A', 'B']);
        expect(
          await z
            .set(element)
            .size(2)
            .parseAsync(new Set(['a', 'b'])),
        ).toEqual(new Set(['A', 'B']));
        for (const schema of [z.array(element).length(2), z.array(element).min(2)]) {
          const result = schema.safeParse(['a']);
          expect(result.success).toBe(false);
          if (!result.success) expect(result.error.issues[0].code).toBe('too_small');
        }
        expect(z.array(element).parse(['a', 'b', 'c'])).toEqual(['A', 'B', 'C']);
      });
    });
  }
}
