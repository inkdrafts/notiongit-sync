#!/usr/bin/env node
/**
 * Notion → Jekyll Sync Script
 *
 * Syncs two Notion databases into a Jekyll site:
 *   1. Pages database  → _data/nav.yml + _data/home.yml + _pages/*.md
 *   2. Posts database  → _posts/*.md
 *
 * Environment variables:
 *   NOTION_TOKEN               — Notion integration secret (required)
 *   NOTION_PAGES_DATABASE_ID   — ID of the pages/sections database (optional)
 *   NOTION_POSTS_DATABASE_ID   — ID of the blog posts database (optional)
 *   NOTION_DATABASE_ID         — Legacy fallback for posts database
 *   ALLOW_BULK_DELETE          — "true" (any case) to bypass the bulk-delete guard
 *   MAX_DELETE_RATIO           — Fraction of tracked files a single sync may
 *                                delete before the guard trips (default 0.5)
 *   SITE_ROOT                  — Root of the Jekyll site to write into
 *                                (default: the parent of scripts/, i.e. the
 *                                repository this script lives in; the GitHub
 *                                Action wrapper points it at the consumer's
 *                                checkout, since a composite action's own
 *                                files live outside the workspace)
 *   NOTION_BASE_URL            — Overrides the Notion API origin (default
 *                                https://api.notion.com). Test/harness hook
 *                                only: lets the local Action harness point the
 *                                real client at a fake API; never set in
 *                                production.
 *
 * At least one of NOTION_PAGES_DATABASE_ID or NOTION_POSTS_DATABASE_ID
 * (/ NOTION_DATABASE_ID) must be set. NOTION_TOKEN, and database id values,
 * are trimmed before checking, so whitespace-only counts as unset.
 *
 * Missing or blank credentials are not a failure: the run exits 0 with
 * changed=false and a safe summary naming the missing configuration key,
 * so a scheduled run that lands before secrets are provisioned stays green.
 *
 * Action outputs — when GITHUB_OUTPUT is set (i.e. under the Action wrapper),
 * the run appends two non-secret outputs for the consumer workflow:
 *   changed                    — "true" when any tracked file was created,
 *                                updated, renamed or deleted this run
 *   summary                    — one-line count of what the run did
 */

'use strict';

const { Client } = require('@notionhq/client');
const fs   = require('fs');
const path = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────

/** Configuration problem — mirrors the script's historical exit-1 messages. */
class ConfigError extends Error {}

/**
 * Normalize a boolean-ish flag. GitHub Actions inputs arrive as strings, so
 * "true", "True" and "TRUE" all mean yes; everything else (including "false",
 * "" and undefined) means no.
 */
function isTrue(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

/**
 * Resolve and validate the environment configuration.
 *
 * `env` is injected so tests can exercise the input mapping without touching
 * process.env. Throws ConfigError (with the messages the script has always
 * exited 1 on) when NOTION_TOKEN is missing or no database ID is set.
 */
function resolveConfig(env = process.env) {
  const notionToken = String(env.NOTION_TOKEN ?? '').trim();
  if (!notionToken) {
    throw new ConfigError('NOTION_TOKEN environment variable is not set.');
  }

  const pagesDbId = String(env.NOTION_PAGES_DATABASE_ID ?? '').trim();
  const postsDbId = String(env.NOTION_POSTS_DATABASE_ID ?? '').trim() ||
                     String(env.NOTION_DATABASE_ID ?? '').trim();
  if (!pagesDbId && !postsDbId) {
    throw new ConfigError('Set NOTION_PAGES_DATABASE_ID and/or NOTION_POSTS_DATABASE_ID.');
  }

  return {
    notionToken,
    pagesDbId,
    postsDbId,
    allowBulkDelete: isTrue(env.ALLOW_BULK_DELETE),
    maxDeleteRatio:  Number(env.MAX_DELETE_RATIO) || 0.5,
    // import.meta.dir, not __dirname: bun build freezes __dirname into a
    // literal absolute path at bundle time (the build machine's checkout
    // path), which breaks both bundle reproducibility and the runtime
    // fallback once bundled. import.meta.dir stays a live runtime lookup
    // through bundling. The Action always sets SITE_ROOT explicitly, so this
    // fallback only matters for local/dev invocations of either form.
    siteRoot:        env.SITE_ROOT || path.join(import.meta.dir, '..'),
    notionBaseUrl:   env.NOTION_BASE_URL || '',
  };
}

// ─── Run state ────────────────────────────────────────────────────────────────

// Initialized per run by initRun(). Module-level so the sync functions below
// close over it exactly as they always have.
let notion;
let PAGES_DB_ID, POSTS_DB_ID, ALLOW_BULK_DELETE, MAX_DELETE_RATIO;
let ROOT_DIR, POSTS_DIR, PAGES_DIR, DATA_DIR;

function initRun(config) {
  PAGES_DB_ID       = config.pagesDbId;
  POSTS_DB_ID       = config.postsDbId;
  ALLOW_BULK_DELETE = config.allowBulkDelete;
  MAX_DELETE_RATIO  = config.maxDeleteRatio;
  notion            = new Client({
    auth:   config.notionToken,
    ...(config.notionBaseUrl ? { baseUrl: config.notionBaseUrl } : {}),
  });
  ROOT_DIR          = path.resolve(config.siteRoot);
  POSTS_DIR         = path.join(ROOT_DIR, '_posts');
  PAGES_DIR         = path.join(ROOT_DIR, '_pages');
  DATA_DIR          = path.join(ROOT_DIR, '_data');
}

// ─── Rich text → Markdown ─────────────────────────────────────────────────────

function richTextToMarkdown(richText = []) {
  return richText.map((item) => {
    let text = item.plain_text ?? '';
    if (!text) return '';

    const ann  = item.annotations ?? {};
    const href = item.href;

    if (ann.code)                text = `\`${text}\``;
    if (ann.bold && ann.italic)  text = `***${text}***`;
    else if (ann.bold)           text = `**${text}**`;
    else if (ann.italic)         text = `*${text}*`;
    if (ann.strikethrough)       text = `~~${text}~~`;
    if (href)                    text = `[${text}](${href})`;

    return text;
  }).join('');
}

// ─── Block → Markdown ─────────────────────────────────────────────────────────

function blockToMarkdown(block) {
  const type = block.type;
  const data = block[type];
  if (!data) return null;

  switch (type) {
    case 'paragraph':
      return richTextToMarkdown(data.rich_text);

    case 'heading_1':
      return `# ${richTextToMarkdown(data.rich_text)}`;

    case 'heading_2':
      return `## ${richTextToMarkdown(data.rich_text)}`;

    case 'heading_3':
      return `### ${richTextToMarkdown(data.rich_text)}`;

    case 'bulleted_list_item':
      return `- ${richTextToMarkdown(data.rich_text)}`;

    case 'numbered_list_item':
      return `1. ${richTextToMarkdown(data.rich_text)}`;

    case 'to_do':
      return `- [${data.checked ? 'x' : ' '}] ${richTextToMarkdown(data.rich_text)}`;

    case 'code': {
      const lang    = data.language && data.language !== 'plain text' ? data.language : '';
      const code    = (data.rich_text ?? []).map((r) => r.plain_text).join('');
      const caption = richTextToMarkdown(data.caption ?? []);
      const block_md = `\`\`\`${lang}\n${code}\n\`\`\``;
      return caption ? `${block_md}\n*${caption}*` : block_md;
    }

    case 'quote':
      return `> ${richTextToMarkdown(data.rich_text)}`;

    case 'callout': {
      const icon = data.icon?.emoji ? `${data.icon.emoji} ` : '';
      return `> ${icon}${richTextToMarkdown(data.rich_text)}`;
    }

    case 'divider':
      return '---';

    case 'image': {
      const url     = data.type === 'external' ? (data.external?.url ?? '') : (data.file?.url ?? '');
      const caption = richTextToMarkdown(data.caption ?? []);
      return `![${caption}](${url})`;
    }

    case 'video': {
      const url     = data.type === 'external' ? (data.external?.url ?? '') : (data.file?.url ?? '');
      const caption = richTextToMarkdown(data.caption ?? []);
      return caption ? `[▶ ${caption}](${url})` : `[▶ Watch video](${url})`;
    }

    case 'bookmark':
    case 'link_preview': {
      const url = data.url ?? '';
      return `[${url}](${url})`;
    }

    case 'toggle':
      return `<details>\n<summary>${richTextToMarkdown(data.rich_text)}</summary>\n\n</details>`;

    case 'table_of_contents':
      return '';

    case 'child_page':
    case 'child_database':
      return null;

    default:
      return null;
  }
}

// ─── Blocks → Markdown ────────────────────────────────────────────────────────

const LIST_TYPES = new Set(['bulleted_list_item', 'numbered_list_item', 'to_do']);

function blocksToMarkdown(blocks) {
  const lines = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const md    = blockToMarkdown(block);

    if (md === null) continue;

    const prevBlock  = i > 0 ? blocks[i - 1] : null;
    const isList     = LIST_TYPES.has(block.type);
    const prevIsList = prevBlock ? LIST_TYPES.has(prevBlock.type) : false;

    if (lines.length > 0 && !(isList && prevIsList)) lines.push('');
    if (md !== '') lines.push(md);
  }

  return lines.join('\n').trim();
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchAllBlocks(blockId) {
  const blocks = [];
  let cursor;
  do {
    const res = await notion.blocks.children.list({
      block_id:     blockId,
      start_cursor: cursor,
      page_size:    100,
    });
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

async function fetchPublished(databaseId, statusValue = 'Published') {
  const pages = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id:  databaseId,
      filter: { property: 'Status', select: { equals: statusValue } },
      start_cursor: cursor,
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

// ─── Slugify ──────────────────────────────────────────────────────────────────

function titleToSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── YAML helpers ─────────────────────────────────────────────────────────────

/** Escape a string value for inline YAML (double-quoted). */
function yamlStr(value) {
  return JSON.stringify(String(value ?? ''));
}

// ─── Deletion guard ───────────────────────────────────────────────────────────

/**
 * Delete the files whose Notion pages came back unpublished — but refuse to do
 * it when the query result looks like a bad read rather than a real edit.
 *
 * A dropped Status option, a revoked integration share or a partial API
 * response all look identical to "the author unpublished everything", and the
 * sync commits straight to master, so an unguarded delete can wipe the live
 * site without anyone touching Notion. Abort loudly instead; the workflow's
 * commit step never runs, so the repo is left untouched.
 *
 * Set ALLOW_BULK_DELETE=true to push a genuine mass unpublish through.
 *
 * Returns the number of files actually deleted.
 */
function applyDeletions(dir, label, notionIdToFile, processedIds) {
  const stale = [...notionIdToFile].filter(([id]) => !processedIds.has(id));
  if (stale.length === 0) return 0;

  const tracked = notionIdToFile.size;
  const ratio   = stale.length / tracked;

  // A single deletion is always allowed: it is the ordinary "I unpublished one
  // thing" case, and it cannot take the site down on its own.
  const suspicious = processedIds.size === 0 ||
                     (stale.length > 1 && ratio > MAX_DELETE_RATIO);

  if (suspicious && !ALLOW_BULK_DELETE) {
    console.error(
      `\n   ABORT: this sync would delete ${stale.length} of ${tracked} tracked ${label} ` +
      `(${Math.round(ratio * 100)}%).\n` +
      `   Notion returned ${processedIds.size} published row(s), which usually means the\n` +
      `   database was misread — a renamed Status option, a revoked integration share,\n` +
      `   or a partial API response — not that you unpublished them.\n\n` +
      `   Would have deleted:\n` +
      stale.map(([, f]) => `     - ${f}`).join('\n') + '\n\n' +
      `   Nothing was changed. Check the database in Notion. If the deletion is real,\n` +
      `   re-run this workflow with ALLOW_BULK_DELETE=true.`
    );
    throw new Error(`bulk-delete guard tripped for ${label}`);
  }

  if (suspicious) {
    console.log(`\n   ALLOW_BULK_DELETE set — deleting ${stale.length} of ${tracked} ${label}.`);
  }

  let deleted = 0;
  for (const [, filename] of stale) {
    try {
      fs.unlinkSync(path.join(dir, filename));
      deleted++;
      console.log(`\n   removed (unpublished): ${filename}`);
    } catch {
      console.warn(`   Warning: could not remove ${filename}`);
    }
  }
  return deleted;
}

// ─── YAML helpers (cont.) ─────────────────────────────────────────────────────

/** Write a YAML list of nav items. */
function buildNavYaml(items) {
  if (items.length === 0) return '[]\n';
  return items.map((item) =>
    `- title: ${yamlStr(item.title)}\n  url: ${yamlStr(item.url)}`
  ).join('\n') + '\n';
}

/** Write the home data YAML. */
function buildHomeYaml(data) {
  const lines = [];
  lines.push(`name: ${yamlStr(data.name)}`);
  lines.push(`tagline: ${yamlStr(data.tagline)}`);
  lines.push(`profile_picture: ${yamlStr(data.profile_picture)}`);

  if (data.social_links && data.social_links.length > 0) {
    lines.push('social_links:');
    for (const link of data.social_links) {
      lines.push(`  - name: ${yamlStr(link.name)}`);
      lines.push(`    url: ${yamlStr(link.url)}`);
    }
  } else {
    lines.push('social_links: []');
  }

  // Bio as a YAML literal block (|)
  if (data.bio) {
    lines.push('bio: |');
    for (const line of data.bio.split('\n')) {
      lines.push(`  ${line}`);
    }
  } else {
    lines.push('bio: ""');
  }

  lines.push(`notion_id: ${yamlStr(data.notion_id)}`);
  return lines.join('\n') + '\n';
}

// ─── Site identity → _config.yml ──────────────────────────────────────────────

/**
 * Point _config.yml's `title` and `author.name` at the home page's Name.
 *
 * jekyll-seo-tag builds the browser tab title from `site.title`, and jekyll-feed
 * takes the feed title and author from `site.title` / `site.author.name`. None of
 * those can read a data file, so the Name has to land in _config.yml for the tab
 * and the feed to follow Notion.
 *
 * Edited line by line rather than parsed and re-emitted: _config.yml is otherwise
 * hand-maintained, and a YAML round-trip would drop its comments and ordering.
 * Anything unrecognised is left alone and reported.
 *
 * Returns true when the file was rewritten.
 */
function syncConfigIdentity(name) {
  if (!name) return false;

  const configPath = path.join(ROOT_DIR, '_config.yml');
  let original;
  try {
    original = fs.readFileSync(configPath, 'utf8');
  } catch {
    console.warn('   Warning: _config.yml not readable — site title left unchanged.');
    return false;
  }

  let inAuthor    = false;
  let sawTitle    = false;
  let sawAuthorName = false;

  const updated = original.split('\n').map((line) => {
    const isBlank    = line.trim() === '';
    const isIndented = /^[ \t]/.test(line);

    // A non-indented, non-blank line either opens the `author:` block or closes it.
    if (!isBlank && !isIndented) inAuthor = /^author:[ \t]*(#.*)?$/.test(line);

    if (!isIndented && /^title:/.test(line)) {
      sawTitle = true;
      return `title: ${yamlStr(name)}`;
    }
    if (inAuthor && isIndented && /^[ \t]+name:/.test(line)) {
      sawAuthorName = true;
      return `${line.match(/^[ \t]+/)[0]}name: ${yamlStr(name)}`;
    }
    return line;
  }).join('\n');

  if (!sawTitle)      console.warn('   Warning: no top-level `title:` in _config.yml — tab title not updated.');
  if (!sawAuthorName) console.warn('   Warning: no `author.name` in _config.yml — feed author not updated.');

  if (updated === original) {
    console.log('   unchanged: _config.yml');
    return false;
  }
  fs.writeFileSync(configPath, updated, 'utf8');
  console.log(`   updated: _config.yml (site title → ${name})`);
  return true;
}

// ─── Parse social links text ──────────────────────────────────────────────────

/**
 * Parse the "Social Links" Notion text property.
 * Expected format (one per line):   Name: https://...
 * Returns an array of { name, url } objects.
 */
function parseSocialLinks(raw) {
  if (!raw || !raw.trim()) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) return null;
      const name = line.slice(0, colonIdx).trim();
      const url  = line.slice(colonIdx + 1).trim();
      if (!name || !url) return null;
      // url may start without http if user only typed a domain — keep as-is
      return { name, url: url.startsWith('//') ? `https:${url}` : url };
    })
    .filter(Boolean);
}

// ─── Pages sync ───────────────────────────────────────────────────────────────

/**
 * Extract metadata from a Notion page in the Pages database.
 */
function extractPageMeta(page) {
  const props = page.properties;

  const titleProp = props.Title ?? props.title ?? props.Name;
  const title =
    titleProp?.title?.[0]?.plain_text ??
    titleProp?.rich_text?.[0]?.plain_text ??
    'Untitled';

  const slugProp = props.Slug ?? props.slug;
  const slug =
    slugProp?.rich_text?.[0]?.plain_text?.trim() ||
    titleToSlug(title);

  const typeProp = props.Type ?? props.type;
  const type = typeProp?.select?.name?.toLowerCase() ?? 'markdown';

  const navOrderProp = props['Nav Order'] ?? props['Nav order'] ?? props['Order'];
  const navOrder = navOrderProp?.number ?? 99;

  const showInNavProp = props['Show in Nav'] ?? props['Show In Nav'] ?? props['Nav'];
  const showInNav = showInNavProp?.checkbox ?? false;

  const descProp = props.Description ?? props.Excerpt ?? props.Summary;
  const description = descProp?.rich_text?.[0]?.plain_text?.trim() ?? '';

  // Home-specific properties
  // `Name` is the display name shown on the home page (separate from the page Title).
  // If not set, falls back to the page Title.
  const nameProp = props['Name'] ?? props['Display Name'] ?? props['Author Name'];
  const displayName = nameProp?.rich_text?.[0]?.plain_text?.trim() || title;

  const picProp = props['Profile Picture'] ?? props['Avatar'] ?? props['Photo'];
  const profile_picture = picProp?.rich_text?.[0]?.plain_text?.trim() ?? '';

  const taglineProp = props.Tagline ?? props['Short Bio'] ?? props.Subtitle;
  const tagline = taglineProp?.rich_text?.[0]?.plain_text?.trim() ?? '';

  const socialProp = props['Social Links'] ?? props['Socials'] ?? props['Links'];
  const socialRaw  = socialProp?.rich_text?.map((r) => r.plain_text).join('') ?? '';
  const social_links = parseSocialLinks(socialRaw);

  return { title, displayName, slug, type, navOrder, showInNav, description, profile_picture, tagline, social_links };
}

/**
 * Build Jekyll front matter for a regular page.
 */
function buildPageFrontMatter(meta, notionId, layout) {
  const lines = ['---'];
  lines.push(`layout: ${layout}`);
  lines.push(`title: ${yamlStr(meta.title)}`);
  lines.push(`slug: ${meta.slug}`);
  if (meta.description) lines.push(`description: ${yamlStr(meta.description)}`);
  lines.push(`notion_id: ${yamlStr(notionId)}`);
  lines.push('---');
  return lines.join('\n');
}

/**
 * Map a Notion page type to a Jekyll layout name.
 */
function typeToLayout(type) {
  switch (type) {
    case 'blog-list':
    case 'blog':
      return 'blog';
    case 'home':
      return 'home'; // handled separately
    default:
      return 'page';
  }
}

async function syncPages() {
  console.log('\n── Pages sync ────────────────────────────────────────────────');
  console.log(`   Database: ${PAGES_DB_ID}`);

  fs.mkdirSync(PAGES_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR,  { recursive: true });

  // Index existing _pages/ files by notion_id
  const existingFiles = fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith('.md'));
  const notionIdToFile = new Map();
  for (const file of existingFiles) {
    try {
      const content = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
      const match   = content.match(/^notion_id:\s*"?([a-f0-9-]{36})"?/m);
      if (match) notionIdToFile.set(match[1], file);
    } catch { /* skip */ }
  }

  let publishedPages;
  try {
    publishedPages = await fetchPublished(PAGES_DB_ID);
  } catch (err) {
    throw new Error(`Error querying pages database: ${err.message}`);
  }
  console.log(`   Published pages in Notion: ${publishedPages.length}\n`);
  const navItems     = [];
  let   homeData     = null;
  const processedIds = new Set();
  const stats        = { created: 0, updated: 0, renamed: 0, deleted: 0, unchanged: 0, errors: 0 };

  for (const page of publishedPages) {
    processedIds.add(page.id);

    let meta;
    try {
      meta = extractPageMeta(page);
    } catch (err) {
      console.error(`   [skip] Cannot read metadata for ${page.id}: ${err.message}`);
      stats.errors++;
      continue;
    }

    console.log(`   → "${meta.title}" (${meta.type}, /${meta.slug})`);

    // Accumulate nav
    if (meta.showInNav) {
      navItems.push({
        title: meta.title,
        url:   meta.type === 'home' ? '/' : `/${meta.slug}`,
        order: meta.navOrder,
      });
    }

    // Handle home type
    if (meta.type === 'home') {
      try {
        const blocks = await fetchAllBlocks(page.id);
        const bio    = blocksToMarkdown(blocks);
        homeData = {
          name:            meta.displayName,
          tagline:         meta.tagline,
          profile_picture: meta.profile_picture,
          social_links:    meta.social_links,
          bio,
          notion_id:       page.id,
        };
        console.log('     home data collected');
      } catch (err) {
        console.error(`     [error] ${err.message}`);
        stats.errors++;
      }
      continue; // don't write a _pages/ file for home
    }

    // Write _pages/{slug}.md
    try {
      const blocks  = await fetchAllBlocks(page.id);
      const body    = blocksToMarkdown(blocks);
      const layout  = typeToLayout(meta.type);
      const fm      = buildPageFrontMatter(meta, page.id, layout);
      const content = `${fm}\n\n${body}\n`;

      const filename    = `${meta.slug}.md`;
      const filePath    = path.join(PAGES_DIR, filename);

      // Handle slug rename
      const prevFilename = notionIdToFile.get(page.id);
      const renamed = Boolean(prevFilename && prevFilename !== filename);
      if (renamed) {
        try { fs.unlinkSync(path.join(PAGES_DIR, prevFilename)); } catch { /* gone */ }
        stats.renamed++;
        console.log(`     renamed: ${prevFilename} → ${filename}`);
      }

      let needsWrite = true;
      if (fs.existsSync(filePath)) {
        needsWrite = fs.readFileSync(filePath, 'utf8') !== content;
      }

      if (needsWrite) {
        fs.writeFileSync(filePath, content, 'utf8');
        // A rename already carries the write; don't also count it as created/updated.
        if (!renamed) {
          const isNew = !existingFiles.includes(filename);
          console.log(`     ${isNew ? 'created' : 'updated'}: _pages/${filename}`);
          isNew ? stats.created++ : stats.updated++;
        } else {
          console.log(`     wrote: _pages/${filename}`);
        }
      } else {
        console.log('     unchanged');
        stats.unchanged++;
      }
    } catch (err) {
      console.error(`     [error] ${err.message}`);
      stats.errors++;
    }
  }

  // Remove pages no longer published
  stats.deleted += applyDeletions(PAGES_DIR, 'pages', notionIdToFile, processedIds);

  // Write _data/nav.yml
  navItems.sort((a, b) => a.order - b.order);
  const navYaml = buildNavYaml(navItems);
  const navPath = path.join(DATA_DIR, 'nav.yml');
  const existingNav = fs.existsSync(navPath) ? fs.readFileSync(navPath, 'utf8') : '';
  let navChanged = false;
  if (existingNav !== navYaml) {
    fs.writeFileSync(navPath, navYaml, 'utf8');
    navChanged = true;
    console.log('\n   updated: _data/nav.yml');
  } else {
    console.log('\n   unchanged: _data/nav.yml');
  }

  // Write _data/home.yml (use existing if no home page found)
  let homeChanged   = false;
  let configChanged = false;
  if (homeData) {
    const homeYaml = buildHomeYaml(homeData);
    const homePath = path.join(DATA_DIR, 'home.yml');
    const existingHome = fs.existsSync(homePath) ? fs.readFileSync(homePath, 'utf8') : '';
    if (existingHome !== homeYaml) {
      fs.writeFileSync(homePath, homeYaml, 'utf8');
      homeChanged = true;
      console.log('   updated: _data/home.yml');
    } else {
      console.log('   unchanged: _data/home.yml');
    }

    configChanged = syncConfigIdentity(homeData.name);
  }

  console.log(`\n   Created: ${stats.created} | Updated: ${stats.updated} | Unchanged: ${stats.unchanged} | Errors: ${stats.errors}`);
  return { stats, navChanged, homeChanged, configChanged };
}

// ─── Posts sync ───────────────────────────────────────────────────────────────

function extractPostMeta(page) {
  const props = page.properties;

  const titleProp = props.Title ?? props.title ?? props.Name;
  const title =
    titleProp?.title?.[0]?.plain_text ??
    titleProp?.rich_text?.[0]?.plain_text ??
    'Untitled';

  const slugProp  = props.Slug ?? props.slug;
  const slug      = slugProp?.rich_text?.[0]?.plain_text?.trim() || titleToSlug(title);

  const dateProp  = props['Publish Date'] ?? props.Date ?? props.Published;
  const date      = dateProp?.date?.start ?? new Date().toISOString().split('T')[0];

  const tags      = (props.Tags?.multi_select ?? []).map((t) => t.name);

  const descProp  = props.Description ?? props.Excerpt ?? props.Summary;
  const description = descProp?.rich_text?.[0]?.plain_text?.trim() ?? '';

  const coverFiles  = props['Cover Image']?.files ?? [];
  const coverImage  =
    coverFiles[0]?.external?.url ??
    coverFiles[0]?.file?.url ??
    '';

  const canonicalUrl = props['Canonical URL']?.url ?? '';
  const featured     = props.Featured?.checkbox ?? false;

  return { title, slug, date, tags, description, coverImage, canonicalUrl, featured };
}

function buildPostFrontMatter(meta, notionId) {
  const lines = ['---'];
  lines.push(`layout: post`);
  lines.push(`title: ${yamlStr(meta.title)}`);
  lines.push(`date: ${meta.date}`);
  lines.push(`slug: ${meta.slug}`);
  if (meta.tags.length > 0) {
    lines.push(`tags: [${meta.tags.map(yamlStr).join(', ')}]`);
  }
  if (meta.description)  lines.push(`excerpt: ${yamlStr(meta.description)}`);
  if (meta.coverImage)   lines.push(`cover_image: ${yamlStr(meta.coverImage)}`);
  if (meta.canonicalUrl) lines.push(`canonical_url: ${yamlStr(meta.canonicalUrl)}`);
  if (meta.featured)     lines.push(`featured: true`);
  lines.push(`notion_id: ${yamlStr(notionId)}`);
  lines.push('---');
  return lines.join('\n');
}

function postFilename(date, slug) {
  return `${date}-${slug}.md`;
}

async function syncPosts() {
  console.log('\n── Posts sync ────────────────────────────────────────────────');
  console.log(`   Database: ${POSTS_DB_ID}`);

  fs.mkdirSync(POSTS_DIR, { recursive: true });

  const existingFiles  = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
  const notionIdToFile = new Map();
  for (const file of existingFiles) {
    try {
      const content = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
      const match   = content.match(/^notion_id:\s*"?([a-f0-9-]{36})"?/m);
      if (match) notionIdToFile.set(match[1], file);
    } catch { /* skip */ }
  }

  console.log(`   Existing posts in _posts/: ${existingFiles.length}`);

  let publishedPages;
  try {
    publishedPages = await fetchPublished(POSTS_DB_ID);
  } catch (err) {
    throw new Error(`Error querying posts database: ${err.message}`);
  }
  console.log(`   Published posts in Notion: ${publishedPages.length}\n`);

  const processedIds = new Set();
  const stats = { created: 0, updated: 0, renamed: 0, deleted: 0, unchanged: 0, errors: 0 };

  for (const page of publishedPages) {
    processedIds.add(page.id);

    let meta;
    try {
      meta = extractPostMeta(page);
    } catch (err) {
      console.error(`   [skip] Cannot read metadata for ${page.id}: ${err.message}`);
      stats.errors++;
      continue;
    }

    console.log(`   → "${meta.title}"`);

    try {
      const blocks   = await fetchAllBlocks(page.id);
      const body     = blocksToMarkdown(blocks);
      const fm       = buildPostFrontMatter(meta, page.id);
      const content  = `${fm}\n\n${body}\n`;
      const filename = postFilename(meta.date, meta.slug);
      const filePath = path.join(POSTS_DIR, filename);

      const prevFilename = notionIdToFile.get(page.id);
      const renamed = Boolean(prevFilename && prevFilename !== filename);
      if (renamed) {
        try { fs.unlinkSync(path.join(POSTS_DIR, prevFilename)); } catch { /* gone */ }
        stats.renamed++;
        console.log(`     renamed: ${prevFilename} → ${filename}`);
      }

      let needsWrite = true;
      if (fs.existsSync(filePath)) {
        needsWrite = fs.readFileSync(filePath, 'utf8') !== content;
      }

      if (needsWrite) {
        fs.writeFileSync(filePath, content, 'utf8');
        // A rename already carries the write; don't also count it as created/updated.
        if (!renamed) {
          const isNew = !existingFiles.includes(filename);
          console.log(`     ${isNew ? 'created' : 'updated'}: ${filename}`);
          isNew ? stats.created++ : stats.updated++;
        } else {
          console.log(`     wrote: ${filename}`);
        }
      } else {
        console.log('     unchanged');
        stats.unchanged++;
      }
    } catch (err) {
      console.error(`     [error] ${err.message}`);
      stats.errors++;
    }
  }

  // Remove unpublished posts
  stats.deleted += applyDeletions(POSTS_DIR, 'posts', notionIdToFile, processedIds);

  console.log(`\n   Created: ${stats.created} | Updated: ${stats.updated} | Unchanged: ${stats.unchanged} | Errors: ${stats.errors}`);
  return { stats, navChanged: false, homeChanged: false, configChanged: false };
}

// ─── Action outputs ───────────────────────────────────────────────────────────

/**
 * Fold per-section results into the two values the Action wrapper exposes.
 * `changed` is true when any tracked file was created, updated, renamed or
 * deleted, or any of the three data/config files was rewritten. `summary` is a
 * single non-secret line of counts (titles, IDs and tokens deliberately
 * excluded).
 */
function buildActionResult(sections) {
  let changed = false;
  const parts = [];

  for (const { label, stats, navChanged, homeChanged, configChanged } of sections) {
    if (stats.created || stats.updated || stats.renamed || stats.deleted ||
        navChanged || homeChanged || configChanged) {
      changed = true;
    }

    const counts = [
      `${stats.created} created`,
      `${stats.updated} updated`,
      `${stats.renamed} renamed`,
      `${stats.deleted} deleted`,
      `${stats.unchanged} unchanged`,
    ];
    if (stats.errors) counts.push(`${stats.errors} errors`);
    const section = `${label}: ${counts.join(', ')}`;

    const dataFiles = [
      navChanged    ? 'nav.yml'     : null,
      homeChanged   ? 'home.yml'    : null,
      configChanged ? '_config.yml' : null,
    ].filter(Boolean);
    parts.push(dataFiles.length ? `${section} (${dataFiles.join(', ')} updated)` : section);
  }

  if (sections.length === 0) parts.push('no sections synced');
  return { changed, summary: parts.join('; ') };
}

/**
 * Echo the run's `changed` / `summary` result and, when GITHUB_OUTPUT is set
 * (the Action wrapper's sync step), append both as step outputs. The summary
 * is counts only — credentials, database IDs and content never reach outputs.
 */
function writeActionOutputs(result) {
  console.log(`\n   changed: ${result.changed}`);
  console.log(`   summary: ${result.summary}`);

  const outPath = process.env.GITHUB_OUTPUT;
  if (!outPath) return;
  fs.appendFileSync(outPath, [
    `changed=${result.changed}`,
    'summary<<NOTIONGIT_SYNC_SUMMARY_EOF',
    result.summary,
    'NOTIONGIT_SYNC_SUMMARY_EOF',
    '',
  ].join('\n'));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(config) {
  initRun(config);
  console.log('Notion → Jekyll sync\n');

  const sections = [];

  if (PAGES_DB_ID) {
    sections.push({ label: 'pages', ...(await syncPages()) });
  } else {
    console.log('Skipping pages sync (NOTION_PAGES_DATABASE_ID not set).');
  }

  if (POSTS_DB_ID) {
    sections.push({ label: 'posts', ...(await syncPosts()) });
  } else {
    console.log('Skipping posts sync (NOTION_POSTS_DATABASE_ID / NOTION_DATABASE_ID not set).');
  }

  return sections;
}

async function main() {
  let config;
  try {
    config = resolveConfig();
  } catch (err) {
    // Only a recognized missing-credentials shape is a no-op; anything else
    // resolveConfig might throw is a real defect and must still fail loudly.
    if (!(err instanceof ConfigError)) throw err;

    // No usable Notion credentials yet — most commonly a freshly generated
    // repository whose provisioning hasn't written secrets before its first
    // scheduled run. That is not a failure: exit 0 with an explicit no-op
    // rather than a red run, so scheduling ahead of provisioning is safe.
    console.log(`Notion sync skipped: ${err.message}`);
    console.log(
      'Configure NOTION_TOKEN and at least one of NOTION_PAGES_DATABASE_ID / ' +
      'NOTION_POSTS_DATABASE_ID (repository secrets/variables), then re-run this workflow.'
    );
    writeActionOutputs({ changed: false, summary: `skipped: ${err.message}` });
    return;
  }

  let sections;
  try {
    sections = await run(config);
  } catch (err) {
    // A section threw mid-run (a database query failed, or the bulk-delete
    // guard tripped) — the run did not finish, so no outputs are written.
    // Files already rewritten earlier in this pass (or by a slug rename) may
    // remain on disk as uncommitted changes; the next successful sync
    // reconciles them, and the consumer's commit step never runs off a
    // partial/inaccurate summary in the meantime.
    console.error(`\nFatal: ${err.message}`);
    process.exit(1);
  }

  const totalErrors = sections.reduce((n, s) => n + s.stats.errors, 0);

  console.log('\n─────────────────────────────────────────────────────────────');
  writeActionOutputs(buildActionResult(sections));

  if (totalErrors > 0) {
    console.error(`Sync finished with ${totalErrors} error(s). See above for details.`);
    process.exit(1);
  }
  console.log('Sync complete.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nFatal: ${err.message}`);
    process.exit(1);
  });
}

// Exposed for tests: input mapping/normalization, output emission and result
// folding — all pure or env-driven. The sync itself is exercised end-to-end by
// the harness in test/ against a local fake Notion API.
module.exports = {
  ConfigError,
  isTrue,
  resolveConfig,
  buildActionResult,
  writeActionOutputs,
};
