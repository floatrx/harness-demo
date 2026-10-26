#!/usr/bin/env node
// A stand-in for the GitHub CLI, for delivery tests. It records every call (argv as one JSON line) and keeps the
// pull requests it "opened" next to the log, so `pr view` finds them again. It knows only what delivery uses —
// `auth status`, `pr view`, `pr create` — and refuses everything else (a `pr merge` attempt is recorded, then fails).
//
//   HARNESS_GH='HARNESS_FAKE_GH_LOG=/abs/gh.log node harness/testkit/fake-gh.ts'
//   HARNESS_FAKE_GH_FAIL=auth|create   makes that call fail

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const log = process.env.HARNESS_FAKE_GH_LOG;
if (!log) {
  console.error('fake gh: HARNESS_FAKE_GH_LOG is not set');
  process.exit(2);
}
const args = process.argv.slice(2);
appendFileSync(log, `${JSON.stringify(args)}\n`);

const statePath = `${log}.state.json`;
const state = (existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}) as Record<string, string>;
const fail = process.env.HARNESS_FAKE_GH_FAIL;
const flag = (name: string) => args[args.indexOf(name) + 1];

const [noun, verb] = args;
if (noun === 'auth' && verb === 'status') {
  if (fail === 'auth') {
    console.error('You are not logged into any GitHub hosts. To log in, run: gh auth login');
    process.exit(1);
  }
  console.log('github.com\n  ✓ Logged in to github.com account fake (keyring)');
  process.exit(0);
}
if (noun === 'pr' && verb === 'view') {
  const url = state[args[2] ?? ''];
  if (!url) {
    console.error(`no pull requests found for branch "${args[2]}"`);
    process.exit(1);
  }
  console.log(url);
  process.exit(0);
}
if (noun === 'pr' && verb === 'create') {
  if (fail === 'create') {
    console.error("pull request create failed: GraphQL: Head sha can't be blank");
    process.exit(1);
  }
  const head = flag('--head') ?? '?';
  const url = `https://github.com/example/bookmarks/pull/${Object.keys(state).length + 1}`;
  writeFileSync(statePath, JSON.stringify({ ...state, [head]: url }));
  console.log(url);
  process.exit(0);
}
console.error(`fake gh: refusing \`gh ${args.join(' ')}\` — delivery only views and creates pull requests`);
process.exit(1);
