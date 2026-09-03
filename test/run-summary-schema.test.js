/**
 * Contract tests for the run summary — the versioned JSON shape published
 * through the `summary` Action output and $GITHUB_STEP_SUMMARY, documented
 * in docs/run-summary-schema.md and formally described by
 * schema/run-summary.v1.json.
 *
 * These tests build representative summaries for every terminal path
 * (success with changes, success with no change, guarded deletion,
 * configuration no-op, and API failure) with engine.buildRunSummary — the
 * same function main() calls on every path — and validate each one against
 * the committed JSON Schema file, so the schema document and the
 * implementation cannot silently drift apart. A dedicated section covers
 * secret redaction.
 *
 * test/harness.test.js separately proves these same outcomes end-to-end
 * through a real subprocess and $GITHUB_OUTPUT / $GITHUB_STEP_SUMMARY files;
 * this file is the schema-conformance and redaction contract in isolation.
 */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const engine = require('../scripts/sync-notion.js');

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const schema = JSON.parse(readFileSync(path.join(REPO_ROOT, 'schema', 'run-summary.v1.json'), 'utf8'));

// ─── Minimal JSON Schema (draft 2020-12 subset) validator ─────────────────────
//
// Only implements the keywords this repo's own schema uses ($ref, oneOf,
// const, enum, type, format: date-time, required, additionalProperties).
// Not a general-purpose validator — just enough to prove the schema file and
// buildRunSummary's actual output agree, without adding a dependency.

function validateAgainstSchema(node, value, defs) {
  if (node.$ref) {
    return validateAgainstSchema(defs[node.$ref.replace('#/$defs/', '')], value, defs);
  }
  if (node.oneOf) {
    const matches = node.oneOf.filter((sub) => {
      try { validateAgainstSchema(sub, value, defs); return true; } catch { return false; }
    });
    if (matches.length !== 1) {
      throw new Error(`oneOf: expected exactly one branch to match, got ${matches.length} for ${JSON.stringify(value)}`);
    }
    return true;
  }
  if (node.const !== undefined) {
    if (value !== node.const) throw new Error(`expected const ${node.const}, got ${JSON.stringify(value)}`);
    return true;
  }
  if (node.enum) {
    if (!node.enum.includes(value)) throw new Error(`expected one of ${node.enum.join('/')}, got ${JSON.stringify(value)}`);
    return true;
  }
  switch (node.type) {
    case 'null':
      if (value !== null) throw new Error(`expected null, got ${JSON.stringify(value)}`);
      return true;
    case 'string':
      if (typeof value !== 'string') throw new Error(`expected string, got ${JSON.stringify(value)}`);
      if (node.format === 'date-time' && Number.isNaN(Date.parse(value))) {
        throw new Error(`expected a parseable date-time, got ${JSON.stringify(value)}`);
      }
      return true;
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`expected boolean, got ${JSON.stringify(value)}`);
      return true;
    case 'integer':
      if (!Number.isInteger(value)) throw new Error(`expected integer, got ${JSON.stringify(value)}`);
      if (node.minimum !== undefined && value < node.minimum) throw new Error(`${value} below minimum ${node.minimum}`);
      return true;
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`expected object, got ${JSON.stringify(value)}`);
      }
      for (const key of node.required ?? []) {
        if (!(key in value)) throw new Error(`missing required key "${key}"`);
      }
      for (const key of Object.keys(value)) {
        if (node.additionalProperties === false && !(key in (node.properties ?? {}))) {
          throw new Error(`unexpected key "${key}" (additionalProperties: false)`);
        }
        if (node.properties?.[key]) validateAgainstSchema(node.properties[key], value[key], defs);
      }
      return true;
    }
    default:
      throw new Error(`unsupported schema node: ${JSON.stringify(node)}`);
  }
}

function assertConformsToSchema(summary) {
  expect(() => validateAgainstSchema(schema, summary, schema.$defs)).not.toThrow();
}

const zeroStats = () => ({ created: 0, updated: 0, renamed: 0, deleted: 0, unchanged: 0, errors: 0 });

// ─── The five canonical terminal-path outcomes ────────────────────────────────

describe('run summary conforms to schema/run-summary.v1.json', () => {
  it('success — changes made', () => {
    const summary = engine.buildRunSummary({
      result: 'success', code: 'synced', changed: true,
      startedAt: '2026-09-02T12:00:00.000Z', finishedAt: '2026-09-02T12:00:03.000Z',
      sections: [
        { label: 'pages', stats: { ...zeroStats(), created: 1, unchanged: 2 }, navChanged: true, homeChanged: true, configChanged: false },
        { label: 'posts', stats: { ...zeroStats(), updated: 1, unchanged: 3 }, navChanged: false, homeChanged: false, configChanged: false },
      ],
      detail: 'pages: 1 created, 0 updated, 0 renamed, 0 deleted, 2 unchanged (nav.yml, home.yml updated); posts: 0 created, 1 updated, 0 renamed, 0 deleted, 3 unchanged',
      secrets: [],
    });
    assertConformsToSchema(summary);
    expect(summary.result).toBe('success');
    expect(summary.changed).toBe(true);
  });

  it('success — nothing changed', () => {
    const summary = engine.buildRunSummary({
      result: 'success', code: 'synced', changed: false,
      startedAt: '2026-09-02T12:00:00.000Z', finishedAt: '2026-09-02T12:00:01.000Z',
      sections: [
        { label: 'pages', stats: { ...zeroStats(), unchanged: 3 }, navChanged: false, homeChanged: false, configChanged: false },
        { label: 'posts', stats: { ...zeroStats(), unchanged: 5 }, navChanged: false, homeChanged: false, configChanged: false },
      ],
      detail: 'pages: 0 created, 0 updated, 0 renamed, 0 deleted, 3 unchanged; posts: 0 created, 0 updated, 0 renamed, 0 deleted, 5 unchanged',
      secrets: [],
    });
    assertConformsToSchema(summary);
    expect(summary.changed).toBe(false);
    expect(summary.pages.unchanged).toBe(3);
  });

  it('no_op — configuration missing (missing_credentials)', () => {
    const summary = engine.buildRunSummary({
      result: 'no_op', code: 'missing_credentials', changed: false,
      startedAt: '2026-09-02T12:00:00.000Z', finishedAt: '2026-09-02T12:00:00.000Z',
      detail: 'skipped: NOTION_TOKEN environment variable is not set.',
      secrets: [],
    });
    assertConformsToSchema(summary);
    expect(summary.pages).toBeNull();
    expect(summary.posts).toBeNull();
    expect(summary.data_files).toBeNull();
  });

  it('failure — guarded deletion (bulk_delete_guard)', () => {
    const summary = engine.buildRunSummary({
      result: 'failure', code: 'bulk_delete_guard', changed: false,
      startedAt: '2026-09-02T12:00:00.000Z', finishedAt: '2026-09-02T12:00:02.000Z',
      detail: 'bulk-delete guard tripped for pages: would delete 3 of 4 tracked (75%)',
      secrets: [],
    });
    assertConformsToSchema(summary);
    expect(summary.detail).not.toMatch(/\.md/); // no filenames in the contract
  });

  it('failure — an unexpected sync error occurred (sync_error)', () => {
    const summary = engine.buildRunSummary({
      result: 'failure', code: 'sync_error', changed: false,
      startedAt: '2026-09-02T12:00:00.000Z', finishedAt: '2026-09-02T12:00:01.000Z',
      detail: 'sync failed: Error querying pages database: Could not find database with ID: db-live-id-123.',
      secrets: ['db-live-id-123'],
    });
    assertConformsToSchema(summary);
    expect(summary.detail).not.toContain('db-live-id-123');
    expect(summary.detail).toContain('[redacted]');
  });

  it('failure — per-row errors during an otherwise-completed sync (row_errors), which can still report changed=true', () => {
    // A row_errors run can still have created/updated real files before the
    // failing row — `changed` tracks "did anything change", independent of
    // `result`. See docs/run-summary-schema.md's note on this.
    const summary = engine.buildRunSummary({
      result: 'failure', code: 'row_errors', changed: true,
      startedAt: '2026-09-02T12:00:00.000Z', finishedAt: '2026-09-02T12:00:02.000Z',
      sections: [
        { label: 'pages', stats: { ...zeroStats(), created: 1, errors: 1 }, navChanged: false, homeChanged: false, configChanged: false },
      ],
      detail: 'pages: 1 created, 0 updated, 0 renamed, 0 deleted, 0 unchanged, 1 errors',
      secrets: [],
    });
    assertConformsToSchema(summary);
    expect(summary.pages.errors).toBe(1);
    expect(summary.changed).toBe(true);
    expect(summary.result).toBe('failure');
  });

  it('success — posts-only configuration leaves pages null but data_files a real (non-null) value', () => {
    // Not an abort: a posts-only site legitimately never runs the pages
    // section, so `pages` is null while `posts` and `data_files` are real —
    // proves pages/posts/data_files don't all go null together.
    const summary = engine.buildRunSummary({
      result: 'success', code: 'synced', changed: true,
      startedAt: '2026-09-02T12:00:00.000Z', finishedAt: '2026-09-02T12:00:01.000Z',
      sections: [
        { label: 'posts', stats: { ...zeroStats(), created: 1 }, navChanged: false, homeChanged: false, configChanged: false },
      ],
      detail: 'posts: 1 created, 0 updated, 0 renamed, 0 deleted, 0 unchanged',
      secrets: [],
    });
    assertConformsToSchema(summary);
    expect(summary.pages).toBeNull();
    expect(summary.posts).not.toBeNull();
    expect(summary.data_files).toEqual({ nav: false, home: false, config: false });
  });

  it('rejects a summary with an undocumented extra key (additionalProperties: false)', () => {
    const summary = engine.buildRunSummary({
      result: 'success', code: 'synced', changed: false,
      startedAt: 't0', finishedAt: 't1', detail: 'x', secrets: [],
    });
    expect(() => validateAgainstSchema(schema, { ...summary, extra: 'nope' }, schema.$defs)).toThrow();
  });

  it('rejects an unrecognized result value', () => {
    expect(() => validateAgainstSchema(schema, {
      schema_version: 1, result: 'maybe', code: 'synced', changed: false,
      started_at: 't0', finished_at: 't1', pages: null, posts: null, data_files: null, detail: '',
    }, schema.$defs)).toThrow();
  });
});

// ─── Secret redaction, at the schema-object level ─────────────────────────────

describe('secret redaction (contract-level)', () => {
  const NOTION_TOKEN = 'secret_abcdEFGH12345notionTokenLooksLikeThis';
  const PAGES_DB_ID  = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const POSTS_DB_ID  = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  const secrets = [NOTION_TOKEN, PAGES_DB_ID, POSTS_DB_ID];

  it('strips a Notion-style "not found" error message clean of the database ID', () => {
    const summary = engine.buildRunSummary({
      result: 'failure', code: 'sync_error', changed: false,
      startedAt: 't0', finishedAt: 't1', secrets,
      detail: `sync failed: Error querying pages database: Could not find database with ID: ${PAGES_DB_ID}. Make sure the relevant pages and databases are shared with your integration.`,
    });
    for (const secret of secrets) expect(summary.detail).not.toContain(secret);
    expect(JSON.stringify(summary)).not.toContain(PAGES_DB_ID);
  });

  it('strips a token value if one ever ends up in error text', () => {
    const summary = engine.buildRunSummary({
      result: 'failure', code: 'sync_error', changed: false,
      startedAt: 't0', finishedAt: 't1', secrets,
      detail: `sync failed: request rejected for token ${NOTION_TOKEN}`,
    });
    expect(summary.detail).not.toContain(NOTION_TOKEN);
    expect(summary.detail).toContain('[redacted]');
  });

  it('the Markdown rendering never carries a secret through either', () => {
    const summary = engine.buildRunSummary({
      result: 'failure', code: 'sync_error', changed: false,
      startedAt: 't0', finishedAt: 't1', secrets,
      detail: `sync failed: db ${POSTS_DB_ID} unreachable`,
    });
    const markdown = engine.renderStepSummaryMarkdown(summary);
    expect(markdown).not.toContain(POSTS_DB_ID);
  });

  it('redacts multiple distinct secrets appearing in the same detail string', () => {
    const summary = engine.buildRunSummary({
      result: 'failure', code: 'sync_error', changed: false,
      startedAt: 't0', finishedAt: 't1', secrets,
      detail: `sync failed: token ${NOTION_TOKEN} rejected for database ${PAGES_DB_ID}`,
    });
    expect(summary.detail).not.toContain(NOTION_TOKEN);
    expect(summary.detail).not.toContain(PAGES_DB_ID);
  });
});
