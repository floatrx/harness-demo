// A deliberately small YAML subset for task frontmatter. Zero dependencies.
//
// Accepted:
//   key: scalar            # optional trailing comment
//   key:                   # null, or a block list when `  - item` lines follow
//     - item               # list items are scalars
//   key: []                # empty list
//   key: [a, b]            # flow list of plain scalars
//   # a whole-line comment, blank lines
//
// Scalars: `null` / `~` / empty → null, `true` / `false`, integers and decimals → number,
// '...' and "..." → string, anything else → plain string. Nested maps are not supported.

export type Scalar = string | number | boolean | null;
export type FieldValue = Scalar | string[];

export class YamlError extends Error {
  override name = 'YamlError';
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** Splits `value  # comment` outside quotes. Returns [value, comment|undefined]. */
export function splitComment(text: string): [string, string | undefined] {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1] ?? ''))) {
      return [text.slice(0, i).trimEnd(), text.slice(i)];
    }
  }
  return [text.trimEnd(), undefined];
}

export function parseScalar(raw: string): Scalar {
  const text = raw.trim();
  if (text === '' || text === 'null' || text === '~') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (NUMBER.test(text)) return Number(text);
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new YamlError(`unterminated string: ${text}`);
    return JSON.parse(text) as string;
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new YamlError(`unterminated string: ${text}`);
    return text.slice(1, -1).replaceAll("''", "'");
  }
  return text;
}

export function parseFlowList(raw: string): string[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((part) => String(parseScalar(part)));
}

function needsQuotes(text: string): boolean {
  if (text === '' || text !== text.trim()) return true;
  if (NUMBER.test(text) || ['null', '~', 'true', 'false'].includes(text)) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) return true;
  return /: |\s#|[\n\r\t]/.test(text) || text.endsWith(':');
}

export function formatScalar(value: Scalar): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return needsQuotes(value) ? JSON.stringify(value) : value;
}

/** Serialises one field to frontmatter lines (without a trailing newline). */
export function formatField(key: string, value: FieldValue, comment?: string): string[] {
  const tail = comment ? ` ${comment}` : '';
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${key}: []${tail}`];
    return [`${key}:${tail}`, ...value.map((item) => `  - ${formatScalar(item)}`)];
  }
  return [`${key}: ${formatScalar(value)}${tail}`];
}
