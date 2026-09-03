/**
 * Contract tests for the network contract documented in SECURITY.md — where
 * the Action's outbound network can go, and what third-party code ships to
 * consumer runners. Every allowlist here mirrors a claim in SECURITY.md; when
 * one of these tests fails, update SECURITY.md and the allowlist together in
 * the same change (see "Maintainers' checklist" there), never one alone.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const read = (...segments) => readFileSync(path.join(REPO_ROOT, ...segments), 'utf8');

/**
 * Hosts allowed in URL literals across the shipped bundle and the engine
 * source. `developers.notion.com` and `github.com` are inert `@notionhq/client`
 * package-metadata strings (homepage/repository links) embedded verbatim by
 * the bundler — the code never dereferences them. Anything else is an
 * undeclared endpoint.
 */
const BUNDLE_HOST_ALLOWLIST = new Set(['api.notion.com', 'developers.notion.com', 'github.com']);

/** The one endpoint the engine actually contacts. */
const NOTION_API_HOST = 'api.notion.com';

/** Modules the engine source may require — the client, plus stdlib file/path. */
const ENGINE_REQUIRE_ALLOWLIST = new Set(['@notionhq/client', 'fs', 'path']);

/** Third-party actions/workflows allowed in action.yml and our own workflows. */
const ACTIONS_USES_ALLOWLIST = new Set([
  'inkdrafts/notiongit-sync@v1', // self-reference in action.yml's usage example comment
  'oven-sh/setup-bun@v2', // downloads the Bun runtime from bun.sh — SECURITY.md destinations table
  'actions/checkout@v4', // consumer-side standard; also used in this repo's own workflows
  './.github/workflows/ci.yml', // local reusable workflow call in release.yml — no network of its own
]);

/** URL literals with a plausible host (won't match the `https://...` doc placeholder). */
function urlHosts(text) {
  return [...text.matchAll(/https?:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*/g)].map((m) => m[0].split('//')[1]);
}

function requireTargets(text) {
  return [...text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
}

function usesTargets(text) {
  return [...text.matchAll(/uses:\s*['"]?([^\s'"]+)/g)].map((m) => m[1]);
}

describe('network contract: dist bundle', () => {
  const bundle = read('dist', 'index.js');

  it('contains URL literals for allowlisted hosts only', () => {
    const hosts = urlHosts(bundle);
    for (const host of hosts) {
      expect(BUNDLE_HOST_ALLOWLIST.has(host)).toBe(true);
    }
  });

  it('contacts the Notion API and nothing else', () => {
    // The endpoint must actually be present (the client's default prefix URL);
    // combined with the allowlist above, this pins the full host set exactly.
    expect(new Set(urlHosts(bundle))).toEqual(new Set([NOTION_API_HOST, 'developers.notion.com', 'github.com']));
  });

  it('embeds only @notionhq/client third-party code', () => {
    const embedded = [...bundle.matchAll(/\/\/ (node_modules\/[^ "]+)/g)].map((m) => m[1]);
    expect(embedded.length).toBeGreaterThan(0);
    for (const module of embedded) {
      expect(module.startsWith('node_modules/@notionhq/client/')).toBe(true);
    }
  });

  it('never mentions InkDrafts, telemetry, or analytics', () => {
    for (const needle of ['inkdrafts', 'analytics', 'telemetry']) {
      expect(bundle.toLowerCase().includes(needle)).toBe(false);
    }
  });
});

describe('network contract: engine source', () => {
  const source = read('scripts', 'sync-notion.js');

  it('requires only the Notion client and stdlib fs/path', () => {
    expect(new Set(requireTargets(source))).toEqual(ENGINE_REQUIRE_ALLOWLIST);
  });

  it('has no direct network-client imports or fetch call sites', () => {
    const networkModules = ['http', 'https', 'net', 'tls', 'dgram', 'dns', 'undici', 'node-fetch', 'axios', 'got', 'superagent', 'ws'];
    for (const module of networkModules) {
      expect(source).not.toContain(`require('${module}')`);
      expect(source).not.toContain(`require("${module}")`);
    }
    // The only outbound requests flow through @notionhq/client; the engine
    // itself must not call fetch (fetchPublished/fetchAllBlocks are plain
    // names over the client — this regex matches a bare `fetch(` call only).
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it('references the Notion API host as its only real endpoint', () => {
    const hosts = new Set(urlHosts(source));
    expect(hosts.has(NOTION_API_HOST)).toBe(true);
    for (const host of hosts) {
      if (host !== NOTION_API_HOST) {
        // Anything else must be documented here — today the source has no
        // other real-host URL literal.
        expect(BUNDLE_HOST_ALLOWLIST.has(host)).toBe(true);
      }
    }
  });
});

describe('network contract: package.json', () => {
  const pkg = JSON.parse(read('package.json'));

  it('declares @notionhq/client as the only runtime dependency', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@notionhq/client']);
  });

  it('declares no peer or optional dependencies', () => {
    expect(pkg.peerDependencies ?? {}).toEqual({});
    expect(pkg.optionalDependencies ?? {}).toEqual({});
  });
});

describe('network contract: workflows and action.yml', () => {
  const workflowDir = path.join(REPO_ROOT, '.github', 'workflows');
  const files = [
    path.join(REPO_ROOT, 'action.yml'),
    ...readdirSync(workflowDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => path.join(workflowDir, f)),
  ];

  it('uses only allowlisted actions and local workflows', () => {
    const used = files.flatMap((file) => usesTargets(readFileSync(file, 'utf8')));
    expect(used.length).toBeGreaterThan(0);
    for (const uses of used) {
      expect(ACTIONS_USES_ALLOWLIST.has(uses)).toBe(true);
    }
  });
});

describe('network contract: SECURITY.md stays in sync', () => {
  const doc = read('SECURITY.md');

  it('documents every allowlisted endpoint and action', () => {
    for (const host of [NOTION_API_HOST, 'bun.sh']) {
      expect(doc.includes(host)).toBe(true);
    }
    for (const uses of ['oven-sh/setup-bun@v2', 'actions/checkout@v4']) {
      expect(doc.includes(uses)).toBe(true);
    }
  });

  it('documents the engine require allowlist (client, fs, path)', () => {
    // SECURITY.md's audit section claims exactly this import surface.
    expect(doc).toContain('@notionhq/client');
    expect(doc).toContain('`fs` and `path`');
  });
});
