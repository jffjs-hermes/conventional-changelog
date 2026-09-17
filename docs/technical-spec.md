# Technical Specification — conventional-changelog

A Node.js + TypeScript CLI that reads `git log`, parses conventional
commits, groups them by type, computes the implied semver bump, and
renders `CHANGELOG.md`.

Spec only. This document defines module boundaries, data shapes, the
conventional-commit grammar, semver rules, the CLI surface, and the
end-to-end test strategy. No feature code is included.

---

## 1. Module boundaries

ESM TypeScript, Node >= 20. Entry points per `package.json`: library
export `dist/src/index.js` (re-exports the public API), CLI binary
`dist/bin/cli.js`. No runtime dependencies; `node:child_process` and
`node:util.parseArgs` only.

```
src/
  types.ts      — shared data shapes (below)
  parser.ts     — commit message -> ParsedCommit | null
  semver.ts     — ParsedCommit[] -> SemverBump
  gitlog.ts     — git invocation -> RawCommit[]
  render.ts     — ParsedCommit[] + version -> markdown string
  index.ts      — public API re-exports
bin/cli.ts      — arg parsing, exit codes, output
test/
  *.test.ts     — unit + e2e tests (Node test runner)
```

Dependency direction: `cli -> {gitlog, parser, semver, render}`;
`render -> parser` (for types only); `semver -> parser` (types only).
`parser` and `semver` are pure — no I/O.

### 1.1 Data shapes (`src/types.ts`)

```ts
export type CommitType = 'feat' | 'fix' | 'docs' | 'style' |
  'refactor' | 'perf' | 'test' | 'build' | 'ci' | 'chore' | 'revert';

export interface ParsedCommit {
  hash: string;            // full 40-char SHA
  shortHash: string;       // 7-char abbreviated
  type: CommitType;
  scope: string | null;    // parenthesized scope, or null
  breaking: boolean;       // '!' or BREAKING CHANGE footer
  breakingDescription: string | null; // text after 'BREAKING CHANGE: '
  subject: string;         // description after type/scope
  body: string;            // body paragraphs, '' if none
  footers: Map<string, string>;       // other footer tokens
  raw: string;             // full original message
}

export interface RawCommit {
  hash: string;
  message: string;         // full raw message (subject+body+footers)
}

export type SemverBump = 'major' | 'minor' | 'patch' | 'none';

export interface RenderOptions {
  version: string | null;  // heading version, null => 'Unreleased'
  linkCompare: boolean;    // render compare link if repo URL known
  repoUrl: string | null;  // e.g. https://github.com/o/r (no trailing /)
}
```

### 1.2 `src/parser.ts`

```ts
export function parseConventionalCommit(raw: RawCommit): ParsedCommit | null;
export function parseMessage(message: string): Omit<ParsedCommit, 'hash' | 'shortHash'> | null;
```

- `parseConventionalCommit` returns `null` for non-conforming messages;
  callers skip those commits entirely.
- `parseMessage` is the pure core; `parseConventionalCommit` adds hash
  fields. Both are exported for testability.

### 1.3 `src/semver.ts`

```ts
export function computeBump(commits: ParsedCommit[]): SemverBump;
export function bumpVersion(current: string, bump: SemverBump): string;
```

- `computeBump` scans all commits and returns the highest applicable
  bump (precedence: major > minor > patch > none).
- `bumpVersion` implements the rules in §3; throws `RangeError` on an
  invalid `current` version or an un-incrementable case (§3.3).

### 1.4 `src/gitlog.ts`

```ts
export function getCommits(fromRef: string | null, toRef?: string): RawCommit[];
export async function getCommitsAsync(fromRef: string | null, toRef?: string): Promise<RawCommit[]>;
export function getLatestTag(): string | null;
export function getRepoUrl(): string | null;
```

- `getLatestTag()`: latest tag reachable from HEAD per
  `git describe --tags --abbrev=0` semantics; `null` when no tags.
- `getCommits(fromRef, toRef='HEAD')`: commits in
  `fromRef..toRef`; `fromRef === null` means the entire first-parent
  history (`--first-parent` not assumed; plain `git log` order, newest
  first).
- Uses a single `git log --format=%H%x00%B%x1e` invocation (NUL
  record separator, RS message terminator) — parsing is byte-exact and
  immune to message content.
- Throws a typed `GitError` (subclass of `Error`, carries `stderr`,
  `exitCode`) when git exits nonzero (e.g. unknown ref).

### 1.5 `src/render.ts`

```ts
export function renderChangelog(commits: ParsedCommit[], options: RenderOptions): string;
```

Deterministic output; section order and formatting fixed in §4.

### 1.6 `bin/cli.ts`

Orchestrates: parse args -> resolve range -> get commits -> parse ->
compute bump -> render -> write. See §5 for the argument surface.

---

## 2. Conventional-commit grammar

Based on the Conventional Commits 1.0.0 spec, strict subset:

```
commit      := header blank* body? footer*
header      := type ("(" scope ")")? ("!")? ": " subject
type        := one of CommitType (§1.1), case-sensitive lowercase
scope       := 1+ chars except "(" ")" newline whitespace
subject     := 1+ chars, no trailing whitespace; no requirements on case/punct
body        := free text paragraphs (may be empty)
footer      := token ": " value
token       := [A-Za-z-]+ | "BREAKING CHANGE"
```

Rules and edge cases:

1. **Header parsing is line-anchored.** Only the first line is tried
   against the header grammar. A blank line or EOF ends the header.
2. **Delimiter is exactly `": "`** (colon + single space). `feat:x`,
   `feat :x`, and `feat:  x` — the first two are non-conforming;
   `feat:  x` (two spaces) has subject ` x`, normalized by trimming to
   `x`.
3. **`!` before the colon** marks breaking: `feat(api)!: drop v1`.
   `!` may appear with or without a scope. `!` inside the subject has
   no special meaning.
4. **`BREAKING CHANGE: ` footer** (also accepted in the equivalent
   all-caps-`-` form `BREAKING-CHANGE: `) marks breaking and supplies
   `breakingDescription`. A footer value may span multiple lines
   (continuation lines are indented or blank); all are joined with a
   single space into one `breakingDescription` string.
5. **Footer detection.** Footer section starts at the last paragraph
   *if* its first line matches the footer token grammar; otherwise the
   whole tail is body. Common tokens preserved verbatim in `footers`:
   `Refs`, `Reviewed-by`, `Closes`, `Co-authored-by`, etc. Values keep
   original casing.
6. **Reverts.** Type `revert` is a normal type. Messages generated by
   `git revert` (`Revert "<orig subject>"`) are non-conforming (no
   type) and are skipped — users should instead commit
   `revert: <subject>` per project convention. Documented behavior:
   plain `git revert` commits do not appear in the changelog.
7. **Unknown types** (`featx: ...`, `WIP: ...`) — non-conforming,
   skipped, not an error.
8. **Merge commits** (`Merge branch ...`) are skipped by the grammar
   naturally (non-conforming). We do not filter by parent count.
9. Unicode subjects are allowed; the type itself must be ASCII
   lowercase.

### 2.1 Parser test matrix (unit)

At minimum: each CommitType; with/without scope; with/without `!`;
`BREAKING CHANGE` in footer vs `!`; multi-line breaking description;
footer vs trailing body ambiguity; `BREAKING-CHANGE` alias; whitespace
variants (§2 rule 2); non-conforming inputs returning `null` (plain
subject, `Merge ...`, unknown type, empty message, only-whitespace).

---

## 3. Semver bump rules

Given the set of parsed commits in the range:

| Signal                              | Bump  |
|-------------------------------------|-------|
| any commit with `breaking: true`    | major |
| else any `feat`                     | minor |
| else any `fix` or `perf`            | patch |
| else (docs/style/refactor/test/build/ci/chore/revert only, or no commits) | none |

Precedence is fixed: major > minor > patch > none.

### 3.1 `0.x` versions

For a current version whose major component is `0`:

- breaking commits bump the **minor** component (0.4.0 -> 0.5.0),
  matching "major is reserved for the first stable 1.0.0 release";
- `feat` bumps minor as usual (0.3.1 -> 0.4.0);
- `fix`/`perf` bump patch.

So on `0.x`: breaking and feat are both minor; there is no way to
reach 1.0.0 from commits alone — a manual tag/release does that.

### 3.2 Pre-release and precedence edge cases

- `bumpVersion` accepts a full semver including prerelease/build
  metadata (`1.2.3-beta.1+build.9`). The bump applies to the numeric
  core: `1.2.3-beta.1` + `feat` -> `1.3.0` (prerelease and build
  metadata are dropped on bump). This is a deliberate simplification:
  we do not implement semver precedence ordering between prerelease
  identifiers, because the tool never compares two versions — it only
  increments. Documented limitation.
- `computeBump` with zero commits returns `none`.
- `bumpVersion(v, 'none')` returns `v` unchanged (still validated).
- A current version like `1.2` or `v1.2.3` is invalid input:
  `RangeError` (no implicit `v` stripping at the semver layer; the CLI
  strips a leading `v` from `--latest-tag` output before calling in).

### 3.3 Un-incrementable case

`0.0.0` with a patch bump would be `0.0.1` — valid. There is no
overflow case under our rules; if an internal invariant is violated
(negative component), `bumpVersion` throws `RangeError`.

---

## 4. Rendering

Deterministic markdown, exactly this shape:

```markdown
## v1.3.0 (2026-09-16)

### Features

- **api:** add rate limiting ([abc1234](https://github.com/o/r/commit/abc1234...))

### Bug Fixes

- fix socket leak ([def5678](...))

### Breaking Changes

- add rate limiting: **drop v1 endpoints**
```

Rules:

1. Heading: `## v{version} ({YYYY-MM-DD of today, UTC})`, or
   `## Unreleased` when `options.version` is null.
2. Sections in fixed order, emitted only when non-empty:
   `Features` (feat), `Bug Fixes` (fix), `Performance Improvements`
   (perf), `Reverts` (revert), `Documentation` (docs), `Styles`
   (style), `Code Refactoring` (refactor), `Tests` (test), `Build
   System` (build), `Continuous Integration` (ci), `Chores` (chore).
3. Bullet format: `- {subject}` with `- **{scope}:** ` prefix when a
   scope exists. A trailing `**BREAKING**: {description}` sub-line
   (indented two spaces) when the commit is breaking and has a
   description.
4. Hash links only when `repoUrl` is set and `linkCompare` is true;
   otherwise plain short hash in parentheses.
5. Commits within a section sorted by hash ascending (stable,
   content-independent).
6. File ends with exactly one trailing newline.

---

## 5. CLI surface

```
conventional-changelog [options]
```

| Flag            | Type    | Default        | Meaning |
|-----------------|---------|----------------|---------|
| `--from <ref>`  | string  | latest tag     | Range start (exclusive). `none` means full history. |
| `--to <ref>`    | string  | `HEAD`         | Range end (inclusive). |
| `--out <file>`  | string  | stdout         | Write rendered changelog to file instead of stdout. |
| `--bump-only`   | boolean | false          | Print only the computed next version, e.g. `1.3.0`. |
| `--no-version`  | boolean | —              | Render as `Unreleased` heading. |
| `--tag <ver>`   | string  | auto           | Override the version heading (leading `v` optional). |

Defaults in action: if `--from` is not given, `getLatestTag()` is used;
when there are no tags, the full history is used.

Exit codes:

| Code | Meaning |
|------|---------|
| 0    | success (including `none` bump, which just reports no version change) |
| 1    | unexpected runtime error (unexpected git failure, unreadable output file) |
| 2    | usage error: unknown flag, missing flag value, invalid `--tag` version |

Errors go to `stderr` with a single-line message; nothing is written
to `--out` on failure.

`--from none` (literal) is the escape hatch for "no previous tag".

---

## 6. End-to-end test strategy

### 6.1 Fixture repo

A helper `test/fixtures/repo.ts` builds a throwaway git repo in a
temp directory:

1. `git init`, set `user.email`/`user.name` to fixed test values.
2. A `commitAll(msg)` helper: write a file, `git add .`,
   `git commit -m msg` (env-forced author dates for determinism).
3. A `tag(name)` helper.
4. A scripted scenario builder so each test constructs exactly the
   history it needs. Cleanup with `rm -rf` via the test runner's
   `after` hook.

Node's `node:test` `before`/`after` hooks create one shared fixture
repo per test file; tests mutate it sequentially.

### 6.2 E2E cases (each runs the compiled CLI via
`node dist/bin/cli.js` in the fixture repo cwd)

| Case | History | Expected |
|------|---------|----------|
| first release, no tags, feat+fix | `feat: a`, `fix: b` | minor bump `0.1.0` style output; both sections |
| tag `v1.0.0`, then fix | fix after tag | `## v1.0.1`, `### Bug Fixes` with the commit |
| tag `v1.2.3`, feat since | feat | `## v1.3.0` |
| breaking via `!` | `feat(api)!: x` | major bump; `**BREAKING**` line |
| breaking via footer | body with `BREAKING CHANGE: y` | major bump; description rendered |
| `0.x` breaking | current tag `v0.4.0`, `feat!:` | `## v0.5.0` (minor) |
| `--from none` mixed | three commits, no tag | full history rendered |
| `--bump-only` | as above | prints `1.3.0` exactly |
| non-conforming only | `chore-ish junk`, `Merge ...` | empty sections, exit 0, `none` bump |
| unknown ref | `--from nope` | exit 1, stderr message, no output file |
| bad flag | `--wat` | exit 2 |
| `--out` | writes file | file contents equal stdout rendering, one trailing newline |

### 6.3 Layered unit tests

- `parser.test.ts` — §2.1 matrix.
- `semver.test.ts` — bump precedence table, `0.x` rules,
  prerelease-dropping, `RangeError` on malformed versions.
- `render.test.ts` — golden-string snapshots: section order,
  scope prefix, breaking sub-line, hash-link on/off, sorted order.
- `gitlog.test.ts` — run against the fixture repo: range filtering,
  NUL-separator robustness with a commit message containing `%H`
  literally, `getLatestTag` null on tagless repo.

CI (`ci.yml` already present) runs lint, build, and tests on push/PR;
all must pass before merge.
