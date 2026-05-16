#!/usr/bin/env node
// Generates a publishable-key string in the format the SDK accepts:
//   gh_pk_<consumer>_<brand>_<random-hex>
// Prints only the key to stdout so it can be piped or pasted.
// Args (optional): `make-key.mjs <consumer> <brand>` — skips prompts.

import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { stdin, stdout, stderr, argv, exit } from 'node:process';

const KEY_RE = /^gh_pk_[a-z0-9_-]+_[a-f0-9]+$/;

// Spaces become "-" so multi-word brands stay scannable (e.g. "Beverly Hills MD"
// → "beverly-hills-md"). Other punctuation is dropped. The structural "_"
// separator between consumer and brand is the responsibility of the caller, not
// slugify, so this never emits "_".
function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

// Buffered line reader: lines that arrive before a prompt asks for them are
// queued, so piped input ("foo\nbar\n") works the same as interactive typing.
function makeLineReader() {
  const queue = [];
  const waiters = [];
  const rl = createInterface({ input: stdin, terminal: false });
  rl.on('line', (line) => {
    if (waiters.length) waiters.shift()(line);
    else queue.push(line);
  });
  return {
    next() {
      return new Promise((resolve) => {
        if (queue.length) resolve(queue.shift());
        else waiters.push(resolve);
      });
    },
    close: () => rl.close(),
  };
}

async function prompt(reader, label) {
  stderr.write(`${label}: `);
  const line = await reader.next();
  return line.trim();
}

async function main() {
  let [, , consumerArg, brandArg] = argv;

  if (!consumerArg || !brandArg) {
    const reader = makeLineReader();
    consumerArg ??= await prompt(reader, 'Consumer (partner name, "internal", "test", ...)');
    brandArg ??= await prompt(reader, 'Brand');
    reader.close();
  }

  const consumer = slugify(consumerArg ?? '');
  const brand = slugify(brandArg ?? '');

  if (!consumer || !brand) {
    stderr.write(`error: consumer and brand must contain at least one alphanumeric character\n`);
    exit(1);
  }

  const random = randomBytes(16).toString('hex');
  const key = `gh_pk_${consumer}_${brand}_${random}`;

  if (!KEY_RE.test(key)) {
    stderr.write(`error: generated key failed validation — ${key}\n`);
    exit(1);
  }

  stdout.write(`${key}\n`);
}

main().catch((err) => {
  stderr.write(`error: ${err?.message ?? err}\n`);
  exit(1);
});
