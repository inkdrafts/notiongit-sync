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
