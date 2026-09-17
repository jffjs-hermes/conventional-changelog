import type { CommitType, ParsedCommit, RenderOptions } from './types.js';

// Fixed section order from spec §4 rule 2. Only non-empty sections are emitted.
const SECTION_ORDER: ReadonlyArray<readonly [CommitType, string]> = [
  ['feat', 'Features'],
  ['fix', 'Bug Fixes'],
  ['perf', 'Performance Improvements'],
  ['revert', 'Reverts'],
  ['docs', 'Documentation'],
  ['style', 'Styles'],
  ['refactor', 'Code Refactoring'],
  ['test', 'Tests'],
  ['build', 'Build System'],
  ['ci', 'Continuous Integration'],
  ['chore', 'Chores'],
];

function todayUtc(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatHash(commit: ParsedCommit, options: RenderOptions): string {
  if (options.repoUrl !== null && options.linkCompare) {
    return `[${commit.shortHash}](${options.repoUrl}/commit/${commit.shortHash})`;
  }
  return commit.shortHash;
}

export function renderChangelog(
  commits: ParsedCommit[],
  options: RenderOptions,
): string {
  const heading =
    options.version === null
      ? '## Unreleased'
      : `## v${options.version} (${todayUtc()})`;

  const blocks: string[] = [];
  for (const [type, sectionName] of SECTION_ORDER) {
    const sectionCommits = commits
      .filter((c) => c.type === type)
      .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
    if (sectionCommits.length === 0) continue;

    const lines: string[] = [`### ${sectionName}`, ''];
    for (const commit of sectionCommits) {
      const scopePrefix = commit.scope === null ? '' : `**${commit.scope}:** `;
      lines.push(`- ${scopePrefix}${commit.subject} (${formatHash(commit, options)})`);
      if (commit.breaking && commit.breakingDescription !== null) {
        lines.push(`  **BREAKING**: ${commit.breakingDescription}`);
      }
    }
    blocks.push(lines.join('\n'));
  }

  if (blocks.length === 0) return `${heading}\n`;
  return `${heading}\n\n${blocks.join('\n\n')}\n`;
}