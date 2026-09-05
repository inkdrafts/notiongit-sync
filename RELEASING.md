# Releasing

Generated sites consume this action as `uses: inkdrafts/notiongit-sync@vN`,
pinned to the major alias of the release they were provisioned with.
Each `vN` major alias is a **moving alias**: it always points at the latest
`N.x.y` tag, so a site pinned to `@v1` picks up 1.x fixes and additive features
automatically, without a code change in the consumer repository, and a new
major never moves an older major's alias. Full version tags (`vX.Y.Z`) are the
opposite — **immutable**, once pushed. This document is the process that keeps
that promise.

## Compatibility promise

The stable surface is: `action.yml` inputs/outputs, and the
[generated-file contract](README.md#generated-file-contract) (the shape of
`_pages/*.md`, `_posts/*.md`, `_data/nav.yml`, `_data/home.yml`, and the
`_config.yml` lines this action manages). Semantic versioning applies to that
surface, not to internal code structure.

**Patch (`X.Y.Z+1`)** — bug fixes and internal changes with no observable
effect on the contract above: a fix to how a Notion property is parsed that
restores documented behavior, dependency bumps, refactors, doc updates.

**Minor (`X.Y+1.0`)** — strictly additive: a new optional input or output, a
new accepted alternate name for an existing Notion property, a new key added
to a generated file's front matter that consumers can ignore. Existing inputs,
outputs, and previously-generated content keep working unchanged.

**Major (`X+1.0.0`)** — anything a pinned `@v1` consumer would have to react
to: removing or renaming an input/output, changing an input's default in a
way that changes existing behavior, changing the shape or naming of generated
files (front matter keys, file paths, `_config.yml` lines touched), tightening
or loosening the bulk-delete guard's default behavior, or raising the minimum
Bun version past what GitHub-hosted runners provide by default.

When in doubt, treat the change as major — a generated site's scheduled sync
runs unattended, so a silent breaking change under `@v1` is worse than an
unnecessary major bump.

## Cutting a release

1. Merge the change(s) into `main`.
2. Add a section to [`CHANGELOG.md`](CHANGELOG.md) — move the relevant
   `Unreleased` entries under a new `## [X.Y.Z] - YYYY-MM-DD` heading. The
   release workflow refuses to tag a version with no matching section.
3. Go to **Actions → Release → Run workflow** on `main`, and fill in:
   - `version`: the full semver to release, no leading `v` (e.g. `1.2.0`).
   - `dry_run`: leave at the default `true` first. This runs the full CI
     suite, rebuilds and re-verifies `dist/`, and checks the version/changelog
     preconditions — without creating, pushing, or publishing anything.
4. Once the dry run is green, run it again with `dry_run: false`. This:
   - creates the annotated, immutable tag `vX.Y.Z` and pushes it,
   - creates the `vN` alias on the major's first release, then force-moves it
     to that same commit and pushes it,
   - publishes a GitHub Release for `vX.Y.Z` using that version's changelog
     section as the release notes.

The release job only runs after the same build-and-test job CI runs on every
push (`.github/workflows/ci.yml`, invoked as a reusable workflow) succeeds
again on the release commit, so a release can never ship with failing tests
or a stale `dist/`.

## Rollback

Only major aliases ever move, so rollback is: point the released major's alias
at an older, already-published `vX.Y.Z` tag of that same major. Never re-push
or delete the full-version tag being rolled back from — it stays published as
history.

```bash
git fetch origin --tags
git tag -f vN vX.Y.Z   # the known-good version to roll back to; N is X
git push origin refs/tags/vN --force
```

This requires push access to `notiongit-sync` and, if tag protection (below)
is configured, an actor with bypass permission on the major-alias rule.
Consumers pick up the rollback on their next scheduled sync — nothing needs
to change in a generated site's repository.

## Tag protection

Full-version tags must never be recreated or moved once published. GitHub's
old "tag protection rules" were retired in 2024; the current mechanism is a
[tag ruleset](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets).
Create one in this repository's **Settings → Rules → Rulesets → New ruleset →
New tag ruleset**:

- **Target tags**: pattern `v*.*.*` (matches every `vX.Y.Z` tag; the required
  dots mean it does **not** match any bare major alias — `v1`, `v2`, and so on —
  which must stay movable by the release workflow).
- **Restrict deletions** and **Block force pushes**: both enabled.
- No bypass list, so not even an admin can move or delete a matching tag from
  outside this process.

Equivalently, via the API (`--input -` reads the JSON body from stdin):

```bash
cat <<'JSON' | gh api repos/inkdrafts/notiongit-sync/rulesets --input -
{
  "name": "immutable-version-tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/v*.*.*"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" } ]
}
JSON
```

This is a repository setting, not something a workflow file can enforce on
its own — it needs to be applied once by a maintainer with admin access.
