/**
 * Contract tests for .github/workflows/release.yml — pins the safety
 * properties RELEASING.md promises: dry-run defaults on, the release job
 * only runs after the same checks CI runs, and tagging/pushing/publishing
 * only happens when dry_run is false.
 */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const workflow = yaml.load(
  readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8')
);

describe('release.yml trigger', () => {
  it('is manually dispatched with version and dry_run inputs', () => {
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.version.required).toBe(true);
    expect(inputs.dry_run.default).toBe(true);
  });

  it('can write repo contents (to push tags and publish a release)', () => {
    expect(workflow.permissions.contents).toBe('write');
  });
});

describe('release.yml jobs', () => {
  it('reuses ci.yml as the verify job, not a duplicated test job', () => {
    expect(workflow.jobs.verify.uses).toBe('./.github/workflows/ci.yml');
  });

  it('chains validate-inputs and release after verify, in order', () => {
    expect(workflow.jobs['validate-inputs'].needs).toBe('verify');
    expect(workflow.jobs.release.needs).toBe('validate-inputs');
  });

  it('rebuilds dist/ and re-runs the test suite before any tag is created', () => {
    const names = workflow.jobs.release.steps.map((s) => s.name);
    expect(names).toContain('Rebuild dist/ so the tagged commit\'s bundle is provably current');
    expect(names).toContain('Fail if dist/ is stale');
    expect(names).toContain('Test');
    expect(names.indexOf('Test')).toBeLessThan(names.indexOf('Create the immutable version tag'));
  });

  it('gates every tagging/publishing step on dry_run being false, and only those', () => {
    const gated = ['Create the immutable version tag', 'Move the v1 alias to the new release', 'Publish the GitHub release'];
    for (const step of workflow.jobs.release.steps) {
      if (gated.includes(step.name)) {
        expect(step.if).toBe('${{ !inputs.dry_run }}');
      } else if (step.name === 'Dry run — nothing was tagged, pushed, or published') {
        expect(step.if).toBe('${{ inputs.dry_run }}');
      } else {
        expect(step.if).toBeUndefined();
      }
    }
  });

  it('rejects releasing a version whose tag already exists (immutability guard)', () => {
    const step = workflow.jobs['validate-inputs'].steps.find((s) =>
      (s.name ?? '').includes('immutable')
    );
    expect(step.run).toContain('git ls-remote --exit-code --tags origin');
    expect(step.run).toContain('exit 1');
  });

  it('requires a matching CHANGELOG.md section before releasing', () => {
    const step = workflow.jobs['validate-inputs'].steps.find((s) =>
      (s.name ?? '').includes('CHANGELOG')
    );
    expect(step.run).toContain('CHANGELOG.md');
    expect(step.run).toContain('exit 1');
  });
});
