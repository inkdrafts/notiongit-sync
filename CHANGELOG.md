# Changelog

All notable changes to `notiongit-sync` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); version numbers
follow the compatibility promise in [RELEASING.md](RELEASING.md).

Every `vX.Y.Z` tag below is immutable once published — its section here is
never edited after release. Add new entries under **Unreleased** as you make
changes, then turn `Unreleased` into a dated `## [X.Y.Z] - YYYY-MM-DD` section
when [cutting that release](RELEASING.md#cutting-a-release); the release
workflow refuses to tag a version with no matching section here.

## [Unreleased]

### ⚠ Breaking

- The `summary` Action output is now a compact JSON **run summary**
  (`schema_version: 1`) instead of a one-line plain-text count. Any consumer
  workflow that parses `summary` as plain text must be updated. See
  [`docs/run-summary-schema.md`](docs/run-summary-schema.md) for the schema,
  and [RELEASING.md](RELEASING.md#compatibility-promise) — this requires a
  **major** version bump at the next release.

### Added

- Every terminal path — including a bulk-delete guard trip and an unexpected
  sync error, which previously exited with no outputs at all — now emits a
  run summary. `code` names the specific outcome (`synced`,
  `missing_credentials`, `bulk_delete_guard`, `sync_error`, `row_errors`);
  `pages`/`posts`/`data_files` are `null` (a documented fallback) either when
  that section wasn't configured or when the run didn't get far enough to
  produce real counts.
- A Markdown rendering of the same run summary is appended to
  `$GITHUB_STEP_SUMMARY` when the runner sets it, for the Actions run page.
- A durable artifact channel: the run summary is also written to the file
  named by `RUN_SUMMARY_FILE` (the Action wrapper sets it to
  `run-summary.json` under `runner.temp`), so the calling workflow can upload
  it as a workflow artifact and read it after the run — the shipped template
  workflow publishes it as the `notiongit-run-summary` artifact on every
  terminal run. The channel is observational: a failed summary-file write is
  a warning and never changes the run's exit code. See
  ["Reading the summary after the run"](docs/run-summary-schema.md#reading-the-summary-after-the-run).
  The `v1` tag predates the run-summary feature, so the next release must
  still be a **major** bump for consumers to move off `@v1` and activate the
  channel (per [RELEASING.md](RELEASING.md#compatibility-promise)).
- [`schema/run-summary.v1.json`](schema/run-summary.v1.json) — the formal,
  versioned JSON Schema for the run summary.

## [1.0.0] - 2026-09-02

Initial release of `notiongit-sync` as a reusable Bun GitHub Action.

- Composite action (`action.yml`) wrapping the Notion → Jekyll sync engine,
  consumed as `uses: inkdrafts/notiongit-sync@v1`.
- `notion_token`, `pages_database_id`, `posts_database_id`, and
  `allow_bulk_delete` inputs; `changed` and `summary` outputs.
- Generated-file contract: `_pages/*.md`, `_posts/*.md`, `_data/nav.yml`,
  `_data/home.yml`, and the managed `title`/`author.name` lines of
  `_config.yml`.
- Reproducible, committed `dist/index.js` bundle — consumer workflows never
  run `bun install`.
- Suspicious-bulk-delete guard (`MAX_DELETE_RATIO`, `ALLOW_BULK_DELETE`).
- Release process: immutable `vX.Y.Z` tags with a moving `v1` alias (see
  [RELEASING.md](RELEASING.md)).
