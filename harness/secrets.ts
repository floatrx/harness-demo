// Secret shapes the loop must never put into anything that leaves the machine: a pull-request body, a Telegram
// message, a log line. `pnpm provenance` uses the same shapes on the repository itself.

/** Telegram bot tokens, GitHub tokens (classic and fine-grained), Anthropic API keys. */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
];

/** Replaces every secret-shaped string, and every live value in `known` (a token read from `.env`), by `[secret]`. */
export function scrubSecrets(text: string, known: readonly (string | null | undefined)[] = []): string {
  let out = text;
  for (const value of known) if (value && value.length >= 8) out = out.split(value).join('[secret]');
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[secret]');
  return out;
}
