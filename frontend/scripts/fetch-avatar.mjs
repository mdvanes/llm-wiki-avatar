// Downloads the CC0 "mpfb" sample avatar from the TalkingHead repo into public/avatars/.
// Usage: npm run fetch-avatar [-- --force] ; override the source with AVATAR_SOURCE_URL.
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const SOURCE =
  process.env.AVATAR_SOURCE_URL ?? 'https://raw.githubusercontent.com/met4citizen/TalkingHead/main/avatars/mpfb.glb';
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'avatars', 'mpfb.glb');
const force = process.argv.includes('--force');

const existing = await stat(target).catch(() => null);
if (existing && existing.size > 0 && !force) {
  console.log(`Avatar already present: ${target} (${(existing.size / 1e6).toFixed(1)} MB)`);
  process.exit(0);
}

await mkdir(dirname(target), { recursive: true });
console.log(`Downloading ${SOURCE}`);
const res = await fetch(SOURCE);
if (!res.ok || !res.body) {
  console.error(`Download failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const tmp = `${target}.part`;
await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
const { size } = await stat(tmp);
const magic = Buffer.alloc(4);
const { open } = await import('node:fs/promises');
const fh = await open(tmp);
await fh.read(magic, 0, 4, 0);
await fh.close();
if (magic.toString('latin1') !== 'glTF') {
  console.error('Downloaded file is not a GLB model.');
  process.exit(1);
}
await rename(tmp, target);
console.log(`Saved ${target} (${(size / 1e6).toFixed(1)} MB). License: CC0 (TalkingHead / MPFB).`);
