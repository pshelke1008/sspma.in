/**
 * The one place Baileys is loaded.
 *
 * Baileys is ESM-only. This API compiles to CommonJS, where `import()` is
 * rewritten into `require()` — and under tsx that sends Baileys' own ESM-only
 * dependencies through the CommonJS resolver, which fails. A Function-built
 * `import()` is left untouched by both compilers, so Node's native ESM loader
 * resolves the whole graph. Loading lazily also means a server where nobody
 * links a phone never pays for the library.
 */
export type BaileysModule = typeof import('@whiskeysockets/baileys');

const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<BaileysModule>;

let loading: Promise<BaileysModule> | null = null;

export function loadBaileys(): Promise<BaileysModule> {
  if (!loading) loading = nativeImport('@whiskeysockets/baileys');
  return loading;
}
