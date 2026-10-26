/* Server-only: the prototype picture of a task. The designer is told to save `prototype.png` (a screenshot) or
   `prototype.svg` (a wireframe); a designer that saves another name still gets its newest image shown. */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PREFERRED = ['prototype.png', 'prototype.webp', 'prototype.jpg', 'prototype.svg'];
const IMAGE = /\.(png|webp|jpe?g|svg)$/i;

/** The file name to serve from `artifacts/<id>/`, or null when the round left no image. */
export function prototypeImage(artifactsDir: string, id: string): string | null {
  const dir = join(artifactsDir, id);
  if (!existsSync(dir)) return null;
  const preferred = PREFERRED.find((name) => existsSync(join(dir, name)));
  if (preferred) return preferred;
  const images = readdirSync(dir).filter((name) => IMAGE.test(name));
  images.sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs);
  return images[0] ?? null;
}
