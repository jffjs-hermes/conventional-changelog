export type CommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'build'
  | 'ci'
  | 'chore'
  | 'revert';

export interface ParsedCommit {
  hash: string; // full 40-char SHA
  shortHash: string; // 7-char abbreviated
  type: CommitType;
  scope: string | null; // parenthesized scope, or null
  breaking: boolean; // '!' or BREAKING CHANGE footer
  breakingDescription: string | null; // text after 'BREAKING CHANGE: '
  subject: string; // description after type/scope
  body: string; // body paragraphs, '' if none
  footers: Map<string, string>; // other footer tokens
  raw: string; // full original message
}

export interface RawCommit {
  hash: string;
  message: string; // full raw message (subject+body+footers)
}

export type SemverBump = 'major' | 'minor' | 'patch' | 'none';

export interface RenderOptions {
  version: string | null; // heading version, null => 'Unreleased'
  linkCompare: boolean; // render compare link if repo URL known
  repoUrl: string | null; // e.g. https://github.com/o/r (no trailing /)
}