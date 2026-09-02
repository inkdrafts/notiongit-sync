/**
 * Contract tests for action.yml — the stable surface generated sites consume
 * as `uses: inkdrafts/notiongit-sync@v1`. These complement metadata validation
 * (actionlint) by pinning the input/output contract, the Bun setup and entry
 * point, and the rule that credentials only ever flow through env, never
 * through logs or outputs.
 */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const action = yaml.load(readFileSync(path.join(REPO_ROOT, 'action.yml'), 'utf8'));

describe('action.yml metadata', () => {
  it('declares a name and description', () => {
    expect(typeof action.name).toBe('string');
    expect(action.name.length).toBeGreaterThan(0);
    expect(typeof action.description).toBe('string');
    expect(action.description.length).toBeGreaterThan(0);
  });

  it('is a composite action', () => {
    expect(action.runs.using).toBe('composite');
    expect(Array.isArray(action.runs.steps)).toBe(true);
  });
});

describe('action.yml inputs', () => {
  it('defines exactly the four contract inputs', () => {
    expect(Object.keys(action.inputs).sort()).toEqual([
      'allow_bulk_delete',
      'notion_token',
      'pages_database_id',
      'posts_database_id',
    ]);
  });

  it('requires only notion_token', () => {
    expect(action.inputs.notion_token.required).toBe(true);
    expect(action.inputs.pages_database_id.required).toBe(false);
    expect(action.inputs.posts_database_id.required).toBe(false);
    expect(action.inputs.allow_bulk_delete.required).toBe(false);
  });

  it("defaults the optional inputs to the strings '', '' and 'false'", () => {
    // String defaults: GitHub delivers action inputs as strings, and the
    // engine's normalization handles the rest.
    expect(action.inputs.pages_database_id.default).toBe('');
    expect(action.inputs.posts_database_id.default).toBe('');
    expect(action.inputs.allow_bulk_delete.default).toBe('false');
  });
});

describe('action.yml outputs', () => {
  it('defines changed and summary, wired to the sync step outputs', () => {
    expect(action.outputs.changed.value).toBe('${{ steps.sync.outputs.changed }}');
    expect(action.outputs.summary.value).toBe('${{ steps.sync.outputs.summary }}');
    expect(action.outputs.changed.description.length).toBeGreaterThan(0);
    expect(action.outputs.summary.description.length).toBeGreaterThan(0);
  });
});

describe('action.yml steps', () => {
  const [setup, install, sync, ...extra] = action.runs.steps;

  it('has exactly three steps', () => {
    expect(extra).toEqual([]);
  });

  it('sets up Bun via oven-sh/setup-bun@v2', () => {
    expect(setup.uses).toBe('oven-sh/setup-bun@v2');
  });

  it('installs dependencies with a frozen lockfile inside the action checkout', () => {
    expect(install.run).toBe('bun install --frozen-lockfile');
    expect(install.shell).toBe('bash');
    expect(install['working-directory']).toBe('${{ github.action_path }}');
  });

  it('runs the existing engine entry point with Bun under a step id', () => {
    expect(sync.id).toBe('sync');
    expect(sync.run).toBe('bun scripts/sync-notion.js');
    expect(sync.shell).toBe('bash');
    expect(sync['working-directory']).toBe('${{ github.action_path }}');
    // The referenced entry point must actually exist.
    expect(existsSync(path.join(REPO_ROOT, 'scripts', 'sync-notion.js'))).toBe(true);
    // A frozen-lockfile install requires the lockfile to be committed.
    expect(existsSync(path.join(REPO_ROOT, 'bun.lock'))).toBe(true);
  });

  it('maps every input into the engine environment', () => {
    expect(sync.env).toEqual({
      NOTION_TOKEN:              '${{ inputs.notion_token }}',
      NOTION_PAGES_DATABASE_ID:  '${{ inputs.pages_database_id }}',
      NOTION_POSTS_DATABASE_ID:  '${{ inputs.posts_database_id }}',
      ALLOW_BULK_DELETE:         '${{ inputs.allow_bulk_delete }}',
      SITE_ROOT:                 '${{ github.workspace }}',
    });
  });

  it('has no undocumented keys on any step (e.g. continue-on-error, if, timeout-minutes)', () => {
    // Pins the exact key set per step so a future edit that silently changes
    // failure/skip behavior (continue-on-error, if, timeout-minutes, ...) fails
    // this test instead of shipping unnoticed.
    expect(Object.keys(setup).sort()).toEqual(['name', 'uses']);
    expect(Object.keys(install).sort()).toEqual(['name', 'run', 'shell', 'working-directory']);
    expect(Object.keys(sync).sort()).toEqual(
      ['env', 'id', 'name', 'run', 'shell', 'working-directory']
    );
  });

  it('never lets credentials reach run commands or outputs', () => {
    // The token may only appear in the env block; anything echoed or written
    // by a run step would leak into the public run log.
    for (const step of action.runs.steps) {
      const run = step.run ?? '';
      expect(run).not.toContain('notion_token');
      expect(run).not.toContain('secrets.');
      expect(run).not.toContain('echo');
    }
    const outputsYaml = action.outputs ? JSON.stringify(action.outputs) : '';
    expect(outputsYaml).not.toContain('notion_token');
  });
});
