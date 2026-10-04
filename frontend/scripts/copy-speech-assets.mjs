#!/usr/bin/env node
// Copies the WASM files used by in-browser speech (ONNX Runtime, Piper's eSpeak phonemizer) into public/, so no CDN is needed.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
// Resolve the copy transformers.js uses, in case npm nests a different version.
const transformers = require.resolve('@huggingface/transformers');
const ort = dirname(createRequire(transformers).resolve('onnxruntime-web'));
const piper = dirname(require.resolve('@diffusionstudio/piper-wasm/build/piper_phonemize.js'));
const out = resolve(import.meta.dirname, '../public/speech');

function copy(from, files, to) {
  mkdirSync(to, { recursive: true });
  for (const file of files) copyFileSync(join(from, file), join(to, file));
}

copy(ort, ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'], join(out, 'ort'));
copy(piper, ['piper_phonemize.wasm', 'piper_phonemize.data'], join(out, 'piper'));
console.log(`speech assets copied to ${out}`);
