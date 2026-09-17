import type { CommitType, ParsedCommit, RawCommit } from './types.js';

const COMMIT_TYPES =
  'feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert';

// header := type ("(" scope ")")? ("!")? ": " subject
// scope   := 1+ chars except "(" ")" whitespace
const HEADER_RE = new RegExp(
  `^(${COMMIT_TYPES})(?:\\(([^()\\s]+)\\))?(!)?: (.*)$`,
);

// footer := token ": " value  where token := [A-Za-z-]+ | "BREAKING CHANGE"
const FOOTER_LINE_RE = /^(BREAKING CHANGE|[A-Za-z-]+): (.*)$/;

function isFooterTokenLine(line: string): boolean {
  return FOOTER_LINE_RE.test(line);
}

function parseTail(
  tail: string[],
): Pick<ParsedCommit, 'body' | 'footers' | 'breaking' | 'breakingDescription'> {
  // Split the tail into paragraphs (blocks of consecutive non-blank lines).
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const line of tail) {
    if (line.trim() === '') {
      if (current.length > 0) {
        paragraphs.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    paragraphs.push(current);
  }

  // Footer detection: the footer section is the last paragraph if its first
  // line matches the footer-token grammar; otherwise the whole tail is body.
  let footerLines: string[] = [];
  let bodyParagraphs: string[][] = paragraphs;
  const lastParagraph = paragraphs[paragraphs.length - 1];
  if (lastParagraph !== undefined && isFooterTokenLine(lastParagraph[0] ?? '')) {
    footerLines = lastParagraph;
    bodyParagraphs = paragraphs.slice(0, -1);
  }

  const body = bodyParagraphs.map((p) => p.join('\n')).join('\n\n');

  const footers = new Map<string, string>();
  let breakingDescription: string | null = null;
  let lastToken: string | null = null;
  let lastIsBreaking = false;

  for (const line of footerLines) {
    const match = FOOTER_LINE_RE.exec(line);
    if (match !== null) {
      const token = match[1] ?? '';
      const value = (match[2] ?? '').trim();
      if (token === 'BREAKING CHANGE' || token === 'BREAKING-CHANGE') {
        breakingDescription = value;
        lastIsBreaking = true;
        lastToken = null;
      } else {
        footers.set(token, value);
        lastToken = token;
        lastIsBreaking = false;
      }
    } else if (lastToken !== null) {
      // Continuation line (indented): join with the previous footer value.
      const existing = footers.get(lastToken) ?? '';
      const continuation = line.trim();
      footers.set(
        lastToken,
        existing.length > 0 ? `${existing} ${continuation}` : continuation,
      );
    } else if (lastIsBreaking && breakingDescription !== null) {
      // Continuation of the BREAKING CHANGE footer value.
      const continuation = line.trim();
      breakingDescription =
        breakingDescription.length > 0
          ? `${breakingDescription} ${continuation}`
          : continuation;
    }
  }

  return {
    body,
    footers,
    breaking: breakingDescription !== null,
    breakingDescription,
  };
}

export function parseMessage(
  message: string,
): Omit<ParsedCommit, 'hash' | 'shortHash'> | null {
  const normalized = message.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  const headerLine = lines[0] ?? '';
  const header = HEADER_RE.exec(headerLine);

  // A non-matching first line (or empty) means the commit is non-conforming.
  if (header === null || header[1] === undefined) {
    return null;
  }

  const type = header[1] as CommitType;
  const scope = header[2] ?? null; // may be undefined when no scope
  const bang = header[3];
  const subject = (header[4] ?? '').trim();

  // subject := 1+ chars, no trailing whitespace
  if (subject.length === 0) {
    return null;
  }

  const tail = parseTail(lines.slice(1));
  const breaking = bang === '!' || tail.breaking;
  const breakingDescription = tail.breaking
    ? tail.breakingDescription
    : null;

  return {
    type,
    scope,
    breaking,
    breakingDescription,
    subject,
    body: tail.body,
    footers: tail.footers,
    raw: message,
  };
}

export function parseConventionalCommit(
  raw: RawCommit,
): ParsedCommit | null {
  const base = parseMessage(raw.message);
  if (base === null) {
    return null;
  }
  return {
    ...base,
    hash: raw.hash,
    shortHash: raw.hash.slice(0, 7),
  };
}