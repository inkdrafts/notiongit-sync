import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const REPO_ROOT = path.resolve(import.meta.dir, '..');

function loadWorkflow(name) {
  return yaml.load(readFileSync(path.join(REPO_ROOT, '.github', 'workflows', name), 'utf8'));
}

function bunSetup(workflow) {
  return Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .find((step) => step.uses === 'oven-sh/setup-bun@v2');
}

describe('Bun build toolchain', () => {
  it('uses one pinned Bun version for CI and releases', () => {
    const ci = bunSetup(loadWorkflow('ci.yml'));
    const release = bunSetup(loadWorkflow('release.yml'));

    expect(ci.with['bun-version']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(release.with['bun-version']).toBe(ci.with['bun-version']);
  });

  it('checks the latest Bun build on a schedule', () => {
    const workflow = loadWorkflow('bun-drift.yml');
    const setup = bunSetup(workflow);
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);

    expect(workflow.on.schedule.length).toBeGreaterThan(0);
    expect(workflow.on.workflow_dispatch).toEqual({});
    expect(setup.with['bun-version']).toBe('latest');
    expect(steps.map((step) => step.run)).toContain('bun run build');
    expect(steps.map((step) => step.run)).toContain('git diff --exit-code -- dist/index.js');
  });
});
