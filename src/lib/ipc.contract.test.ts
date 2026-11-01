import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMAND_NAMES } from './ipc';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Names in `generate_handler![…]`, each by its last path segment. */
function registeredCommands(source: string): string[] {
  const body = /generate_handler!\[([^\]]*)\]/.exec(source)?.[1];
  if (!body) throw new Error('generate_handler! not found in desktop.rs');
  return body
    .replace(/\/\/.*$/gm, '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((path) => path.split('::').at(-1) ?? path);
}

/** A Tauri invoke call, with or without a type argument. */
const RAW_CALL = /\binvoke\s*(?:<.*?>)?\s*\(/;
/** Any import that names invoke from the Tauri core module. */
const RAW_IMPORT =
  /import\s*(?:type\s*)?\{[^}]*\binvoke\b[^}]*\}\s*from\s*'@tauri-apps\/api\/core'/;

describe('IPC contract', () => {
  it('types exactly the commands the native shell registers', () => {
    const registered = registeredCommands(read('src-tauri/src/desktop.rs'));
    expect(new Set(registered).size).toBe(registered.length);
    expect([...COMMAND_NAMES].sort()).toEqual([...registered].sort());
  });

  it('reaches the native shell only through ipc.ts', () => {
    const ipc = read('src/lib/ipc.ts');
    // The patterns must still find the one sanctioned call and import.
    expect(RAW_CALL.test(ipc) && RAW_IMPORT.test(ipc)).toBe(true);
    const offenders = readdirSync(join(root, 'src'), { recursive: true })
      .map(String)
      .filter((path) => /\.(?:ts|svelte)$/.test(path))
      .map((path) => join('src', path))
      .filter((path) => path !== join('src', 'lib', 'ipc.ts'))
      .filter((path) => {
        const source = read(path);
        return RAW_CALL.test(source) || RAW_IMPORT.test(source);
      });
    expect(offenders).toEqual([]);
  });
});
