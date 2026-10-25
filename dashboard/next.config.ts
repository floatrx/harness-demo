import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  reactStrictMode: true,
  /* Node loads the core itself (type stripping), so its import.meta.url still points at harness/ and it finds
     agents/ and prompts/ next to it. */
  serverExternalPackages: ['@harness/core'],
  turbopack: { root: resolve(here, '..') },
};

export default config;
