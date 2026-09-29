// Downloads a TalkingHead sample avatar into public/avatars/<name>.glb.
// Usage: npm run fetch-avatar [-- <name>] [-- --force]; override the source with AVATAR_SOURCE_URL.
//   mpfb (default, female, CC0) · avatarsdk (male) · brunette, avaturn, vroid (female)
// Everything except mpfb is licensed for non-commercial use only.
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const SAMPLES = {
  mpfb: 'CC0 (TalkingHead / MPFB)',
  avatarsdk: 'non-commercial use only (AvatarSDK)',
  brunette: 'CC BY-NC 4.0 (Ready Player Me)',
  avaturn: 'non-commercial use only (Avaturn)',
  vroid: 'non-commercial use only (VRoid Studio)',
};
const args = process.argv.slice(2);
const force = args.includes('--force');
const name = args.find((a) => !a.startsWith('--')) ?? 'mpfb';
if (!(name in SAMPLES) && !process.env.AVATAR_SOURCE_URL) {
  console.error(`Unknown avatar "${name}". Choose one of: ${Object.keys(SAMPLES).join(', ')}`);
  process.exit(1);
}
const SOURCE =
  process.env.AVATAR_SOURCE_URL ?? `https://raw.githubusercontent.com/met4citizen/TalkingHead/main/avatars/${name}.glb`;
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'avatars', `${name}.glb`);

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
console.log(`Saved ${target} (${(size / 1e6).toFixed(1)} MB). License: ${SAMPLES[name] ?? 'see the source'}.`);
if (name !== 'mpfb') console.log(`Use it with AVATAR_URL=/avatars/${name}.glb in .env.`);
