# dist/

`index.js` is the Action's entry point, generated from `../scripts/sync-notion.js`
by `bun run build` (`bun build ./scripts/sync-notion.js --outfile dist/index.js
--target bun`). `action.yml` runs it directly, so a consumer workflow never runs
`bun install` — no network install, no lockfile-resolution failure, on every
scheduled sync.

## Why this is committed

A composite GitHub Action runs from the ref a consumer pins
(`uses: inkdrafts/notiongit-sync@425b414ad8080ce2d309dfcac52c94f4557e21bd`,
i.e. v2.0.0), not from a package registry — there is no
install step that could pull in dependencies for it. Committing the bundle is
what makes the action self-contained at that ref.

## Rules

- **Never hand-edit anything in this directory.** Regenerate it with
  `bun run build` after changing `scripts/sync-notion.js`, then commit the
  result. CI (`.github/workflows/ci.yml`) rebuilds and diffs this directory on
  every push/PR and fails if it's stale.
- `bun build --target bun` resolves `@notionhq/client` down to plain code and
  swaps its `node-fetch` dependency for Bun's native `fetch` — nothing else in
  `node_modules` ends up in the bundle. Re-check this (`grep -o '// node_modules/
  [^ ]*' dist/index.js | sort -u`) if a future dependency change might pull in
  more.

## Third-party notices

This bundle embeds code from:

### @notionhq/client (MIT)

> Copyright 2021 Notion Labs, Inc.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to
> deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
> sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
> FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
> IN THE SOFTWARE.

Source: `node_modules/@notionhq/client/LICENSE` at the version pinned in
`bun.lock` (currently 2.3.0).
