#!/usr/bin/env node
// Runs `next <command>` on FRONTEND_PORT, read from the environment or the repo-level .env.local/.env.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const root = resolve(import.meta.dirname, '../..');

function frontendPort() {
  if (process.env.FRONTEND_PORT) return process.env.FRONTEND_PORT;
  for (const file of ['.env.local', '.env']) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    const port = parseEnv(readFileSync(path, 'utf8')).FRONTEND_PORT;
    if (port) return port;
  }
  return '3000';
}

const [command = 'dev', ...args] = process.argv.slice(2);
const port = frontendPort();
if (!/^\d+$/.test(port)) {
  console.error(`FRONTEND_PORT must be a number, got "${port}"`);
  process.exit(1);
}

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, command, '--port', port, ...args], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
