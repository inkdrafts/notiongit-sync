/**
 * Proves the committed dist/index.js bundle — the file action.yml actually
 * runs — works standalone: no repo node_modules on its module-resolution
 * path, and a real end-to-end sync against a fake Notion API. CI's
 * `bun run build && git diff --exit-code` already catches a stale bundle;
 * this catches a bundle that's in sync with the source but broken at
 * runtime (e.g. a bundler miscompile of the vendored @notionhq/client code).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const DIST_ENTRY = path.join(REPO_ROOT, 'dist', 'index.js');
const TOKEN = 'secret-test-token-never-print-me';
const PAGES_DB = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ABOUT_ID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
// A separate, mutable-results database for the bulk-delete-guard scenario
// below — kept apart from PAGES_DB so that scenario doesn't disturb the
// happy-path fixture above.
const GUARD_DB = 'cccccccc-3333-4333-8333-cccccccccccc';
const GUARD_ID = 'dddddddd-4444-4444-8444-dddddddddddd';

const titleProp = (t) => ({ title: [{ plain_text: t }] });
const textProp  = (t) => ({ rich_text: [{ plain_text: t }] });
const paragraph = (t) => ({
  id: 'block-1',
  type: 'paragraph',
  paragraph: { rich_text: [{ plain_text: t, annotations: {}, href: null }] },
});
const aboutRow = () => ({
  id: ABOUT_ID,
  object: 'page',
  properties: {
    Title: titleProp('About'),
    Slug: textProp('about'),
    Type: { select: { name: 'markdown' } },
    'Show in Nav': { checkbox: true },
    'Nav Order': { number: 1 },
  },
});
const guardRow = () => ({
  id: GUARD_ID,
  object: 'page',
  properties: {
    Title: titleProp('Guarded'),
    Slug: textProp('guarded'),
    Type: { select: { name: 'markdown' } },
  },
});
const guardState = { pages: [guardRow()] };

let server;
let isolatedDir; // an empty dir with no node_modules above it up to REPO_ROOT's parent
const tempDirs = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === `/v1/databases/${PAGES_DB}/query` && req.method === 'POST') {
        return Response.json({ object: 'list', results: [aboutRow()], has_more: false, next_cursor: null });
      }
      if (url.pathname === `/v1/databases/${GUARD_DB}/query` && req.method === 'POST') {
        return Response.json({ object: 'list', results: guardState.pages, has_more: false, next_cursor: null });
      }
      if (url.pathname === `/v1/blocks/${ABOUT_ID}/children` && req.method === 'GET') {
        return Response.json({
          object: 'list', results: [paragraph('About body paragraph.')], has_more: false, next_cursor: null,
        });
      }
      if (url.pathname === `/v1/blocks/${GUARD_ID}/children` && req.method === 'GET') {
        return Response.json({ object: 'list', results: [], has_more: false, next_cursor: null });
      }
      return new Response('dist smoke test: not found', { status: 404 });
    },
  });

  // Exercise a *copy* of dist/index.js from a directory tree with no
  // node_modules anywhere on its ancestor path — a symlink would still
  // resolve back through the repo's own node_modules via its real path — so
  // a dependency the bundler failed to inline surfaces as a module
  // resolution error here instead of being masked by this repo's checkout.
  isolatedDir = mkdtempSync(path.join(tmpdir(), 'notiongit-dist-'));
  tempDirs.push(isolatedDir);
  mkdirSync(path.join(isolatedDir, 'action'), { recursive: true });
  writeFileSync(path.join(isolatedDir, 'action', 'index.js'), readFileSync(DIST_ENTRY));
});

afterAll(() => {
  server.stop(true);
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Run the bundled dist/index.js copy as a real subprocess and collect its result. */
async function runDist(env) {
  const proc = Bun.spawn(['bun', path.join(isolatedDir, 'action', 'index.js')], {
    cwd: isolatedDir,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('dist/index.js (committed Action bundle)', () => {
  it('exists and is generated (not hand-written)', () => {
    expect(existsSync(DIST_ENTRY)).toBe(true);
  });

  it('runs a full sync with no node_modules on its resolution path', async () => {
    const siteDir = mkdtempSync(path.join(tmpdir(), 'notiongit-dist-site-'));
    tempDirs.push(siteDir);
    writeFileSync(path.join(siteDir, '_config.yml'), 'title: "Old Title"\nauthor:\n  name: "Old Name"\n');

    const outDir = mkdtempSync(path.join(tmpdir(), 'notiongit-dist-out-'));
    tempDirs.push(outDir);
    const outFile = path.join(outDir, 'github_output');
    writeFileSync(outFile, '');

    const { stdout, stderr, exitCode } = await runDist({
      NOTION_TOKEN: TOKEN,
      NOTION_PAGES_DATABASE_ID: PAGES_DB,
      NOTION_BASE_URL: `http://127.0.0.1:${server.port}`,
      SITE_ROOT: siteDir,
      GITHUB_OUTPUT: outFile,
    });

    expect(stderr).toBe('');
    expect(exitCode).toBe(0);

    const about = readFileSync(path.join(siteDir, '_pages', 'about.md'), 'utf8');
    expect(about).toContain('title: "About"');
    expect(about).toContain('About body paragraph.');

    const output = readFileSync(outFile, 'utf8');
    expect(output).toContain('changed=true');
    expect(stdout).toContain('Sync complete.');

    // The run summary (schema_version 1) survives bundling — parseable JSON
    // on the `summary` line, matching the shape docs/run-summary-schema.md
    // documents and test/run-summary-schema.test.js validates in isolation.
    const summaryLine = output.split('\n')[2];
    const summary = JSON.parse(summaryLine);
    expect(summary).toMatchObject({ schema_version: 1, result: 'success', code: 'synced', changed: true });
  });

  it('reports code=bulk_delete_guard (not sync_error) when bundled — proves the GuardError instanceof check survives minification', async () => {
    // GuardError is distinguished from a generic sync error purely by
    // `instanceof` (scripts/sync-notion.js's main()). A bundler that renamed
    // or duplicated the class across module scopes would break that check
    // silently in the bundle without failing any source-run test — this is
    // exactly the class of bug test/dist.test.js exists to catch.
    const guardSite = mkdtempSync(path.join(tmpdir(), 'notiongit-dist-guard-site-'));
    tempDirs.push(guardSite);

    const seedOutDir = mkdtempSync(path.join(tmpdir(), 'notiongit-dist-guard-out-'));
    tempDirs.push(seedOutDir);
    const seedOutFile = path.join(seedOutDir, 'github_output');
    writeFileSync(seedOutFile, '');

    const guardEnv = {
      NOTION_TOKEN: TOKEN,
      NOTION_PAGES_DATABASE_ID: GUARD_DB,
      NOTION_BASE_URL: `http://127.0.0.1:${server.port}`,
      SITE_ROOT: guardSite,
    };

    // Seed one tracked page, then make Notion report zero published rows —
    // the "every tracked file looks unpublished" guard trip.
    const seed = await runDist({ ...guardEnv, GITHUB_OUTPUT: seedOutFile });
    expect(seed.exitCode).toBe(0);
    expect(existsSync(path.join(guardSite, '_pages', 'guarded.md'))).toBe(true);

    guardState.pages = [];
    const guardOutDir = mkdtempSync(path.join(tmpdir(), 'notiongit-dist-guard-out2-'));
    tempDirs.push(guardOutDir);
    const guardOutFile = path.join(guardOutDir, 'github_output');
    writeFileSync(guardOutFile, '');

    const { stderr, exitCode } = await runDist({ ...guardEnv, GITHUB_OUTPUT: guardOutFile });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('bulk-delete guard');
    expect(existsSync(path.join(guardSite, '_pages', 'guarded.md'))).toBe(true); // untouched

    const outputLines = readFileSync(guardOutFile, 'utf8').split('\n');
    const summary = JSON.parse(outputLines[2]);
    expect(summary.result).toBe('failure');
    expect(summary.code).toBe('bulk_delete_guard');

    guardState.pages = [guardRow()]; // restore for any later run
  });
});
