/**
 * Unit tests for the engine's input/output plumbing: input mapping and
 * boolean normalization (resolveConfig / isTrue), result folding
 * (buildActionResult) and Action output emission (writeActionOutputs).
 *
 * The sync itself is exercised end-to-end by test/harness.test.js against a
 * local fake Notion API — nothing here touches the network.
 */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const engine = require('../scripts/sync-notion.js');

const REPO_ROOT = path.resolve(import.meta.dir, '..');

// ─── isTrue: boolean normalization ────────────────────────────────────────────

describe('isTrue (allow_bulk_delete normalization)', () => {
  it.each([
    ['true', true],
    ['True', true],
    ['TRUE', true],
    [' true ', true],
    ['false', false],
    ['1', false],
    ['yes', false],
    ['', false],
    [undefined, false],
    [null, false],
  ])('isTrue(%j) → %s', (value, expected) => {
    expect(engine.isTrue(value)).toBe(expected);
  });
});

// ─── resolveConfig: input mapping ─────────────────────────────────────────────

describe('resolveConfig (environment → config mapping)', () => {
  it('requires NOTION_TOKEN with the historical message', () => {
    expect(() => engine.resolveConfig({}))
      .toThrow('NOTION_TOKEN environment variable is not set.');
  });

  it('requires at least one database ID with the historical message', () => {
    expect(() => engine.resolveConfig({ NOTION_TOKEN: 't' }))
      .toThrow('Set NOTION_PAGES_DATABASE_ID and/or NOTION_POSTS_DATABASE_ID.');
  });

  it('maps the Action wrapper inputs to engine config', () => {
    const config = engine.resolveConfig({
      NOTION_TOKEN:              'secret-token',
      NOTION_PAGES_DATABASE_ID:  'pages-db',
      NOTION_POSTS_DATABASE_ID:  'posts-db',
      ALLOW_BULK_DELETE:         'false',
      MAX_DELETE_RATIO:          '0.25',
      SITE_ROOT:                 '/tmp/some-site',
    });

    expect(config).toEqual({
      notionToken:    'secret-token',
      pagesDbId:      'pages-db',
      postsDbId:      'posts-db',
      allowBulkDelete: false,
      maxDeleteRatio: 0.25,
      siteRoot:       '/tmp/some-site',
      notionBaseUrl:  '',
    });
  });

  it('treats a whitespace-only token as not set', () => {
    expect(() => engine.resolveConfig({ NOTION_TOKEN: '   ' }))
      .toThrow('NOTION_TOKEN environment variable is not set.');
  });

  it('treats whitespace-only database ids as not set', () => {
    expect(() => engine.resolveConfig({
      NOTION_TOKEN: 't',
      NOTION_PAGES_DATABASE_ID: '   ',
      NOTION_POSTS_DATABASE_ID: '\t\n',
    })).toThrow('Set NOTION_PAGES_DATABASE_ID and/or NOTION_POSTS_DATABASE_ID.');
  });

  it('trims a valid token and database id', () => {
    const config = engine.resolveConfig({
      NOTION_TOKEN: '  secret-token  ',
      NOTION_POSTS_DATABASE_ID: '  posts-db  ',
    });
    expect(config.notionToken).toBe('secret-token');
    expect(config.postsDbId).toBe('posts-db');
  });

  it('accepts a whitespace-padded legacy posts-only configuration as valid', () => {
    const config = engine.resolveConfig({
      NOTION_TOKEN: 't',
      NOTION_PAGES_DATABASE_ID: '',
      NOTION_POSTS_DATABASE_ID: '  ',
      NOTION_DATABASE_ID: '  legacy-db  ',
    });
    expect(config.pagesDbId).toBe('');
    expect(config.postsDbId).toBe('legacy-db');
  });

  it('falls back to the legacy NOTION_DATABASE_ID for posts', () => {
    const legacy = engine.resolveConfig({
      NOTION_TOKEN: 't',
      NOTION_DATABASE_ID: 'legacy-db',
    });
    expect(legacy.postsDbId).toBe('legacy-db');

    const preferred = engine.resolveConfig({
      NOTION_TOKEN: 't',
      NOTION_POSTS_DATABASE_ID: 'new-db',
      NOTION_DATABASE_ID: 'legacy-db',
    });
    expect(preferred.postsDbId).toBe('new-db');
  });

  it('normalizes allow_bulk_delete case-insensitively', () => {
    for (const spelling of ['true', 'True', 'TRUE']) {
      expect(engine.resolveConfig({
        NOTION_TOKEN: 't', NOTION_POSTS_DATABASE_ID: 'db', ALLOW_BULK_DELETE: spelling,
      }).allowBulkDelete).toBe(true);
    }
    expect(engine.resolveConfig({
      NOTION_TOKEN: 't', NOTION_POSTS_DATABASE_ID: 'db', ALLOW_BULK_DELETE: 'false',
    }).allowBulkDelete).toBe(false);
  });

  it('defaults MAX_DELETE_RATIO to 0.5 for empty/non-numeric values', () => {
    for (const bad of ['', 'abc', undefined, '0']) {
      expect(engine.resolveConfig({
        NOTION_TOKEN: 't', NOTION_POSTS_DATABASE_ID: 'db', MAX_DELETE_RATIO: bad,
      }).maxDeleteRatio).toBe(0.5);
    }
  });

  it('defaults the site root to this repository (parent of scripts/)', () => {
    const config = engine.resolveConfig({ NOTION_TOKEN: 't', NOTION_POSTS_DATABASE_ID: 'db' });
    expect(config.siteRoot).toBe(REPO_ROOT);
  });

  it('does not read or mutate process.env when env is injected', () => {
    // Ambient-proof: assert the engine-relevant keys are absent afterwards and
    // everything else is untouched, regardless of what the shell exports.
    const tracked = ['NOTION_TOKEN', 'NOTION_PAGES_DATABASE_ID', 'NOTION_POSTS_DATABASE_ID', 'SITE_ROOT'];
    const before = { ...process.env };
    for (const key of tracked) delete process.env[key];

    engine.resolveConfig({ NOTION_TOKEN: 't', NOTION_PAGES_DATABASE_ID: 'db' });

    for (const key of tracked) expect(process.env[key]).toBeUndefined();
    for (const key of Object.keys(before)) {
      if (!tracked.includes(key)) expect(process.env[key]).toBe(before[key]);
    }
    // Restore the ambient environment for other test files.
    Object.assign(process.env, before);
  });
});

// ─── buildActionResult: changed/summary folding ───────────────────────────────

const zeroStats = () => ({ created: 0, updated: 0, renamed: 0, deleted: 0, unchanged: 0, errors: 0 });

describe('buildActionResult (changed / summary)', () => {
  it('reports no change and no sections for an empty run', () => {
    const result = engine.buildActionResult([]);
    expect(result.changed).toBe(false);
    expect(result.summary).toBe('no sections synced');
  });

  it('reports unchanged when every section is all zeros', () => {
    const result = engine.buildActionResult([
      { label: 'pages', stats: zeroStats(), navChanged: false, homeChanged: false, configChanged: false },
      { label: 'posts', stats: zeroStats(), navChanged: false, homeChanged: false, configChanged: false },
    ]);
    expect(result.changed).toBe(false);
    expect(result.summary).toBe(
      'pages: 0 created, 0 updated, 0 renamed, 0 deleted, 0 unchanged; ' +
      'posts: 0 created, 0 updated, 0 renamed, 0 deleted, 0 unchanged'
    );
  });

  it.each([
    ['created',   { ...zeroStats(), created: 1 },   { navChanged: false, homeChanged: false, configChanged: false }],
    ['updated',   { ...zeroStats(), updated: 1 },   { navChanged: false, homeChanged: false, configChanged: false }],
    ['renamed',   { ...zeroStats(), renamed: 1 },   { navChanged: false, homeChanged: false, configChanged: false }],
    ['deleted',   { ...zeroStats(), deleted: 1 },   { navChanged: false, homeChanged: false, configChanged: false }],
    ['navChanged', zeroStats(), { navChanged: true, homeChanged: false, configChanged: false }],
    ['homeChanged', zeroStats(), { navChanged: false, homeChanged: true, configChanged: false }],
    ['configChanged', zeroStats(), { navChanged: false, homeChanged: false, configChanged: true }],
  ])('flags changed=true on %s', (_name, stats, flags) => {
    const result = engine.buildActionResult([
      { label: 'pages', stats, ...flags },
    ]);
    expect(result.changed).toBe(true);
  });

  it('lists updated data files and errors in the summary', () => {
    const result = engine.buildActionResult([
      { label: 'pages', stats: { ...zeroStats(), unchanged: 2 }, navChanged: true, homeChanged: true, configChanged: true },
      { label: 'posts', stats: { ...zeroStats(), unchanged: 3, errors: 1 } },
    ]);
    expect(result.changed).toBe(true);
    expect(result.summary).toBe(
      'pages: 0 created, 0 updated, 0 renamed, 0 deleted, 2 unchanged ' +
      '(nav.yml, home.yml, _config.yml updated); ' +
      'posts: 0 created, 0 updated, 0 renamed, 0 deleted, 3 unchanged, 1 errors'
    );
  });
});

// ─── redact: secret scrubbing ─────────────────────────────────────────────────

describe('redact (secret scrubbing)', () => {
  it('replaces every occurrence of a secret value with a fixed placeholder', () => {
    expect(engine.redact('token tok-123 seen twice: tok-123', ['tok-123']))
      .toBe('token [redacted] seen twice: [redacted]');
  });

  it('redacts multiple distinct secrets independently', () => {
    expect(engine.redact('db db-a and db db-b', ['db-a', 'db-b']))
      .toBe('db [redacted] and db [redacted]');
  });

  it('ignores falsy secrets (unset config values) instead of matching everything', () => {
    expect(engine.redact('nothing to hide', ['', undefined, null])).toBe('nothing to hide');
  });

  it('is a plain substring replacement, not a regex — special characters are literal', () => {
    expect(engine.redact('id (a.b+c) here', ['(a.b+c)'])).toBe('id [redacted] here');
  });

  it('passes text through unchanged when no secrets are given', () => {
    expect(engine.redact('plain text')).toBe('plain text');
  });

  it('stringifies non-string input', () => {
    expect(engine.redact(undefined, [])).toBe('');
  });
});

// ─── buildRunSummary: schema_version 1 run summary ────────────────────────────

describe('buildRunSummary (schema_version 1)', () => {
  const base = {
    result: 'success', code: 'synced', changed: true,
    startedAt: '2026-09-02T12:00:00.000Z', finishedAt: '2026-09-02T12:00:03.000Z',
    secrets: [],
  };

  it('always stamps schema_version 1', () => {
    expect(engine.buildRunSummary({ ...base, detail: 'x' }).schema_version).toBe(1);
    expect(engine.RUN_SUMMARY_SCHEMA_VERSION).toBe(1);
  });

  it('requires secrets to be passed explicitly (fails closed instead of silently skipping redaction)', () => {
    const { secrets: _omit, ...withoutSecrets } = base;
    expect(() => engine.buildRunSummary({ ...withoutSecrets, detail: 'x' })).toThrow('secrets must be an array');
  });

  it('sets pages/posts/data_files to null when no sections are given (the documented fallback)', () => {
    const summary = engine.buildRunSummary({ ...base, result: 'failure', code: 'sync_error', changed: false, detail: 'x' });
    expect(summary.pages).toBeNull();
    expect(summary.posts).toBeNull();
    expect(summary.data_files).toBeNull();
  });

  it('fills pages/posts counts and data_files from sections that ran', () => {
    const summary = engine.buildRunSummary({
      ...base,
      detail: 'x',
      sections: [
        { label: 'pages', stats: { ...zeroStats(), created: 1 }, navChanged: true, homeChanged: false, configChanged: false },
        { label: 'posts', stats: { ...zeroStats(), updated: 2 }, navChanged: false, homeChanged: false, configChanged: false },
      ],
    });
    expect(summary.pages).toEqual({ created: 1, updated: 0, renamed: 0, deleted: 0, unchanged: 0, errors: 0 });
    expect(summary.posts).toEqual({ created: 0, updated: 2, renamed: 0, deleted: 0, unchanged: 0, errors: 0 });
    expect(summary.data_files).toEqual({ nav: true, home: false, config: false });
  });

  it('leaves only the section that ran non-null on a posts-only config, but data_files stays a real (non-null) answer', () => {
    // A successful posts-only run: `pages` null just means "this section
    // didn't run", not "this run failed" — data_files is still meaningful
    // (posts never touches nav/home/config, so it's correctly all-false, not
    // null) because at least one section (posts) did run.
    const summary = engine.buildRunSummary({
      ...base,
      detail: 'x',
      sections: [{ label: 'posts', stats: zeroStats(), navChanged: false, homeChanged: false, configChanged: false }],
    });
    expect(summary.pages).toBeNull();
    expect(summary.posts).not.toBeNull();
    expect(summary.data_files).toEqual({ nav: false, home: false, config: false });
  });

  it('redacts secrets out of detail using the provided secret list', () => {
    const summary = engine.buildRunSummary({
      ...base, result: 'failure', code: 'sync_error', changed: false,
      detail: 'sync failed: Could not find database with ID: db-secret-123.',
      secrets: ['db-secret-123'],
    });
    expect(summary.detail).toBe('sync failed: Could not find database with ID: [redacted].');
  });

  it('round-trips through JSON.stringify with the documented key order', () => {
    const summary = engine.buildRunSummary({ ...base, detail: 'x' });
    expect(Object.keys(summary)).toEqual([
      'schema_version', 'result', 'code', 'changed',
      'started_at', 'finished_at', 'pages', 'posts', 'data_files', 'detail',
    ]);
  });
});

// ─── renderStepSummaryMarkdown: $GITHUB_STEP_SUMMARY rendering ────────────────

describe('renderStepSummaryMarkdown', () => {
  it('renders result, code, changed and timestamps', () => {
    const md = engine.renderStepSummaryMarkdown(engine.buildRunSummary({
      result: 'success', code: 'synced', changed: true,
      startedAt: '2026-09-02T12:00:00.000Z', finishedAt: '2026-09-02T12:00:03.000Z',
      detail: 'x', secrets: [],
    }));
    expect(md).toContain('success');
    expect(md).toContain('`synced`');
    expect(md).toContain('**Changed:** yes');
    expect(md).toContain('2026-09-02T12:00:00.000Z');
    expect(md).toContain('2026-09-02T12:00:03.000Z');
  });

  it('renders a counts table only when at least one section ran', () => {
    const withSections = engine.renderStepSummaryMarkdown(engine.buildRunSummary({
      result: 'success', code: 'synced', changed: false,
      startedAt: 't0', finishedAt: 't1', detail: 'x', secrets: [],
      sections: [{ label: 'pages', stats: { ...zeroStats(), created: 1 }, navChanged: false, homeChanged: false, configChanged: false }],
    }));
    expect(withSections).toContain('| Pages | 1 | 0 | 0 | 0 | 0 | 0 |');

    const withoutSections = engine.renderStepSummaryMarkdown(engine.buildRunSummary({
      result: 'no_op', code: 'missing_credentials', changed: false,
      startedAt: 't0', finishedAt: 't0', detail: 'skipped: NOTION_TOKEN environment variable is not set.',
      secrets: [],
    }));
    expect(withoutSections).not.toContain('| Section |');
  });

  it('lists updated data files by name', () => {
    const md = engine.renderStepSummaryMarkdown(engine.buildRunSummary({
      result: 'success', code: 'synced', changed: true,
      startedAt: 't0', finishedAt: 't1', detail: 'x', secrets: [],
      sections: [{ label: 'pages', stats: zeroStats(), navChanged: true, homeChanged: false, configChanged: true }],
    }));
    expect(md).toContain('**Data files updated:** nav.yml, _config.yml');
  });

  it('includes the detail line', () => {
    const md = engine.renderStepSummaryMarkdown(engine.buildRunSummary({
      result: 'failure', code: 'bulk_delete_guard', changed: false,
      startedAt: 't0', finishedAt: 't1', secrets: [],
      detail: 'bulk-delete guard tripped for pages: would delete 3 of 4 tracked (75%)',
    }));
    expect(md).toContain('bulk-delete guard tripped for pages: would delete 3 of 4 tracked (75%)');
  });

  it('never renders a secret value that made it past redact (defense in depth check)', () => {
    const md = engine.renderStepSummaryMarkdown(engine.buildRunSummary({
      result: 'failure', code: 'sync_error', changed: false,
      startedAt: 't0', finishedAt: 't1',
      detail: 'sync failed: db-secret-xyz not found',
      secrets: ['db-secret-xyz'],
    }));
    expect(md).not.toContain('db-secret-xyz');
    expect(md).toContain('[redacted]');
  });
});

// ─── writeActionOutputs: GITHUB_OUTPUT / GITHUB_STEP_SUMMARY emission ─────────

describe('writeActionOutputs (output emission)', () => {
  const tmpFiles = [];
  const originalGithubOutput = process.env.GITHUB_OUTPUT;
  const originalStepSummary  = process.env.GITHUB_STEP_SUMMARY;

  function makeFile(initial = '') {
    const dir  = mkdtempSync(path.join(tmpdir(), 'notiongit-outputs-'));
    const file = path.join(dir, 'out');
    writeFileSync(file, initial);
    tmpFiles.push(dir);
    return file;
  }

  const sampleSummary = () => engine.buildRunSummary({
    result: 'success', code: 'synced', changed: true,
    startedAt: '2026-09-02T12:00:00.000Z', finishedAt: '2026-09-02T12:00:03.000Z',
    detail: 'pages: 1 created', secrets: [],
  });

  it('appends changed and a heredoc-delimited compact-JSON summary to GITHUB_OUTPUT', () => {
    const file = makeFile();
    process.env.GITHUB_OUTPUT = file;
    delete process.env.GITHUB_STEP_SUMMARY;

    const summary = sampleSummary();
    engine.writeActionOutputs(summary);

    expect(readFileSync(file, 'utf8')).toBe(
      'changed=true\n' +
      'summary<<NOTIONGIT_SYNC_SUMMARY_EOF\n' +
      JSON.stringify(summary) + '\n' +
      'NOTIONGIT_SYNC_SUMMARY_EOF\n'
    );
  });

  it('emits summary as a single-line compact JSON payload matching the schema', () => {
    const file = makeFile();
    process.env.GITHUB_OUTPUT = file;
    delete process.env.GITHUB_STEP_SUMMARY;

    engine.writeActionOutputs(sampleSummary());

    const lines = readFileSync(file, 'utf8').split('\n');
    const jsonLine = lines[2];
    expect(() => JSON.parse(jsonLine)).not.toThrow();
    const parsed = JSON.parse(jsonLine);
    expect(parsed.schema_version).toBe(1);
    expect(parsed.result).toBe('success');
    expect(parsed.code).toBe('synced');
  });

  it('appends rather than overwrites, keeping earlier step outputs', () => {
    const file = makeFile('earlier=kept\n');
    process.env.GITHUB_OUTPUT = file;
    delete process.env.GITHUB_STEP_SUMMARY;

    engine.writeActionOutputs(engine.buildRunSummary({
      result: 'no_op', code: 'missing_credentials', changed: false,
      startedAt: 't0', finishedAt: 't0', detail: 'nothing to do', secrets: [],
    }));

    const content = readFileSync(file, 'utf8');
    expect(content.startsWith('earlier=kept\n')).toBe(true);
    expect(content).toContain('changed=false');
  });

  it('is a no-op GITHUB_OUTPUT/GITHUB_STEP_SUMMARY writer (but still logs) when both are unset', () => {
    delete process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_STEP_SUMMARY;
    expect(() => engine.writeActionOutputs(sampleSummary())).not.toThrow();
  });

  it('appends a Markdown rendering to GITHUB_STEP_SUMMARY when set', () => {
    delete process.env.GITHUB_OUTPUT;
    const stepFile = makeFile('# earlier step\n');
    process.env.GITHUB_STEP_SUMMARY = stepFile;

    engine.writeActionOutputs(sampleSummary());

    const content = readFileSync(stepFile, 'utf8');
    expect(content.startsWith('# earlier step\n')).toBe(true);
    expect(content).toContain('Notion → Jekyll sync');
    expect(content).toContain('synced');
  });

  it('never writes the Notion token into GITHUB_OUTPUT or GITHUB_STEP_SUMMARY', () => {
    const outFile  = makeFile();
    const stepFile = makeFile();
    process.env.GITHUB_OUTPUT = outFile;
    process.env.GITHUB_STEP_SUMMARY = stepFile;

    engine.writeActionOutputs(engine.buildRunSummary({
      result: 'failure', code: 'sync_error', changed: false,
      startedAt: 't0', finishedAt: 't1',
      detail: 'sync failed: token was rejected',
      secrets: ['secret-test-token'],
    }));

    expect(readFileSync(outFile, 'utf8')).not.toContain('secret-test-token');
    expect(readFileSync(stepFile, 'utf8')).not.toContain('secret-test-token');
  });

  it('restores the environment', () => {
    if (originalGithubOutput === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = originalGithubOutput;
    if (originalStepSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = originalStepSummary;

    for (const dir of tmpFiles) rmSync(dir, { recursive: true, force: true });
  });
});
