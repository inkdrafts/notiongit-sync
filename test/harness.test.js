/**
 * Local Action harness: proves the full input → engine → output contract
 * without touching the real Notion API.
 *
 * A fake Notion server (Bun.serve on an ephemeral port) serves the two
 * endpoints the engine uses — POST /v1/databases/{id}/query and
 * GET /v1/blocks/{id}/children — from synthetic fixtures. The engine is run as
 * a real subprocess (`bun scripts/sync-notion.js`) with exactly the environment
 * the action.yml step would set, pointed at a throwaway Jekyll site via
 * SITE_ROOT and at the fake API via NOTION_BASE_URL (a test-only hook).
 *
 * All fixtures are synthetic (hex-UUID ids, placeholder text) — nothing here
 * comes from a real workspace.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { schema, validateAgainstSchema } = require('./support/run-summary-validator.js');

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const TOKEN = 'secret-test-token-never-print-me';

// Synthetic IDs — hex-only so they match the engine's notion_id regex.
const PAGES_DB = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const POSTS_DB = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const LEGACY_POSTS_DB = 'cccccccc-3333-4333-8333-cccccccccccc';
// Queried by the "API failure" scenario below: the fake server answers this
// id with a real Notion-shaped error response instead of a result list.
const FAILING_DB = '99999999-9999-4999-8999-999999999999';
// Queried by the "row errors" scenario below: the fake server answers this
// page's block children with a real Notion-shaped error instead of a body,
// while every other row syncs — the per-row failure behind code=row_errors.
const ERRORING_PAGE_ID = '70707070-7070-4707-8707-707070707070';
const HOME_ID  = 'dddddddd-4444-4444-8444-dddddddddddd';
const ABOUT_ID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const POST_ID  = 'ffffffff-6666-4666-8666-ffffffffffff';
const PAGINATED_ID = '99999999-1111-4111-8111-999999999999';

// ─── Fake Notion fixtures ─────────────────────────────────────────────────────

const titleProp  = (t) => ({ title: [{ plain_text: t }] });
const textProp   = (t) => ({ rich_text: [{ plain_text: t }] });
const paragraph  = (t) => ({
  id: '12345678-90ab-4cdef-890-abcdef123456'.slice(0, 36),
  type: 'paragraph',
  paragraph: { rich_text: [{ plain_text: t, annotations: {}, href: null }] },
});
const row = (id, properties) => ({ id, object: 'page', properties });

const homeRow = () =>
  row(HOME_ID, {
    Title: titleProp('Home'),
    Type: { select: { name: 'home' } },
    'Show in Nav': { checkbox: true },
    'Nav Order': { number: 1 },
    Name: textProp('Test Author'),
    Tagline: textProp('Test tagline'),
    'Profile Picture': textProp('https://example.com/pic.png'),
    'Social Links': textProp('GitHub: https://github.com/example'),
  });

const aboutRow = (slug = 'about') =>
  row(ABOUT_ID, {
    Title: titleProp('About'),
    Slug: textProp(slug),
    Type: { select: { name: 'markdown' } },
    'Show in Nav': { checkbox: true },
    'Nav Order': { number: 2 },
  });

const paginatedRow = (slug = 'paginated') =>
  row(PAGINATED_ID, {
    Title: titleProp('Paginated'),
    Slug: textProp(slug),
    Type: { select: { name: 'markdown' } },
  });

const postRow = () =>
  row(POST_ID, {
    Title: titleProp('Hello World'),
    Slug: textProp('hello-world'),
    'Publish Date': { date: { start: '2026-01-15' } },
    Tags: { multi_select: [{ name: 'testing' }] },
  });

// Mutable server state — scenarios adjust it between runs.
const state = {
  pages: [],
  posts: [],
  blocks: {
    [HOME_ID]:  [paragraph('Home bio paragraph.')],
    [ABOUT_ID]: [paragraph('About body paragraph.')],
    [POST_ID]:  [paragraph('Post body paragraph.')],
  },
};

function resetFixtures() {
  state.pages = [homeRow(), aboutRow()];
  state.posts = [postRow()];
  state.blocks[ABOUT_ID] = [paragraph('About body paragraph.')];
}

// ─── Fake Notion server ───────────────────────────────────────────────────────

// Deliberately small: forces the fake server to answer every multi-row/
// multi-block fixture across several has_more:true pages instead of ever
// returning everything in one response, exercising fetchPublished's and
// fetchAllBlocks's start_cursor loop the way the real Notion API would for
// any database or block list past a handful of rows. Transparent to every
// existing scenario below — fetchPublished/fetchAllBlocks aggregate all pages
// before returning, so the final result is identical regardless of page size.
const PAGE_SIZE = 1;

/** Slice `items` into one Notion-shaped paginated response. */
function paginate(items, cursor) {
  const start = cursor ? Number(cursor) : 0;
  const end   = Math.min(start + PAGE_SIZE, items.length);
  return {
    results:     items.slice(start, end),
    has_more:    end < items.length,
    next_cursor: end < items.length ? String(end) : null,
  };
}

let server;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);

      const dbQuery = url.pathname.match(/^\/v1\/databases\/([^/]+)\/query$/);
      if (dbQuery && req.method === 'POST') {
        if (dbQuery[1] === FAILING_DB) {
          // Shaped like a real Notion API error: @notionhq/client surfaces
          // `message` verbatim on the thrown APIResponseError, and Notion's
          // real "not found" message echoes the database ID back — exactly
          // the kind of text the run summary's redaction has to catch.
          return Response.json({
            object: 'error',
            status: 404,
            code: 'object_not_found',
            message: `Could not find database with ID: ${FAILING_DB}. Make sure the relevant pages and databases are shared with your integration.`,
          }, { status: 404 });
        }
        const rows = dbQuery[1] === PAGES_DB ? state.pages
                   : dbQuery[1] === POSTS_DB || dbQuery[1] === LEGACY_POSTS_DB ? state.posts
                   : [];
        const body = await req.json().catch(() => ({}));
        const page = paginate(rows, body.start_cursor);
        return Response.json({ object: 'list', ...page });
      }

      const blockChildren = url.pathname.match(/^\/v1\/blocks\/([^/]+)\/children$/);
      if (blockChildren && req.method === 'GET') {
        if (blockChildren[1] === ERRORING_PAGE_ID) {
          // Shaped like a real Notion API error the same way FAILING_DB is:
          // the engine's per-row catch must turn it into counts in the run
          // summary, never echo this message (which names the id).
          return Response.json({
            object: 'error',
            status: 404,
            code: 'object_not_found',
            message: `Could not find block with ID: ${ERRORING_PAGE_ID}. Make sure the relevant pages and databases are shared with your integration.`,
          }, { status: 404 });
        }
        const items = state.blocks[blockChildren[1]] ?? [];
        const page  = paginate(items, url.searchParams.get('start_cursor'));
        return Response.json({ object: 'list', ...page });
      }

      return new Response('harness: not found', { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop(true);
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// ─── Harness helpers ──────────────────────────────────────────────────────────

const tempDirs = [];

function makeSite() {
  const dir = mkdtempSync(path.join(tmpdir(), 'notiongit-site-'));
  tempDirs.push(dir);
  writeFileSync(
    path.join(dir, '_config.yml'),
    'title: "Old Title"\nauthor:\n  name: "Old Name"\nurl: https://example.github.io\n# keep my comments\n'
  );
  return dir;
}

function makeOutputFile() {
  const dir = mkdtempSync(path.join(tmpdir(), 'notiongit-out-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'github_output');
  writeFileSync(file, '');
  return file;
}

function makeSummaryFile() {
  const dir = mkdtempSync(path.join(tmpdir(), 'notiongit-summary-'));
  tempDirs.push(dir);
  return path.join(dir, 'run-summary.json');
}

async function runEngine(env) {
  const proc = Bun.spawn(['bun', 'scripts/sync-notion.js'], {
    cwd: REPO_ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function baseEnv(siteRoot, overrides = {}) {
  return {
    NOTION_TOKEN: TOKEN,
    NOTION_PAGES_DATABASE_ID: PAGES_DB,
    NOTION_POSTS_DATABASE_ID: POSTS_DB,
    NOTION_BASE_URL: `http://127.0.0.1:${server.port}`,
    SITE_ROOT: siteRoot,
    RUN_SUMMARY_FILE: makeSummaryFile(),
    ...overrides,
  };
}

/** Parse a $GITHUB_OUTPUT file the way the runner does (simple + heredoc). */
function parseGithubOutput(text) {
  const lines = text.split('\n');
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const simple = lines[i].match(/^(\w+)=(.*)$/);
    if (simple) {
      out[simple[1]] = simple[2];
      continue;
    }
    const heredoc = lines[i].match(/^(\w+)<<(.+)$/);
    if (heredoc) {
      const value = [];
      for (let j = i + 1; j < lines.length && lines[j] !== heredoc[2]; j++) value.push(lines[j]);
      out[heredoc[1]] = value.join('\n');
    }
  }
  return out;
}

const outputsOf = async (env, file) => {
  // A fresh artifact path per call: the shared `env` below is reused across
  // scenarios, and each one's file assertions must read its own run.
  const summaryFile = makeSummaryFile();
  const result = await runEngine({ ...env, GITHUB_OUTPUT: file, RUN_SUMMARY_FILE: summaryFile });
  return { result, outputs: parseGithubOutput(readFileSync(file, 'utf8')), summaryFile };
};

function readRunSummaryArtifact(file, expectedCode) {
  expect(existsSync(file)).toBe(true);
  const summary = JSON.parse(readFileSync(file, 'utf8'));
  expect(() => validateAgainstSchema(schema, summary, schema.$defs)).not.toThrow();
  expect(summary.code).toBe(expectedCode);
  return summary;
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

// Scenarios below share one `site` checkout and run in file order (Bun runs a
// describe block's tests in declaration order, not in parallel or shuffled).
// This is deliberate: the engine's whole behavior is incremental — create,
// then re-sync unchanged, then edit, then rename, then delete — so each
// scenario's expectations depend on the site state the previous one left on
// disk, exactly as consecutive scheduled runs of the real Action would. A
// scenario that needs an independent site (the bulk-delete-ratio and legacy
// fallback scenarios) makes its own via makeSite().
describe('local Action harness (fake Notion API + engine subprocess)', () => {
  let site;
  let outFile;
  let env;

  beforeAll(() => {
    resetFixtures();
    site = makeSite();
    outFile = makeOutputFile();
    env = baseEnv(site);
  });

  it('exits cleanly as a no-op — not a failure — when credentials are absent or blank, before any I/O', async () => {
    const cases = [
      ['absent token', { NOTION_TOKEN: '' }, 'NOTION_TOKEN'],
      ['whitespace-only token', { NOTION_TOKEN: '   ' }, 'NOTION_TOKEN'],
      ['absent database ids', { NOTION_PAGES_DATABASE_ID: '', NOTION_POSTS_DATABASE_ID: '' }, 'DATABASE_ID'],
      ['whitespace-only database ids', { NOTION_PAGES_DATABASE_ID: ' ', NOTION_POSTS_DATABASE_ID: '\t\n' }, 'DATABASE_ID'],
    ];

    for (const [, overrides, expectedMention] of cases) {
      const caseOutFile = makeOutputFile();
      const { result, outputs, summaryFile } = await outputsOf(baseEnv(site, overrides), caseOutFile);

      // A no-op is not an error: exit 0, no stderr, no scary log lines.
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(outputs.changed).toBe('false');
      expect(outputs.summary).toContain(expectedMention);

      // No filesystem changes — the credential check runs before any I/O.
      expect(existsSync(path.join(site, '_pages'))).toBe(false);
      expect(existsSync(path.join(site, '_posts'))).toBe(false);
      expect(existsSync(path.join(site, '_data'))).toBe(false);

      // Never reveals a secret value, only names the missing key.
      expect(result.stdout + outputs.summary).not.toContain(TOKEN);

      expect(readRunSummaryArtifact(summaryFile, 'missing_credentials'))
        .toEqual(JSON.parse(outputs.summary));
    }
  });

  it('the no-op path also exits 0 without GITHUB_OUTPUT set (a plain local run)', async () => {
    const localEnv = baseEnv(site, { NOTION_TOKEN: '' });
    const result = await runEngine(localEnv);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Notion sync skipped');
    expect(result.stdout).toContain('NOTION_TOKEN');
    expect(existsSync(path.join(site, '_pages'))).toBe(false);
    readRunSummaryArtifact(localEnv.RUN_SUMMARY_FILE, 'missing_credentials');
  });

  it('first sync writes the site and reports changed=true', async () => {
    const { result, outputs, summaryFile } = await outputsOf(env, outFile);
    expect(result.exitCode).toBe(0);

    // Pages: about.md with front matter, body and notion_id.
    const about = readFileSync(path.join(site, '_pages', 'about.md'), 'utf8');
    expect(about).toContain('title: "About"');
    expect(about).toContain('slug: about');
    expect(about).toContain(`notion_id: "${ABOUT_ID}"`);
    expect(about).toContain('About body paragraph.');

    // Posts: dated filename with layout: post.
    const post = readFileSync(path.join(site, '_posts', '2026-01-15-hello-world.md'), 'utf8');
    expect(post).toContain('layout: post');
    expect(post).toContain('title: "Hello World"');
    expect(post).toContain('Post body paragraph.');

    // Data files.
    const nav = readFileSync(path.join(site, '_data', 'nav.yml'), 'utf8');
    expect(nav).toContain('title: "Home"');
    expect(nav).toContain('url: "/"');
    expect(nav).toContain('url: "/about"');
    const home = readFileSync(path.join(site, '_data', 'home.yml'), 'utf8');
    expect(home).toContain('name: "Test Author"');
    expect(home).toContain('bio: |');
    expect(home).toContain('Home bio paragraph.');

    // _config.yml: only the managed identity lines change; comments survive.
    const config = readFileSync(path.join(site, '_config.yml'), 'utf8');
    expect(config).toContain('title: "Test Author"');
    expect(config).toContain('name: "Test Author"');
    expect(config).toContain('# keep my comments');
    expect(config).toContain('url: https://example.github.io');

    // Outputs: changed=true, non-secret summary.
    expect(outputs.changed).toBe('true');
    expect(outputs.summary).toContain('pages: 1 created');
    expect(outputs.summary).toContain('posts: 1 created');
    expect(outputs.summary).toContain('nav.yml');

    // Credentials never reach outputs or logs.
    const outFileText = readFileSync(outFile, 'utf8');
    expect(outFileText).not.toContain(TOKEN);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);

    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));
  });

  it('re-sync with unchanged content reports changed=false', async () => {
    const { result, outputs, summaryFile } = await outputsOf(env, outFile);
    expect(result.exitCode).toBe(0);
    expect(outputs.changed).toBe('false');
    expect(outputs.summary).toContain('unchanged');
    expect(outputs.summary).not.toMatch(/[1-9]\d* (created|updated|renamed|deleted)/);
    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));
  });

  it('content edits in Notion flip changed back to true', async () => {
    state.blocks[ABOUT_ID] = [paragraph('Edited body paragraph.')];

    const { result, outputs, summaryFile } = await outputsOf(env, outFile);
    expect(result.exitCode).toBe(0);
    expect(outputs.changed).toBe('true');
    expect(outputs.summary).toContain('1 updated');
    expect(readFileSync(path.join(site, '_pages', 'about.md'), 'utf8'))
      .toContain('Edited body paragraph.');
    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));
  });

  it('slug renames move the file, report a rename, and are not also double-counted as updated', async () => {
    state.pages = [homeRow(), aboutRow('about-renamed')];

    const { result, outputs, summaryFile } = await outputsOf(env, outFile);
    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(site, '_pages', 'about.md'))).toBe(false);
    expect(existsSync(path.join(site, '_pages', 'about-renamed.md'))).toBe(true);
    expect(outputs.changed).toBe('true');
    expect(outputs.summary).toContain('1 renamed');
    // A rename is one change, not two: it must not also count as "updated".
    expect(outputs.summary).toContain('0 updated');
    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));
  });

  it('bulk-delete guard aborts on zero published rows, deletes nothing, but still emits a failure run summary', async () => {
    state.pages = []; // "misread": every tracked page looks unpublished
    const aboutPath = path.join(site, '_pages', 'about-renamed.md');
    const before = readFileSync(aboutPath, 'utf8');
    const guardOutFile  = makeOutputFile();
    const stepSummaryFile = makeOutputFile();

    const result = await runEngine({ ...env, GITHUB_OUTPUT: guardOutFile, GITHUB_STEP_SUMMARY: stepSummaryFile });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ABORT');
    expect(result.stderr).toContain('bulk-delete guard');
    expect(readFileSync(aboutPath, 'utf8')).toBe(before); // untouched

    // The run didn't finish a section, so pages/posts/data_files are the
    // documented null fallback — but every terminal path still emits a
    // parseable summary, not empty output.
    const outputs = parseGithubOutput(readFileSync(guardOutFile, 'utf8'));
    expect(outputs.changed).toBe('false');
    const summary = JSON.parse(outputs.summary);
    expect(summary.schema_version).toBe(1);
    expect(summary.result).toBe('failure');
    expect(summary.code).toBe('bulk_delete_guard');
    expect(summary.pages).toBeNull();
    expect(summary.posts).toBeNull();
    expect(summary.data_files).toBeNull();
    expect(summary.detail).not.toContain('about-renamed'); // no filenames — counts only
    expect(summary.detail).toContain('pages');

    const stepSummary = readFileSync(stepSummaryFile, 'utf8');
    expect(stepSummary).toContain('bulk_delete_guard');
    expect(stepSummary).not.toContain('about-renamed');

    // exit 1, yet the artifact round-trips: it was written before process.exit.
    expect(readRunSummaryArtifact(env.RUN_SUMMARY_FILE, 'bulk_delete_guard')).toEqual(summary);
  });

  it('bulk-delete guard also aborts on a ratio breach with multiple published rows (not just zero)', async () => {
    // Track four pages, then have Notion report only one published: 3 of 4
    // stale (75%) exceeds MAX_DELETE_RATIO's 0.5 default, with processedIds
    // non-empty — the ratio branch of the guard, distinct from the
    // zero-published-rows branch covered above.
    const ratioSite = makeSite();
    const seedEnv = baseEnv(ratioSite);

    // Ids must match the engine's notion_id extraction regex ([a-f0-9-]{36}),
    // so these stay hex — plain slugs like "extra-a" would not round-trip.
    const extraPages = [
      { id: '11111111-1111-4111-8111-111111111111', slug: 'extra-a' },
      { id: '22222222-1111-4111-8111-111111111111', slug: 'extra-b' },
      { id: '33333333-1111-4111-8111-111111111111', slug: 'extra-c' },
    ];
    state.pages = [homeRow(), aboutRow(), ...extraPages.map(({ id, slug }) =>
      row(id, {
        Title: titleProp(slug),
        Slug: textProp(slug),
        Type: { select: { name: 'markdown' } },
      })
    )];
    const seed = await runEngine(seedEnv);
    expect(seed.exitCode).toBe(0);
    for (const { slug } of extraPages) {
      expect(existsSync(path.join(ratioSite, '_pages', `${slug}.md`))).toBe(true);
    }

    state.pages = [aboutRow()]; // only 1 of 4 tracked pages still published
    const ratioOutFile = makeOutputFile();
    const result = await runEngine({ ...seedEnv, GITHUB_OUTPUT: ratioOutFile });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ABORT');
    expect(result.stderr).toContain('bulk-delete guard');
    expect(result.stderr).toContain('75%');
    for (const { slug } of extraPages) {
      expect(existsSync(path.join(ratioSite, '_pages', `${slug}.md`))).toBe(true); // untouched
    }

    const outputs = parseGithubOutput(readFileSync(ratioOutFile, 'utf8'));
    expect(outputs.changed).toBe('false');
    const summary = JSON.parse(outputs.summary);
    expect(summary.result).toBe('failure');
    expect(summary.code).toBe('bulk_delete_guard');
    expect(summary.detail).toContain('75%');
    expect(summary.detail).not.toContain('extra-a'); // no filenames — counts only
    expect(readRunSummaryArtifact(seedEnv.RUN_SUMMARY_FILE, 'bulk_delete_guard')).toEqual(summary);

    state.pages = [homeRow(), aboutRow()]; // restore shared fixture state
  });

  it('a Notion API failure aborts the run and reports code=sync_error with the database ID redacted', async () => {
    const failSite = makeSite();
    const failOutFile = makeOutputFile();
    const failStepSummaryFile = makeOutputFile();

    const failEnv = {
      ...baseEnv(failSite, { NOTION_PAGES_DATABASE_ID: FAILING_DB, NOTION_POSTS_DATABASE_ID: '' }),
      GITHUB_OUTPUT: failOutFile,
      GITHUB_STEP_SUMMARY: failStepSummaryFile,
    };
    const result = await runEngine(failEnv);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Fatal');
    // The query fails before any page is written — _pages/ may exist (it's
    // created up front) but stays empty.
    expect(existsSync(path.join(failSite, '_pages', 'about.md'))).toBe(false);

    const outputs = parseGithubOutput(readFileSync(failOutFile, 'utf8'));
    expect(outputs.changed).toBe('false');
    const summary = JSON.parse(outputs.summary);
    expect(summary.result).toBe('failure');
    expect(summary.code).toBe('sync_error');
    expect(summary.pages).toBeNull();
    expect(summary.detail).toContain('[redacted]');
    expect(summary.detail).not.toContain(FAILING_DB);

    const stepSummaryText = readFileSync(failStepSummaryFile, 'utf8');
    expect(stepSummaryText).not.toContain(FAILING_DB);
    expect(stepSummaryText).toContain('[redacted]');

    // exit 1, yet the artifact round-trips: it was written before process.exit.
    expect(readRunSummaryArtifact(failEnv.RUN_SUMMARY_FILE, 'sync_error')).toEqual(summary);
  });

  it('a single failing row reports code=row_errors while the rest of the sync lands', async () => {
    const rowErrorSite = makeSite();

    const erroringRow = row(ERRORING_PAGE_ID, {
      Title: titleProp('Erroring'),
      Slug: textProp('erroring'),
      Type: { select: { name: 'markdown' } },
    });
    state.pages = [homeRow(), aboutRow(), erroringRow];

    const { result, outputs, summaryFile } = await outputsOf(baseEnv(rowErrorSite), makeOutputFile());

    expect(result.exitCode).toBe(1);
    expect(outputs.changed).toBe('true');
    const summary = readRunSummaryArtifact(summaryFile, 'row_errors');
    expect(summary.result).toBe('failure');
    expect(summary.changed).toBe(true);
    expect(summary.pages.errors).toBe(1);
    expect(summary.pages.created).toBe(1); // about.md landed before the failing row
    expect(summary.posts).not.toBeNull(); // the posts section still ran to completion
    expect(existsSync(path.join(rowErrorSite, '_pages', 'about.md'))).toBe(true);
    expect(existsSync(path.join(rowErrorSite, '_pages', 'erroring.md'))).toBe(false);
    // detail carries counts only — never the failed row's id or error text.
    expect(outputs.summary).not.toContain(ERRORING_PAGE_ID);
    expect(summary).toEqual(JSON.parse(outputs.summary));

    state.pages = [homeRow(), aboutRow()]; // restore shared fixture state
  });

  it('allow_bulk_delete=true (any case) pushes the deletion through', async () => {
    state.pages = []; // same mass unpublish as the previous scenario

    const { result, outputs, summaryFile } = await outputsOf(
      { ...env, ALLOW_BULK_DELETE: 'True' },
      makeOutputFile()
    );
    expect(result.exitCode).toBe(0);
    expect(existsSync(path.join(site, '_pages', 'about-renamed.md'))).toBe(false);
    expect(outputs.changed).toBe('true');
    expect(outputs.summary).toContain('1 deleted');
    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));
  });

  it('honors the legacy posts-only fallback (NOTION_DATABASE_ID)', async () => {
    const legacySite = makeSite();
    const legacyOut  = makeOutputFile();

    const { result, outputs, summaryFile } = await outputsOf(
      baseEnv(legacySite, {
        NOTION_PAGES_DATABASE_ID: '',
        NOTION_POSTS_DATABASE_ID: '',
        NOTION_DATABASE_ID: LEGACY_POSTS_DB,
      }),
      legacyOut
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Skipping pages sync');
    expect(existsSync(path.join(legacySite, '_posts', '2026-01-15-hello-world.md'))).toBe(true);
    expect(existsSync(path.join(legacySite, '_pages'))).toBe(false);
    expect(outputs.changed).toBe('true');
    expect(outputs.summary).toContain('posts: 1 created');
    expect(outputs.summary).not.toContain('pages:');
    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));
  });

  it('follows Notion pagination (has_more/next_cursor) across multiple pages of both database rows and block children', async () => {
    // The fake server answers one row/block per response (PAGE_SIZE = 1
    // above), so this scenario only comes out complete if fetchPublished and
    // fetchAllBlocks correctly follow start_cursor across several pages
    // rather than trusting the first response.
    const pagSite = makeSite();
    const pagOut  = makeOutputFile();

    state.pages = [aboutRow(), paginatedRow()]; // 2 published rows → 2 query pages
    state.blocks[PAGINATED_ID] = [
      paragraph('Block one.'),
      paragraph('Block two.'),
      paragraph('Block three.'),
    ]; // 3 blocks → 3 block-children pages

    const { result, outputs, summaryFile } = await outputsOf(baseEnv(pagSite), pagOut);
    expect(result.exitCode).toBe(0);

    expect(existsSync(path.join(pagSite, '_pages', 'about.md'))).toBe(true);
    const paginated = readFileSync(path.join(pagSite, '_pages', 'paginated.md'), 'utf8');
    expect(paginated).toContain('Block one.\n\nBlock two.\n\nBlock three.');

    expect(outputs.summary).toContain('pages: 2 created');
    expect(readRunSummaryArtifact(summaryFile, 'synced')).toEqual(JSON.parse(outputs.summary));

    state.pages = [homeRow(), aboutRow()]; // restore shared fixture state
    delete state.blocks[PAGINATED_ID];
  });

  it('runs the engine the way local development always has (no GITHUB_OUTPUT)', async () => {
    resetFixtures();
    const localSite = makeSite();

    const localEnv = baseEnv(localSite);
    const result = await runEngine(localEnv);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Sync complete.');
    expect(result.stdout).toContain('changed: true');
    expect(existsSync(path.join(localSite, '_pages', 'about.md'))).toBe(true);
    readRunSummaryArtifact(localEnv.RUN_SUMMARY_FILE, 'synced');
  });
});
