/**
 * Round-trip tests for the RUN_SUMMARY_FILE artifact channel — the third
 * sink writeActionOutputs feeds alongside GITHUB_OUTPUT and
 * GITHUB_STEP_SUMMARY. Summaries are built through the same buildRunSummary
 * calls main() makes on each terminal path, emitted through the real
 * writeActionOutputs, and the resulting file is parsed and validated against
 * schema/run-summary.v1.json with the shared validator.
 *
 * The same channel is proven end-to-end through the engine subprocess,
 * including the exit-1 paths, by test/harness.test.js.
 */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const engine = require('../scripts/sync-notion.js');
const { schema, validateAgainstSchema } = require('./support/run-summary-validator.js');

const zeroStats = () => ({ created: 0, updated: 0, renamed: 0, deleted: 0, unchanged: 0, errors: 0 });

describe('writeActionOutputs — RUN_SUMMARY_FILE artifact channel', () => {
  const tmpFiles = [];
  const original = {
    GITHUB_OUTPUT: process.env.GITHUB_OUTPUT,
    GITHUB_STEP_SUMMARY: process.env.GITHUB_STEP_SUMMARY,
    RUN_SUMMARY_FILE: process.env.RUN_SUMMARY_FILE,
  };

  function makeDir() {
    const dir = mkdtempSync(path.join(tmpdir(), 'notiongit-summary-'));
    tmpFiles.push(dir);
    return dir;
  }

  const sampleSummary = () => engine.buildRunSummary({
    result: 'success', code: 'synced', changed: true,
    startedAt: '2026-09-04T12:00:00.000Z', finishedAt: '2026-09-04T12:00:03.000Z',
    detail: 'pages: 1 created', secrets: [],
  });

  it('writes the run summary JSON plus a trailing newline to RUN_SUMMARY_FILE when set', () => {
    const file = path.join(makeDir(), 'run-summary.json');
    process.env.RUN_SUMMARY_FILE = file;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_STEP_SUMMARY;

    const summary = sampleSummary();
    engine.writeActionOutputs(summary);

    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(summary) + '\n');
    expect(() => validateAgainstSchema(schema, JSON.parse(readFileSync(file, 'utf8')), schema.$defs)).not.toThrow();
  });

  it('writes file content equal to the summary heredoc body in GITHUB_OUTPUT (single source of truth)', () => {
    const dir = makeDir();
    const outFile = path.join(dir, 'github_output');
    const summaryFile = path.join(dir, 'run-summary.json');
    writeFileSync(outFile, '');
    process.env.GITHUB_OUTPUT = outFile;
    process.env.RUN_SUMMARY_FILE = summaryFile;
    delete process.env.GITHUB_STEP_SUMMARY;

    engine.writeActionOutputs(sampleSummary());

    const heredocBody = readFileSync(outFile, 'utf8').split('\n')[2];
    expect(JSON.parse(readFileSync(summaryFile, 'utf8'))).toEqual(JSON.parse(heredocBody));
  });

  it('never carries a configured secret through the file channel', () => {
    const DB_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const file = path.join(makeDir(), 'run-summary.json');
    process.env.RUN_SUMMARY_FILE = file;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_STEP_SUMMARY;

    engine.writeActionOutputs(engine.buildRunSummary({
      result: 'failure', code: 'sync_error', changed: false,
      startedAt: '2026-09-04T12:00:00.000Z', finishedAt: '2026-09-04T12:00:01.000Z',
      detail: `sync failed: Error querying pages database: Could not find database with ID: ${DB_ID}.`,
      secrets: [DB_ID],
    }));

    const content = readFileSync(file, 'utf8');
    expect(content).toContain('[redacted]');
    expect(content).not.toContain(DB_ID);
  });

  it.each([
    ['success/synced', () => {
      const sections = [
        { label: 'pages', stats: { ...zeroStats(), created: 1, unchanged: 2 }, navChanged: true, homeChanged: true, configChanged: false },
        { label: 'posts', stats: { ...zeroStats(), updated: 1, unchanged: 3 }, navChanged: false, homeChanged: false, configChanged: false },
      ];
      const { changed, summary: detail } = engine.buildActionResult(sections);
      return engine.buildRunSummary({
        result: 'success', code: 'synced', changed,
        startedAt: '2026-09-04T12:00:00.000Z', finishedAt: '2026-09-04T12:00:03.000Z',
        sections, detail,
        secrets: ['secret-token-never-printed', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'],
      });
    }],
    ['no_op/missing_credentials', () =>
      engine.buildRunSummary({
        result: 'no_op', code: 'missing_credentials', changed: false,
        startedAt: '2026-09-04T12:00:00.000Z', finishedAt: '2026-09-04T12:00:00.000Z',
        detail: 'skipped: NOTION_TOKEN environment variable is not set.',
        secrets: [],
      })],
    ['failure/bulk_delete_guard', () =>
      engine.buildRunSummary({
        result: 'failure', code: 'bulk_delete_guard', changed: false,
        startedAt: '2026-09-04T12:00:00.000Z', finishedAt: '2026-09-04T12:00:02.000Z',
        detail: 'bulk-delete guard tripped for pages: would delete 3 of 4 tracked (75%)',
        secrets: ['secret-token-never-printed', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'],
      })],
    ['failure/sync_error', () =>
      engine.buildRunSummary({
        result: 'failure', code: 'sync_error', changed: false,
        startedAt: '2026-09-04T12:00:00.000Z', finishedAt: '2026-09-04T12:00:01.000Z',
        detail: 'sync failed: Error querying pages database: Could not find database with ID: aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.',
        secrets: ['secret-token-never-printed', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'],
      })],
    ['failure/row_errors', () => {
      const sections = [
        { label: 'pages', stats: { ...zeroStats(), created: 1, errors: 1 }, navChanged: false, homeChanged: false, configChanged: false },
      ];
      const { changed, summary: detail } = engine.buildActionResult(sections);
      return engine.buildRunSummary({
        result: 'failure', code: 'row_errors', changed,
        startedAt: '2026-09-04T12:00:00.000Z', finishedAt: '2026-09-04T12:00:02.000Z',
        sections, detail,
        secrets: ['secret-token-never-printed', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'],
      });
    }],
  ])('validates the %s terminal shape through the file channel', (name, makeSummary) => {
    const file = path.join(makeDir(), 'run-summary.json');
    process.env.RUN_SUMMARY_FILE = file;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_STEP_SUMMARY;

    engine.writeActionOutputs(makeSummary());

    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    expect(() => validateAgainstSchema(schema, parsed, schema.$defs)).not.toThrow();
    expect(parsed.code).toBe(name.split('/')[1]);
  });

  it('writes nothing and does not throw when RUN_SUMMARY_FILE is unset', () => {
    delete process.env.RUN_SUMMARY_FILE;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_STEP_SUMMARY;
    expect(() => engine.writeActionOutputs(sampleSummary())).not.toThrow();
  });

  it('contains a write failure to a file whose parent cannot be created, keeping GITHUB_OUTPUT intact', () => {
    const dir = makeDir();
    const blocker = path.join(dir, 'blocker');
    writeFileSync(blocker, 'a regular file, not a directory');
    const file = path.join(blocker, 'run-summary.json');
    const outFile = path.join(dir, 'github_output');
    writeFileSync(outFile, '');
    process.env.RUN_SUMMARY_FILE = file;
    process.env.GITHUB_OUTPUT = outFile;
    delete process.env.GITHUB_STEP_SUMMARY;

    const summary = sampleSummary();
    expect(() => engine.writeActionOutputs(summary)).not.toThrow();

    expect(existsSync(file)).toBe(false);
    expect(readFileSync(outFile, 'utf8')).toBe(
      'changed=true\n' +
      'summary<<NOTIONGIT_SYNC_SUMMARY_EOF\n' +
      JSON.stringify(summary) + '\n' +
      'NOTIONGIT_SYNC_SUMMARY_EOF\n'
    );
  });

  it('overwrites a pre-existing file at the target path', () => {
    const file = path.join(makeDir(), 'run-summary.json');
    writeFileSync(file, 'stale summary from a previous run');
    process.env.RUN_SUMMARY_FILE = file;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_STEP_SUMMARY;

    const summary = engine.buildRunSummary({
      result: 'no_op', code: 'missing_credentials', changed: false,
      startedAt: '2026-09-04T12:00:00.000Z', finishedAt: '2026-09-04T12:00:00.000Z',
      detail: 'skipped: NOTION_TOKEN environment variable is not set.',
      secrets: [],
    });
    engine.writeActionOutputs(summary);

    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(summary) + '\n');
  });

  it('restores the environment', () => {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    for (const dir of tmpFiles) rmSync(dir, { recursive: true, force: true });
  });
});
