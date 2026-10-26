import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prototypeImage } from './prototype-image.ts';

test('prototype.png wins; another name falls back to the newest image; no image → null', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-proto-'));
  try {
    const dir = join(root, 'T-001');
    assert.equal(prototypeImage(root, 'T-001'), null);
    mkdirSync(dir);
    writeFileSync(join(dir, 'notes.md'), 'not a picture');
    assert.equal(prototypeImage(root, 'T-001'), null);
    writeFileSync(join(dir, 'round-1.jpg'), 'x');
    writeFileSync(join(dir, 'round-2.png'), 'x');
    utimesSync(join(dir, 'round-1.jpg'), new Date(2026, 0, 1), new Date(2026, 0, 1));
    assert.equal(prototypeImage(root, 'T-001'), 'round-2.png');
    writeFileSync(join(dir, 'prototype.svg'), '<svg/>');
    assert.equal(prototypeImage(root, 'T-001'), 'prototype.svg');
    writeFileSync(join(dir, 'prototype.png'), 'x');
    assert.equal(prototypeImage(root, 'T-001'), 'prototype.png');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
