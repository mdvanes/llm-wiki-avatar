#!/usr/bin/env node
// Copies the ONNX Runtime WASM files used by in-browser speech-to-text into public/, so no CDN is needed.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
// Resolve the copy transformers.js uses, in case npm nests a different version.
const transformers = require.resolve('@huggingface/transformers');
const ort = dirname(createRequire(transformers).resolve('onnxruntime-web'));
const out = resolve(import.meta.dirname, '../public/speech/ort');

mkdirSync(out, { recursive: true });
for (const file of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  copyFileSync(join(ort, file), join(out, file));
}
console.log(`speech assets copied to ${out}`);
