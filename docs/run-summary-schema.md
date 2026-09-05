# Run summary schema

Every `notiongit-sync` run — success, no-op, or failure — ends by publishing
one **run summary**: a small, versioned, non-secret JSON object describing
what happened. It exists so the InkDrafts provisioning/status application (or
any other caller) can tell a user what their site's last sync did without
understanding the GitHub Actions interface.

The same object is published three ways:

| Channel | Format | Audience |
|---|---|---|
| Action output `summary` | Compact (single-line) JSON matching this schema | Programmatic — the calling workflow, or anything that reads the step's outputs |
| `$GITHUB_STEP_SUMMARY` | Markdown rendering of the same data | Human — shown on the Actions run page |
| `notiongit-run-summary` artifact | the same compact JSON, byte-identical to the `summary` output, as `run-summary.json` inside the artifact zip | Programmatic, after the run — Actions artifacts API |

The Action's other output, `changed` (`"true"`/`"false"`), is unchanged and
documented in the [README](../README.md#outputs).

The formal shape lives in [`schema/run-summary.v1.json`](../schema/run-summary.v1.json)
(JSON Schema, draft 2020-12). This document is the guide to it.

## Versioning

`schema_version` is an integer, starting at `1`. It only changes for a
breaking change to this shape — removing a field, renaming one, or changing
what an existing field means. Adding a new optional value to `code` (see
below), or a new field a consumer can safely ignore, does **not** bump it.
This mirrors the compatibility promise in [RELEASING.md](../RELEASING.md),
applied to this JSON shape instead of the generated-file contract.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | integer | Always `1` for every payload this document describes. |
| `result` | `"success" \| "no_op" \| "failure"` | Coarse, stable outcome. Safe to switch on without knowing every `code`. |
| `code` | string | Specific, machine-readable reason — see the table below. New codes may be added within `schema_version` 1 without a version bump; treat an unrecognized code as a generic instance of its `result`. |
| `changed` | boolean | `true` when any tracked file was created, updated, renamed or deleted this run — same meaning as the `changed` output. Independent of `result`: a `row_errors` failure can still report `changed: true` if some rows succeeded before another row failed. Always `false` for `no_op` and every other failure code, where nothing was ever written. |
| `started_at` | string (ISO 8601, UTC) | When the run began, before any Notion API call. |
| `finished_at` | string (ISO 8601, UTC) | When the run reached its terminal state. |
| `pages` | object or `null` | Counts for the pages database — see below. `null` when the pages section didn't run this time (not configured, or the run aborted before finishing it). |
| `posts` | object or `null` | Counts for the posts database — same shape and fallback as `pages`. |
| `data_files` | object or `null` | Which of `_data/nav.yml`, `_data/home.yml`, and the managed `_config.yml` lines were rewritten. `null` only when no section ran at all; see below. |
| `detail` | string | One safe, human-readable line: counts and generated filenames only. |

`pages` / `posts`, when not `null`, are:

```json
{ "created": 0, "updated": 0, "renamed": 0, "deleted": 0, "unchanged": 0, "errors": 0 }
```

`data_files`, when not `null`, is:

```json
{ "nav": false, "home": false, "config": false }
```

### Why `pages`/`posts`/`data_files` can be `null`

These three fields go `null` for two different reasons — they don't
necessarily go `null` together:

- **A section didn't run this time.** A site that only configures one
  database (`pages_database_id` or `posts_database_id`, not both) never runs
  the other section, even on a completely successful sync — that section's
  field is `null`, while the section that did run, and `data_files`, are
  real, meaningful values (posts never touches `_data/`, so `data_files` on
  a posts-only run is correctly `{"nav":false,"home":false,"config":false}`,
  not `null`).
- **The run aborted before finishing any section** — the bulk-delete guard
  tripping (`bulk_delete_guard`), an unexpected error (`sync_error`), or
  never getting past credential resolution (`missing_credentials`). Here
  there genuinely are no counts for *any* section, so `pages`, `posts` and
  `data_files` are all `null` together, and `code`/`detail` explain why.

Either way, `null` is a documented fallback, not a missing value — never
guess at, or report stale, counts.

## Result / code reference

| `code` | `result` | When |
|---|---|---|
| `synced` | `success` | The run completed. `changed` and the per-section counts say whether anything actually moved — an all-`unchanged` run is still `"synced"`. |
| `missing_credentials` | `no_op` | `NOTION_TOKEN` and/or a database ID were absent or blank. Nothing was read from Notion or written to the site; this is not an error (see [Clean no-op on missing credentials](../README.md#clean-no-op-on-missing-credentials)). |
| `bulk_delete_guard` | `failure` | The [suspicious-bulk-delete guard](../README.md#bulk-delete-guard) aborted the run before deleting anything. |
| `sync_error` | `failure` | The run aborted on an unexpected error before finishing a section — most commonly a failed Notion API call (auth, network, a database the integration can't see), but this also covers non-Notion failures (e.g. an unwritable site checkout). `detail` carries the redacted error message. |
| `row_errors` | `failure` | The run completed, but one or more individual rows could not be processed — see `pages.errors` / `posts.errors` for counts. `changed` can still be `true` here. |

## Non-secret guarantee

`detail` never contains a Notion token, a database ID, a raw Notion API
response, page titles/body content, or a stack trace — the same guarantee the
plain-text `summary` output has always made. Any error text that could echo
one (a Notion API error message commonly includes the database ID it
couldn't find) is redacted — every occurrence of a configured secret value is
replaced with the literal string `[redacted]` — before it reaches `detail`,
the JSON output, or the Markdown step summary. `test/run-summary-schema.test.js`
covers this with a representative Notion API error containing a live-looking
database ID.

## Example payloads

**`success`, changes made:**

```json
{"schema_version":1,"result":"success","code":"synced","changed":true,"started_at":"2026-09-02T12:00:00.000Z","finished_at":"2026-09-02T12:00:03.000Z","pages":{"created":1,"updated":0,"renamed":0,"deleted":0,"unchanged":2,"errors":0},"posts":{"created":0,"updated":1,"renamed":0,"deleted":0,"unchanged":3,"errors":0},"data_files":{"nav":true,"home":true,"config":false},"detail":"pages: 1 created, 0 updated, 0 renamed, 0 deleted, 2 unchanged (nav.yml, home.yml updated); posts: 0 created, 1 updated, 0 renamed, 0 deleted, 3 unchanged"}
```

**`success`, nothing changed:**

```json
{"schema_version":1,"result":"success","code":"synced","changed":false,"started_at":"2026-09-02T12:00:00.000Z","finished_at":"2026-09-02T12:00:01.000Z","pages":{"created":0,"updated":0,"renamed":0,"deleted":0,"unchanged":3,"errors":0},"posts":{"created":0,"updated":0,"renamed":0,"deleted":0,"unchanged":5,"errors":0},"data_files":{"nav":false,"home":false,"config":false},"detail":"pages: 0 created, 0 updated, 0 renamed, 0 deleted, 3 unchanged; posts: 0 created, 0 updated, 0 renamed, 0 deleted, 5 unchanged"}
```

**`no_op`, missing credentials:**

```json
{"schema_version":1,"result":"no_op","code":"missing_credentials","changed":false,"started_at":"2026-09-02T12:00:00.000Z","finished_at":"2026-09-02T12:00:00.000Z","pages":null,"posts":null,"data_files":null,"detail":"skipped: NOTION_TOKEN environment variable is not set."}
```

**`failure`, bulk-delete guard tripped:**

```json
{"schema_version":1,"result":"failure","code":"bulk_delete_guard","changed":false,"started_at":"2026-09-02T12:00:00.000Z","finished_at":"2026-09-02T12:00:02.000Z","pages":null,"posts":null,"data_files":null,"detail":"bulk-delete guard tripped for pages: would delete 3 of 4 tracked (75%)"}
```

**`failure`, an unexpected sync error (most commonly a failed Notion API call):**

```json
{"schema_version":1,"result":"failure","code":"sync_error","changed":false,"started_at":"2026-09-02T12:00:00.000Z","finished_at":"2026-09-02T12:00:01.000Z","pages":null,"posts":null,"data_files":null,"detail":"sync failed: Error querying pages database: Could not find database with ID: [redacted]."}
```

**`success`, posts-only configuration** (`pages` is `null` because the pages
database isn't configured, not because anything failed — `data_files` is
still a real, non-`null` value):

```json
{"schema_version":1,"result":"success","code":"synced","changed":true,"started_at":"2026-09-02T12:00:00.000Z","finished_at":"2026-09-02T12:00:01.000Z","pages":null,"posts":{"created":1,"updated":0,"renamed":0,"deleted":0,"unchanged":0,"errors":0},"data_files":{"nav":false,"home":false,"config":false},"detail":"posts: 1 created, 0 updated, 0 renamed, 0 deleted, 0 unchanged"}
```

## Markdown rendering

The same data, appended to `$GITHUB_STEP_SUMMARY`, looks like:

```
### Notion → Jekyll sync — ✅ success (`synced`)

- **Changed:** yes
- **Started:** 2026-09-02T12:00:00.000Z
- **Finished:** 2026-09-02T12:00:03.000Z

| Section | Created | Updated | Renamed | Deleted | Unchanged | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| Pages | 1 | 0 | 0 | 0 | 2 | 0 |
| Posts | 0 | 1 | 0 | 0 | 3 | 0 |

**Data files updated:** nav.yml, home.yml

pages: 1 created, 0 updated, 0 renamed, 0 deleted, 2 unchanged (nav.yml, home.yml updated); posts: 0 created, 1 updated, 0 renamed, 0 deleted, 3 unchanged
```

Parse the `summary` output for automation; read `$GITHUB_STEP_SUMMARY` (or the
Actions UI) as a person.

## Reading the summary after the run

The `summary` output and the `$GITHUB_STEP_SUMMARY` rendering only exist
inside the run — GitHub exposes no API to read either back. The third channel
fixes that: the Action also writes the compact JSON to a `run-summary.json`
file under `runner.temp` (the `RUN_SUMMARY_FILE` environment variable), and
the shipped [template workflow](https://github.com/inkdrafts/notiongit-template)
uploads it as a workflow artifact named `notiongit-run-summary`. The channel
exists on **every terminal run** — success, no-op, or failure, including the
runs that exit `1` — so a guarded deletion or a sync error is readable after
the fact too.

The binding is per run: each workflow run produces at most one artifact named
`notiongit-run-summary`, keyed by its `run_id`. There is no stored "latest"
pointer anywhere — derive it by listing runs and taking the newest one.

Reading it takes Actions **read** permission on the site repository (the
InkDrafts App's Actions write already covers that):

1. `GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts?name=notiongit-run-summary`
   — take `artifacts[0]` when the list is non-empty and its `expired` is
   `false`.
2. `GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip` — responds
   `302` to a signed URL; download that and unzip the single member,
   `run-summary.json`.
3. When there is nothing to read for a run,
   `GET /repos/{owner}/{repo}/actions/runs/{run_id}` provides that run's
   `conclusion` as the fallback signal.

How long the artifact lives is governed by the site repository's
artifact-retention setting — GitHub's default is 90 days. At the template's
10-minute schedule that is on the order of 13,000 live artifacts of roughly
2 KB per site, which is free storage on public repositories; artifacts past
retention list with `expired: true` before they disappear entirely.

Consumers, in order:

1. An unrecognized `code` is handled by `result` alone (the rule above,
   unchanged).
2. No artifact for the run, or only expired ones, means fall back on that
   run's `conclusion` — this covers runs that predate the channel and runs
   past retention.
3. A `schema_version` other than `1` means conclusion fallback plus an
   "unsupported summary version" surface to the user.

Never fabricate counts: a missing or unreadable summary is "no data", never
success.
