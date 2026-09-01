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
 *   ALLOW_BULK_DELETE          — Set to "true" to bypass the bulk-delete guard
 *   MAX_DELETE_RATIO           — Fraction of tracked files a single sync may
 *                                delete before the guard trips (default 0.5)
 *
 * At least one of NOTION_PAGES_DATABASE_ID or NOTION_POSTS_DATABASE_ID
 * (/ NOTION_DATABASE_ID) must be set.
 */

'use strict';

const { Client } = require('@notionhq/client');
const fs   = require('fs');
const path = require('path');

// ─── Environment ──────────────────────────────────────────────────────────────

const NOTION_TOKEN      = process.env.NOTION_TOKEN;
const PAGES_DB_ID       = process.env.NOTION_PAGES_DATABASE_ID;
const POSTS_DB_ID       = process.env.NOTION_POSTS_DATABASE_ID || process.env.NOTION_DATABASE_ID;
const ALLOW_BULK_DELETE = process.env.ALLOW_BULK_DELETE === 'true';
const MAX_DELETE_RATIO  = Number(process.env.MAX_DELETE_RATIO) || 0.5;

if (!NOTION_TOKEN) {
  console.error('Error: NOTION_TOKEN environment variable is not set.');
  process.exit(1);
}
if (!PAGES_DB_ID && !POSTS_DB_ID) {
  console.error('Error: Set NOTION_PAGES_DATABASE_ID and/or NOTION_POSTS_DATABASE_ID.');
  process.exit(1);
}

const notion    = new Client({ auth: NOTION_TOKEN });
const ROOT_DIR  = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT_DIR, '_posts');
const PAGES_DIR = path.join(ROOT_DIR, '_pages');
const DATA_DIR  = path.join(ROOT_DIR, '_data');

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
 */
function applyDeletions(dir, label, notionIdToFile, processedIds) {
  const stale = [...notionIdToFile].filter(([id]) => !processedIds.has(id));
  if (stale.length === 0) return;

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

  for (const [, filename] of stale) {
    try {
      fs.unlinkSync(path.join(dir, filename));
      console.log(`\n   removed (unpublished): ${filename}`);
    } catch {
      console.warn(`   Warning: could not remove ${filename}`);
    }
  }
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
 */
function syncConfigIdentity(name) {
  if (!name) return;

  const configPath = path.join(ROOT_DIR, '_config.yml');
  let original;
  try {
    original = fs.readFileSync(configPath, 'utf8');
  } catch {
    console.warn('   Warning: _config.yml not readable — site title left unchanged.');
    return;
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
    return;
  }
  fs.writeFileSync(configPath, updated, 'utf8');
  console.log(`   updated: _config.yml (site title → ${name})`);
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
    console.error(`   Error querying pages database: ${err.message}`);
    process.exit(1);
  }
  console.log(`   Published pages in Notion: ${publishedPages.length}\n`);

  const navItems     = [];
  let   homeData     = null;
  const processedIds = new Set();
  const stats        = { created: 0, updated: 0, unchanged: 0, errors: 0 };

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
      if (prevFilename && prevFilename !== filename) {
        try { fs.unlinkSync(path.join(PAGES_DIR, prevFilename)); } catch { /* gone */ }
        console.log(`     renamed: ${prevFilename} → ${filename}`);
      }

      let needsWrite = true;
      if (fs.existsSync(filePath)) {
        needsWrite = fs.readFileSync(filePath, 'utf8') !== content;
      }

      if (needsWrite) {
        fs.writeFileSync(filePath, content, 'utf8');
        const isNew = !prevFilename && !existingFiles.includes(filename);
        console.log(`     ${isNew ? 'created' : 'updated'}: _pages/${filename}`);
        isNew ? stats.created++ : stats.updated++;
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
  applyDeletions(PAGES_DIR, 'pages', notionIdToFile, processedIds);

  // Write _data/nav.yml
  navItems.sort((a, b) => a.order - b.order);
  const navYaml = buildNavYaml(navItems);
  const navPath = path.join(DATA_DIR, 'nav.yml');
  const existingNav = fs.existsSync(navPath) ? fs.readFileSync(navPath, 'utf8') : '';
  if (existingNav !== navYaml) {
    fs.writeFileSync(navPath, navYaml, 'utf8');
    console.log('\n   updated: _data/nav.yml');
  } else {
    console.log('\n   unchanged: _data/nav.yml');
  }

  // Write _data/home.yml (use existing if no home page found)
  if (homeData) {
    const homeYaml = buildHomeYaml(homeData);
    const homePath = path.join(DATA_DIR, 'home.yml');
    const existingHome = fs.existsSync(homePath) ? fs.readFileSync(homePath, 'utf8') : '';
    if (existingHome !== homeYaml) {
      fs.writeFileSync(homePath, homeYaml, 'utf8');
      console.log('   updated: _data/home.yml');
    } else {
      console.log('   unchanged: _data/home.yml');
    }

    syncConfigIdentity(homeData.name);
  }

  console.log(`\n   Created: ${stats.created} | Updated: ${stats.updated} | Unchanged: ${stats.unchanged} | Errors: ${stats.errors}`);
  return stats.errors;
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
    console.error(`   Error querying posts database: ${err.message}`);
    process.exit(1);
  }
  console.log(`   Published posts in Notion: ${publishedPages.length}\n`);

  const processedIds = new Set();
  const stats = { created: 0, updated: 0, unchanged: 0, errors: 0 };

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
      if (prevFilename && prevFilename !== filename) {
        try { fs.unlinkSync(path.join(POSTS_DIR, prevFilename)); } catch { /* gone */ }
        console.log(`     renamed: ${prevFilename} → ${filename}`);
      }

      let needsWrite = true;
      if (fs.existsSync(filePath)) {
        needsWrite = fs.readFileSync(filePath, 'utf8') !== content;
      }

      if (needsWrite) {
        fs.writeFileSync(filePath, content, 'utf8');
        const isNew = !prevFilename && !existingFiles.includes(filename);
        console.log(`     ${isNew ? 'created' : 'updated'}: ${filename}`);
        isNew ? stats.created++ : stats.updated++;
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
  applyDeletions(POSTS_DIR, 'posts', notionIdToFile, processedIds);

  console.log(`\n   Created: ${stats.created} | Updated: ${stats.updated} | Unchanged: ${stats.unchanged} | Errors: ${stats.errors}`);
  return stats.errors;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Notion → Jekyll sync\n');

  let totalErrors = 0;

  if (PAGES_DB_ID) {
    totalErrors += await syncPages();
  } else {
    console.log('Skipping pages sync (NOTION_PAGES_DATABASE_ID not set).');
  }

  if (POSTS_DB_ID) {
    totalErrors += await syncPosts();
  } else {
    console.log('Skipping posts sync (NOTION_POSTS_DATABASE_ID / NOTION_DATABASE_ID not set).');
  }

  console.log('\n─────────────────────────────────────────────────────────────');
  if (totalErrors > 0) {
    console.error(`Sync finished with ${totalErrors} error(s). See above for details.`);
    process.exit(1);
  } else {
    console.log('Sync complete.');
  }
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
