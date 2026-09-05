/**
 * Consistency contract for pinned actions: code and prose alike, every
 * tracked file must carry exactly one SHA and one version comment per
 * action. A failure means a pin bump was partial — fix the named straggler
 * ("Bumping a pinned action" in RELEASING.md), never weaken this test.
 */
import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dir, '..');

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function pinOccurrences() {
  return trackedFiles().flatMap((file) =>
    readFileSync(path.join(REPO_ROOT, file), 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        [...line.matchAll(/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)@([0-9a-f]{40})/g)].map((match) => ({
          file,
          lineNo: index + 1,
          action: match[1],
          sha: match[2],
          version: line.slice(match.index + match[0].length).match(/v?\d+(?:\.\d+)+/)?.[0] ?? null,
        })),
      ),
  );
}

function groupByAction(occurrences) {
  const groups = new Map();
  for (const occurrence of occurrences) {
    const pins = groups.get(occurrence.action) ?? [];
    pins.push(occurrence);
    groups.set(occurrence.action, pins);
  }
  return groups;
}

describe('pin consistency: every tracked file', () => {
  const groups = groupByAction(pinOccurrences());

  it('references exactly one SHA per action everywhere it appears', () => {
    expect(groups.size).toBeGreaterThan(0);
    const violations = [];
    for (const [action, pins] of groups) {
      for (const pin of pins) {
        if (pin.sha !== pins[0].sha) {
          violations.push(`${pin.file}:${pin.lineNo}: ${action} pinned to '${pin.sha}' disagrees with '${pins[0].sha}'`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('carries exactly one version per action wherever a version is written', () => {
    const violations = [];
    for (const [, pins] of groups) {
      const expected = pins.find((pin) => pin.version !== null)?.version;
      for (const pin of pins) {
        if (pin.version !== null && pin.version !== expected) {
          violations.push(`${pin.file}:${pin.lineNo}: version '${pin.version}' disagrees with '${expected}'`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
