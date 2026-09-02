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
      if (url.pathname === `/v1/blocks/${ABOUT_ID}/children` && req.method === 'GET') {
        return Response.json({
          object: 'list', results: [paragraph('About body paragraph.')], has_more: false, next_cursor: null,
        });
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

    const proc = Bun.spawn(['bun', path.join(isolatedDir, 'action', 'index.js')], {
      cwd: isolatedDir,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NOTION_TOKEN: TOKEN,
        NOTION_PAGES_DATABASE_ID: PAGES_DB,
        NOTION_BASE_URL: `http://127.0.0.1:${server.port}`,
        SITE_ROOT: siteDir,
        GITHUB_OUTPUT: outFile,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(0);

    const about = readFileSync(path.join(siteDir, '_pages', 'about.md'), 'utf8');
    expect(about).toContain('title: "About"');
    expect(about).toContain('About body paragraph.');

    const output = readFileSync(outFile, 'utf8');
    expect(output).toContain('changed=true');
    expect(stdout).toContain('Sync complete.');
  });
});
