// Task file = YAML frontmatter (the machine contract) + `##` sections (owned regions).
// The parsed document keeps every raw line, so `serialize(parse(text)) === text` byte for byte,
// and an edit rewrites only the field or section it touches.

import { type FieldValue, YamlError, formatField, parseFlowList, parseScalar, splitComment } from './yaml.ts';

export interface FrontmatterEntry {
  /** null for a comment or blank line kept verbatim. */
  key: string | null;
  value: FieldValue;
  comment?: string;
  /** Original lines; undefined once the value was changed and must be re-serialised. */
  raw?: string[];
}

export interface Section {
  name: string;
  /** Everything after the heading line, up to the next `## ` heading. */
  body: string;
}

export interface TaskDoc {
  entries: FrontmatterEntry[];
  /** Text between the closing `---` and the first section. */
  preamble: string;
  sections: Section[];
}

export class TaskParseError extends Error {
  override name = 'TaskParseError';
}

const FENCE = /^(```|~~~)/;

export function parseTask(text: string): TaskDoc {
  if (!text.startsWith('---\n')) throw new TaskParseError('a task file starts with `---` frontmatter');
  const end = text.indexOf('\n---\n', 3);
  const endAtEof = end === -1 && text.endsWith('\n---');
  if (end === -1 && !endAtEof) throw new TaskParseError('frontmatter is not closed with `---`');
  const fmText = endAtEof ? text.slice(4, -4) : text.slice(4, end + 1);
  const rest = endAtEof ? '' : text.slice(end + 5);
  return { entries: parseFrontmatter(fmText), ...parseSections(rest) };
}

function parseFrontmatter(fmText: string): FrontmatterEntry[] {
  const lines = fmText === '' ? [] : fmText.replace(/\n$/, '').split('\n');
  const entries: FrontmatterEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      entries.push({ key: null, value: null, raw: [line] });
      continue;
    }
    const match = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);
    if (!match) throw new TaskParseError(`frontmatter line ${i + 1} is not \`key: value\`: ${line}`);
    const key = match[1] as string;
    const [valueText, comment] = splitComment(match[2] as string);
    const raw = [line];
    let value: FieldValue;
    try {
      if (valueText.trim() === '' && /^\s+- /.test(lines[i + 1] ?? '')) {
        const items: string[] = [];
        while (/^\s+- /.test(lines[i + 1] ?? '')) {
          const itemLine = lines[++i] as string;
          raw.push(itemLine);
          items.push(String(parseScalar(splitComment(itemLine.replace(/^\s+- /, ''))[0])));
        }
        value = items;
      } else if (valueText.trim().startsWith('[') && valueText.trim().endsWith(']')) {
        value = parseFlowList(valueText);
      } else {
        value = parseScalar(valueText);
      }
    } catch (error) {
      if (error instanceof YamlError) throw new TaskParseError(`frontmatter \`${key}\`: ${error.message}`);
      throw error;
    }
    entries.push(comment === undefined ? { key, value, raw } : { key, value, comment, raw });
  }
  return entries;
}

function parseSections(text: string): { preamble: string; sections: Section[] } {
  const lines = text.split('\n');
  const sections: Section[] = [];
  const preamble: string[] = [];
  let current: { name: string; lines: string[] } | null = null;
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced;
    if (!fenced && /^## /.test(line)) {
      if (current) sections.push({ name: current.name, body: current.lines.join('\n') });
      current = { name: line.slice(3).trim(), lines: [] };
      continue;
    }
    (current ? current.lines : preamble).push(line);
  }
  if (current) sections.push({ name: current.name, body: current.lines.join('\n') });
  // Every line but the last one ended with '\n'; joining restores them exactly.
  return { preamble: preamble.join('\n') + (sections.length && preamble.length ? '\n' : ''), sections };
}

export function serializeTask(doc: TaskDoc): string {
  const fm = doc.entries.flatMap(
    (entry) => entry.raw ?? (entry.key === null ? [] : formatField(entry.key, entry.value, entry.comment)),
  );
  const parts = doc.sections.map((section) => `## ${section.name}\n${section.body}`);
  let body = doc.preamble;
  if (parts.length) {
    if (body !== '' && !body.endsWith('\n')) body += '\n';
    body += parts.join('\n');
  }
  return `---\n${fm.map((line) => `${line}\n`).join('')}---\n${body}`;
}

// ---- field access -------------------------------------------------------

export function getField(doc: TaskDoc, key: string): FieldValue | undefined {
  return doc.entries.find((entry) => entry.key === key)?.value;
}

export function setField(doc: TaskDoc, key: string, value: FieldValue): void {
  const entry = doc.entries.find((item) => item.key === key);
  if (entry) {
    if (JSON.stringify(entry.value) === JSON.stringify(value)) return;
    entry.value = value;
    delete entry.raw;
  } else {
    doc.entries.push({ key, value });
  }
}

export function fieldNames(doc: TaskDoc): string[] {
  return doc.entries.flatMap((entry) => (entry.key === null ? [] : [entry.key]));
}

// ---- sections -----------------------------------------------------------

export function getSection(doc: TaskDoc, name: string): string | undefined {
  return doc.sections.find((section) => section.name === name)?.body;
}

/** Canonical order; a missing section is inserted before the first section that follows it. */
export const SECTION_ORDER = ['Draft', 'Spec', 'Questions', 'Plan', 'Prototype', 'Acceptance criteria', 'Log'] as const;

/**
 * Normalises a section body. A body is the text after its heading line; the serialiser joins sections
 * with '\n', so a body ending in one '\n' leaves one blank line before the next heading.
 */
export function normalizeBody(content: string): string {
  const trimmed = content.replace(/^\n+/, '').replace(/\s+$/, '');
  return trimmed === '' ? '' : `${trimmed}\n`;
}

/** Low-level write without an ownership check — see write.ts for the owned API. */
export function putSection(doc: TaskDoc, name: string, body: string): void {
  const existing = doc.sections.find((section) => section.name === name);
  if (existing) {
    existing.body = body;
    return;
  }
  const rank = (section: string) => {
    const index = (SECTION_ORDER as readonly string[]).indexOf(section);
    return index === -1 ? SECTION_ORDER.length : index;
  };
  const at = doc.sections.findIndex((section) => rank(section.name) > rank(name));
  const section = { name, body };
  if (at === -1) {
    doc.sections.push(section);
  } else {
    doc.sections.splice(at, 0, section);
  }
}

export function cloneDoc(doc: TaskDoc): TaskDoc {
  return structuredClone(doc);
}

// ---- questions ----------------------------------------------------------

export interface Question {
  id: string;
  text: string;
  state: 'open' | 'answered';
  options: { letter: string; text: string }[];
  answer: string | null;
}

const QUESTION = /^### (Q\d+) · (.+?) · (open|answered)\s*$/;

export function parseQuestions(body: string | undefined): Question[] {
  if (!body) return [];
  const questions: Question[] = [];
  for (const line of body.split('\n')) {
    const head = QUESTION.exec(line);
    if (head) {
      questions.push({
        id: head[1] as string,
        text: head[2] as string,
        state: head[3] as Question['state'],
        options: [],
        answer: null,
      });
      continue;
    }
    const current = questions.at(-1);
    if (!current) continue;
    const option = /^- \(([a-z])\) (.+)$/.exec(line);
    if (option) current.options.push({ letter: option[1] as string, text: option[2] as string });
    const answer = /^> \*\*Answer:\*\*(.*)$/.exec(line);
    if (answer) current.answer = (answer[1] as string).trim() || null;
  }
  return questions;
}

export function openQuestions(doc: TaskDoc): Question[] {
  return parseQuestions(getSection(doc, 'Questions')).filter((question) => question.state === 'open');
}

// ---- acceptance criteria ------------------------------------------------

export const CRITERION_TAGS = ['closes', 'found', 'process'] as const;
export type CriterionTag = (typeof CRITERION_TAGS)[number];

export interface Criterion {
  n: number;
  tag: CriterionTag;
  text: string;
  /**
   * The shell command that proves a `[closes]` criterion: the first backtick span after a colon
   * (`… is exported from \`src/x.ts\`: \`grep -q …\``), else the first backtick span (`\`pnpm test\` passes`).
   * Pilot lesson 4: a real planner backticks names before the command, and the first span was `formatRelativeTime`.
   */
  command: string | null;
}

// `**[closes]**` is the canonical form; a bare `[closes]` is accepted too — real agents drop the bold.
const CRITERION = /^\s*(\d+)\.\s+(?:\*\*)?\[(closes|found|process)\](?:\*\*)?\s*(.*)$/;

export function parseCriteria(body: string | undefined): Criterion[] {
  if (!body) return [];
  return body.split('\n').flatMap((line) => {
    const match = CRITERION.exec(line);
    if (!match) return [];
    const tag = match[2] as CriterionTag;
    const text = match[3] as string;
    const command = tag === 'closes' ? provingCommand(text) : null;
    return [{ n: Number(match[1]), tag, text, command }];
  });
}

/**
 * Lines that carry a criterion tag but do not parse as `N. [tag] …` — a `1a.` or a bullet. The loop would
 * silently skip them, `[closes]` commands included (pilot lesson 8), so validation names them instead.
 */
export function unreadCriteria(body: string | undefined): string[] {
  if (!body) return [];
  return body
    .split('\n')
    .filter((line) => /\[(closes|found|process)\]/.test(line) && !CRITERION.test(line))
    .map((line) => line.trim());
}

function provingCommand(text: string): string | null {
  const spans = [...text.matchAll(/`([^`]+)`/g)];
  const afterColon = spans.find((span) => /:\s*$/.test(text.slice(0, span.index)));
  return (afterColon ?? spans[0])?.[1] ?? null;
}

/** A criterion's text without its command span, for a list that shows the command beside it. */
export function criterionLabel(criterion: Criterion): string {
  if (!criterion.command) return criterion.text.trim();
  return criterion.text
    .replace(`\`${criterion.command}\``, '')
    .replace(/\s*:\s*$|:\s+(?=\()/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- review blocks (Plan, Prototype) ---------------------------------------------------

/** The `### Review` subsection at the end of Plan or Prototype (human-owned), or '' when absent. */
export function reviewBlock(body: string | undefined): string {
  if (!body) return '';
  const at = body.search(/^### Review\s*$/m);
  return at === -1 ? '' : body.slice(at);
}
