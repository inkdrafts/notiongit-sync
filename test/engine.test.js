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
    const before = { ...process.env };
    delete process.env.NOTION_TOKEN;
    delete process.env.NOTION_PAGES_DATABASE_ID;
    delete process.env.NOTION_POSTS_DATABASE_ID;

    engine.resolveConfig({ NOTION_TOKEN: 't', NOTION_PAGES_DATABASE_ID: 'db' });

    expect(process.env).toEqual(before);
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

// ─── writeActionOutputs: GITHUB_OUTPUT emission ───────────────────────────────

describe('writeActionOutputs (output emission)', () => {
  const tmpFiles = [];
  const originalGithubOutput = process.env.GITHUB_OUTPUT;

  function makeOutputFile(initial = '') {
    const dir  = mkdtempSync(path.join(tmpdir(), 'notiongit-outputs-'));
    const file = path.join(dir, 'github_output');
    writeFileSync(file, initial);
    tmpFiles.push(dir);
    return file;
  }

  it('appends changed and a heredoc-delimited summary to GITHUB_OUTPUT', () => {
    const file = makeOutputFile();
    process.env.GITHUB_OUTPUT = file;

    engine.writeActionOutputs({ changed: true, summary: 'pages: 1 created' });

    expect(readFileSync(file, 'utf8')).toBe(
      'changed=true\n' +
      'summary<<NOTIONGIT_SYNC_SUMMARY_EOF\n' +
      'pages: 1 created\n' +
      'NOTIONGIT_SYNC_SUMMARY_EOF\n'
    );
  });

  it('appends rather than overwrites, keeping earlier step outputs', () => {
    const file = makeOutputFile('earlier=kept\n');
    process.env.GITHUB_OUTPUT = file;

    engine.writeActionOutputs({ changed: false, summary: 'nothing to do' });

    const content = readFileSync(file, 'utf8');
    expect(content.startsWith('earlier=kept\n')).toBe(true);
    expect(content).toContain('changed=false');
  });

  it('keeps multi-line summaries inside the heredoc block', () => {
    const file = makeOutputFile();
    process.env.GITHUB_OUTPUT = file;

    engine.writeActionOutputs({ changed: false, summary: 'line one\nline two' });

    expect(readFileSync(file, 'utf8')).toBe(
      'changed=false\n' +
      'summary<<NOTIONGIT_SYNC_SUMMARY_EOF\n' +
      'line one\nline two\n' +
      'NOTIONGIT_SYNC_SUMMARY_EOF\n'
    );
  });

  it('is a no-op writer (but still logs) when GITHUB_OUTPUT is unset', () => {
    delete process.env.GITHUB_OUTPUT;
    expect(() => engine.writeActionOutputs({ changed: false, summary: 'x' })).not.toThrow();
  });

  it('never writes the Notion token into outputs', () => {
    const file = makeOutputFile();
    process.env.GITHUB_OUTPUT = file;

    engine.writeActionOutputs({ changed: true, summary: 'pages: 1 created' });

    expect(readFileSync(file, 'utf8')).not.toContain('secret');
  });

  it('restores the environment', () => {
    if (originalGithubOutput === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = originalGithubOutput;

    for (const dir of tmpFiles) rmSync(dir, { recursive: true, force: true });
  });
});
