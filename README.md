# notiongit-sync

The Notion → Jekyll sync engine behind [InkDrafts](https://github.com/inkdrafts) —
packaged to be consumed by generated sites as a reusable GitHub Action
(`uses: inkdrafts/notiongit-sync@v1`). The engine reads two Notion databases and
writes the Jekyll files a GitHub Pages site needs. Nothing else: no telemetry, no
network calls beyond the Notion API, no site content of its own.

> **Status:** this repository currently contains the engine as plain Node source —
> a faithful import of the production script. The GitHub Action wrapper
> (`action.yml`) lands in issue #2; dependency bundling in #3; the `v1` release
> tag in #7.

## Import provenance

`scripts/sync-notion.js` is a **byte-for-byte** copy of the production engine:

| | |
|---|---|
| Source repository | [`leandro-llosa/leandro-llosa.github.io`](https://github.com/leandro-llosa/leandro-llosa.github.io) |
| Source branch | `master` |
| Source revision | [`c0166c0367e8595d7ee6f60b79f7a549926e0cb7`](https://github.com/leandro-llosa/leandro-llosa.github.io/commit/c0166c0367e8595d7ee6f60b79f7a549926e0cb7) ("style: center pages vertically only, not horizontally") |
| Git blob SHA | `1394ac2cc602bf525cdb4cea02e2580fe25f2132` (matches GitHub's reported blob SHA at that revision) |

The import is intentionally unmodified: no renames, no reformatting, no dependency
changes, no bug fixes. Every later behavior change should be visible as a focused
diff against this baseline.

`package.json` is recreated minimally (the engine's only dependency is
`@notionhq/client`; the Node engine range and the `sync` script are preserved from
the source repository's package metadata).

## How it works

```
Notion Pages DB  ─┐
                  ├─→  scripts/sync-notion.js  ─→  _data/nav.yml, _data/home.yml,
Notion Posts DB  ─┘                             ─→  _pages/{slug}.md, _posts/{date}-{slug}.md
                                                ─→  _config.yml (title, author.name only)
```

- Only rows whose `Status` select equals **`Published`** are synced (both databases).
- The Notion page body is converted to Markdown (paragraphs, headings, lists,
  to-dos, code blocks with captions, quotes, callouts, dividers, images, videos,
  bookmarks/link previews).
- Writes are diffed: a file is rewritten only when its content would change.
- Files carry a `notion_id` front-matter key; **only files with a `notion_id` are
  managed** — hand-added Markdown files in `_pages/`/`_posts/` are never deleted.
  (Caveat: a hand-added file whose name collides with a generated
  `{slug}.md` / `{date}-{slug}.md` is overwritten by that row's output — the
  `notion_id` check guards deletion, not name collisions.) Slug (or date) renames
  in Notion delete the old file and write the new one.

### Runtime expectations

Node ≥ 18 (GitHub-hosted runners use Node 20). The script resolves the Jekyll site
root as the parent of `scripts/` (`path.resolve(__dirname, '..')`), so it is
designed to run inside a consumer's Jekyll site checkout — in this repository it is
engine source, not a runnable site.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `NOTION_TOKEN` | **Yes** | Notion integration secret. Missing → exit 1 before any I/O. |
| `NOTION_PAGES_DATABASE_ID` | One of the two DB IDs | ID of the Pages database (below). Unset → pages sync skipped. |
| `NOTION_POSTS_DATABASE_ID` | One of the two DB IDs | ID of the Posts database (below). Unset → posts sync skipped. |
| `NOTION_DATABASE_ID` | No | Legacy fallback for the posts database; used only when `NOTION_POSTS_DATABASE_ID` is unset. |
| `ALLOW_BULK_DELETE` | No | Set to exactly `true` to bypass the bulk-delete guard (below). |
| `MAX_DELETE_RATIO` | No | Fraction of tracked files a sync may delete before the guard trips. Default `0.5`. A value of `0` — or any non-numeric value — silently falls back to `0.5` (`Number(x) \|\| 0.5`); a negative value trips the guard on any multi-file deletion, and a value above `1` disables the ratio check. |

At least one of `NOTION_PAGES_DATABASE_ID` / `NOTION_POSTS_DATABASE_ID` (or the
legacy `NOTION_DATABASE_ID`) must be set alongside `NOTION_TOKEN`, otherwise the
script exits 1 without querying anything.

## Notion database schemas

These are the properties the engine reads. Each canonical name lists the
alternate property names it also accepts (useful when duplicating an existing
database); columns marked *default* apply when the property is empty or absent.

### Pages database (`NOTION_PAGES_DATABASE_ID`) — one row = one site section

| Property | Type | Meaning |
|---|---|---|
| `Title` (or `title`, `Name`) | Title | Page name; used as nav label and page heading. Default `Untitled`. |
| `Slug` (or `slug`) | Text | URL path segment, e.g. `about`. Defaults to the slugified title. |
| `Type` (or `type`) | Select | `home`, `blog-list`, `blog`, or `markdown` (default) — see mapping below. Matched case-insensitively (`Home`, `Blog-List` also work). |
| `Nav Order` (or `Nav order`, `Order`) | Number | Sort order in the header nav. Default `99`. |
| `Show in Nav` (or `Show In Nav`, `Nav`) | Checkbox | Include in `_data/nav.yml`. Default `false`. |
| `Status` | Select | Must be `Published` to sync (query filter). |
| `Description` (or `Excerpt`, `Summary`) | Text | Optional meta description → page front matter. |
| `Name` (or `Display Name`, `Author Name`) | Text | Display name on the home page (`home` type only); falls back to `Title`. Also written to `_config.yml` as `title` and `author.name`. |
| `Profile Picture` (or `Avatar`, `Photo`) | Text | External image URL (`home` type only). **Use external URLs — Notion-hosted file URLs expire.** |
| `Tagline` (or `Short Bio`, `Subtitle`) | Text | One-line bio (`home` type only). |
| `Social Links` (or `Socials`, `Links`) | Text | Newline-separated `Name: URL` pairs (`home` type only). |

`Social Links` format:

```
GitHub: https://github.com/username
Twitter: https://twitter.com/handle
Email: mailto:user@example.com
```

A URL beginning with `//` is prefixed with `https:`; any other scheme-less value
is kept as written.

The Notion page body of a `home` row becomes the home page bio; the body of any
other row becomes that page's Markdown content.

#### `Type` → Jekyll layout

| Notion `Type` | Jekyll layout | URL |
|---|---|---|
| `home` | — (no `_pages/` file; writes `_data/home.yml` and updates `_config.yml`) | `/` |
| `blog-list` or `blog` | `blog` | `/{slug}/` |
| `markdown` (default) | `page` | `/{slug}/` |

### Posts database (`NOTION_POSTS_DATABASE_ID`; legacy `NOTION_DATABASE_ID`) — one row = one blog post

| Property | Type | Meaning |
|---|---|---|
| `Title` (or `title`, `Name`) | Title | Post title. Default `Untitled`. |
| `Slug` (or `slug`) | Text | URL slug. Defaults to the slugified title. |
| `Status` | Select | Must be `Published` to sync (query filter). |
| `Publish Date` (or `Date`, `Published`) | Date | Publish date → filename and front matter. Defaults to today. |
| `Tags` | Multi-select | Tags → post front matter. |
| `Description` (or `Excerpt`, `Summary`) | Text | Optional excerpt → post front matter. |
| `Cover Image` | Files & media | First file's URL. **External URLs strongly recommended — Notion-hosted file URLs expire and the link will rot.** |
| `Canonical URL` | URL | Optional canonical link → post front matter. |
| `Featured` | Checkbox | `featured: true` in post front matter when checked. |

## Generated-file contract

All of these are **sync-managed**: never edited by hand, changes are overwritten.

| File | Generated from | Contents |
|---|---|---|
| `_data/home.yml` | The `home`-type row | `name`, `tagline`, `profile_picture`, `social_links` (list of `{name, url}`), `bio` (page body as a YAML literal block), `notion_id`. Written only when a published `home` row exists. |
| `_data/nav.yml` | All rows with `Show in Nav` checked | List of `{title, url}` sorted by `Nav Order`; `url` is `/` for `home`, else `/{slug}`. Empty list writes `[]`. |
| `_pages/{slug}.md` | Each published non-`home` row | Front matter `layout`, `title`, `slug`, optional `description`, `notion_id`; body = page content. |
| `_posts/{date}-{slug}.md` | Each published post row | Front matter `layout: post`, `title`, `date`, `slug`, optional `tags`, `excerpt`, `cover_image`, `canonical_url`, `featured`, `notion_id`; body = post content. |
| `_config.yml` | The `Name` of the `home` row | **Only** the top-level `title:` and the `author.name:` lines are rewritten, line by line, so comments and ordering survive. `url`, `baseurl`, and everything else are never touched. Unrecognized shapes are left alone and warned about. |

### Bulk-delete guard

Unpublishing rows in Notion deletes the corresponding files — but a run that
returns **zero published rows while tracked files exist** (every tracked file
looks unpublished), or that would delete **more than one file while exceeding
`MAX_DELETE_RATIO`** (default 0.5) of the tracked files, aborts with exit 1
**before deleting anything**. A dropped `Status` option, a revoked integration
share, or a partial API response is indistinguishable from a real mass unpublish,
and the consumer workflow commits the sync's output straight to the site's default
branch — so the guard aborts loudly instead.

On abort the script exits 1, so the consumer's commit step never runs and **the
repository is left untouched**. Earlier steps in the same aborted run — file
writes, and deletions caused by slug/date renames — can remain in the working
tree as uncommitted changes; the next successful sync reconciles them.

A single deletion is allowed — unless the run returned zero published rows, which
trips the guard however few files are stale. Push a genuine mass unpublish through
with `ALLOW_BULK_DELETE=true`.

### Exit codes

`0` — clean sync (possibly all-unchanged). `1` — missing `NOTION_TOKEN`, no
database IDs, a database query failed, any per-row error occurred, or the
bulk-delete guard tripped. The caller (the site's workflow) decides what to commit.

## Usage

```bash
npm install
NOTION_TOKEN=secret NOTION_PAGES_DATABASE_ID=… NOTION_POSTS_DATABASE_ID=… npm run sync
```

## License

TBD — tracked in [`notiongit-template` #9](https://github.com/inkdrafts/notiongit-template/issues/9) at the org level.
