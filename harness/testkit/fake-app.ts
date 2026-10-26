// A stand-in for a project's dev server, for the app lifecycle tests: `node fake-app.ts <port> [mode]`.
//   ok          answers every request at once (the default)
//   slow:<ms>   listens only after <ms>
//   fail        prints an error and exits 1 before listening
//   stubborn    answers, but ignores SIGTERM (the runner must SIGKILL it)
//   env         answers, and prints whether an agent marker (CLAUDECODE, AI_AGENT) reached it

import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? process.env.PORT);
const mode = process.argv[3] ?? 'ok';

if (!port) {
  console.error('fake-app: no port');
  process.exit(2);
}
if (mode === 'fail') {
  console.error('fake-app: failed to compile (as asked)');
  process.exit(1);
}
if (mode === 'stubborn') process.on('SIGTERM', () => console.log('fake-app: SIGTERM ignored'));
if (mode === 'env') console.log(`fake-app: agent markers ${process.env.CLAUDECODE ?? process.env.AI_AGENT ?? 'none'}`);

const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(`fake app · ${request.url ?? '/'}\n`);
});

const listen = () => server.listen(port, '127.0.0.1', () => console.log(`fake-app: listening on ${port}`));
const delay = mode.startsWith('slow:') ? Number(mode.slice(5)) : 0;
if (delay) setTimeout(listen, delay);
else listen();
