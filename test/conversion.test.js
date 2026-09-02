/**
 * Deterministic unit tests for the pure Notion → Jekyll conversion logic:
 * rich text annotations, block-to-Markdown mapping (including list grouping),
 * slugging, and front-matter/filename building.
 *
 * Every function here takes plain data in and returns a value — no Notion
 * client, no filesystem, no network. The full pipeline (pagination included)
 * is exercised end-to-end by test/harness.test.js against a local fake API.
 */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('../scripts/sync-notion.js');

// ─── richTextToMarkdown ────────────────────────────────────────────────────────

describe('richTextToMarkdown', () => {
  const item = (plain_text, annotations = {}, href = null) => ({ plain_text, annotations, href });

  it('returns an empty string for an empty array', () => {
    expect(engine.richTextToMarkdown([])).toBe('');
  });

  it('defaults to an empty array when called with no argument', () => {
    expect(engine.richTextToMarkdown()).toBe('');
  });

  it('passes plain text through unchanged', () => {
    expect(engine.richTextToMarkdown([item('hello world')])).toBe('hello world');
  });

  it('skips items with empty plain_text without adding stray annotations', () => {
    expect(engine.richTextToMarkdown([item(''), item('kept')])).toBe('kept');
  });

  it.each([
    ['bold', { bold: true }, '**x**'],
    ['italic', { italic: true }, '*x*'],
    ['bold + italic (combined, not nested doubling)', { bold: true, italic: true }, '***x***'],
    ['strikethrough', { strikethrough: true }, '~~x~~'],
    ['code', { code: true }, '`x`'],
  ])('applies %s annotation', (_name, annotations, expected) => {
    expect(engine.richTextToMarkdown([item('x', annotations)])).toBe(expected);
  });

  it('wraps in a link when href is set, around any annotations already applied', () => {
    expect(engine.richTextToMarkdown([item('x', { bold: true }, 'https://example.com')]))
      .toBe('[**x**](https://example.com)');
  });

  it('stacks bold+italic, strikethrough and a link in application order: emphasis, then strikethrough, then the link wraps everything', () => {
    expect(engine.richTextToMarkdown([
      item('x', { bold: true, italic: true, strikethrough: true }, 'https://example.com'),
    ])).toBe('[~~***x***~~](https://example.com)');
  });

  it('joins multiple rich text items with no separator, each independently annotated', () => {
    expect(engine.richTextToMarkdown([
      item('plain '),
      item('bold', { bold: true }),
      item(' and '),
      item('linked', {}, 'https://example.com'),
    ])).toBe('plain **bold** and [linked](https://example.com)');
  });
});

// ─── blockToMarkdown ───────────────────────────────────────────────────────────

const rt = (text, annotations = {}, href = null) => [{ plain_text: text, annotations, href }];

describe('blockToMarkdown', () => {
  it('returns null when the block has no data for its declared type', () => {
    expect(engine.blockToMarkdown({ type: 'paragraph' })).toBeNull();
  });

  it('returns null for an unrecognized block type', () => {
    expect(engine.blockToMarkdown({ type: 'unsupported_future_block', unsupported_future_block: {} }))
      .toBeNull();
  });

  it.each([
    ['child_page', { child_page: { title: 'x' } }],
    ['child_database', { child_database: { title: 'x' } }],
  ])('returns null for %s (not representable as page content)', (type, extra) => {
    expect(engine.blockToMarkdown({ type, ...extra })).toBeNull();
  });

  it('renders table_of_contents as an empty string (dropped, not skipped-with-gap)', () => {
    expect(engine.blockToMarkdown({ type: 'table_of_contents', table_of_contents: {} })).toBe('');
  });

  it('paragraph renders bare rich text', () => {
    expect(engine.blockToMarkdown({ type: 'paragraph', paragraph: { rich_text: rt('hello') } }))
      .toBe('hello');
  });

  it.each([
    ['heading_1', '#'],
    ['heading_2', '##'],
    ['heading_3', '###'],
  ])('%s prefixes with %s', (type, prefix) => {
    expect(engine.blockToMarkdown({ type, [type]: { rich_text: rt('Title') } }))
      .toBe(`${prefix} Title`);
  });

  it('bulleted_list_item renders a dash item', () => {
    expect(engine.blockToMarkdown({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('a') } }))
      .toBe('- a');
  });

  it('numbered_list_item always renders as "1." (Jekyll/Markdown renumbers on output)', () => {
    expect(engine.blockToMarkdown({ type: 'numbered_list_item', numbered_list_item: { rich_text: rt('a') } }))
      .toBe('1. a');
  });

  it.each([
    [true, '- [x] done'],
    [false, '- [ ] not done'],
  ])('to_do checked=%s renders a GFM task item', (checked, expected) => {
    expect(engine.blockToMarkdown({
      type: 'to_do',
      to_do: { checked, rich_text: rt(checked ? 'done' : 'not done') },
    })).toBe(expected);
  });

  it('code fences the raw text (not rich-text-annotated) with the language tag', () => {
    expect(engine.blockToMarkdown({
      type: 'code',
      code: { language: 'javascript', rich_text: rt('const x = 1;') },
    })).toBe('```javascript\nconst x = 1;\n```');
  });

  it('code omits the language tag for "plain text"', () => {
    expect(engine.blockToMarkdown({
      type: 'code',
      code: { language: 'plain text', rich_text: rt('hi') },
    })).toBe('```\nhi\n```');
  });

  it('code appends an italicized caption line when present', () => {
    expect(engine.blockToMarkdown({
      type: 'code',
      code: { language: 'bash', rich_text: rt('echo hi'), caption: rt('a caption') },
    })).toBe('```bash\necho hi\n```\n*a caption*');
  });

  it('quote prefixes with >', () => {
    expect(engine.blockToMarkdown({ type: 'quote', quote: { rich_text: rt('quoted') } }))
      .toBe('> quoted');
  });

  it('callout prefixes with > and an emoji icon when present', () => {
    expect(engine.blockToMarkdown({
      type: 'callout',
      callout: { icon: { emoji: '💡' }, rich_text: rt('tip') },
    })).toBe('> 💡 tip');
  });

  it('callout without an icon omits the emoji prefix', () => {
    expect(engine.blockToMarkdown({ type: 'callout', callout: { rich_text: rt('tip') } }))
      .toBe('> tip');
  });

  it('divider renders a bare rule', () => {
    expect(engine.blockToMarkdown({ type: 'divider', divider: {} })).toBe('---');
  });

  it('image prefers the external url and falls back to file url', () => {
    expect(engine.blockToMarkdown({
      type: 'image',
      image: { type: 'external', external: { url: 'https://example.com/a.png' }, caption: rt('alt text') },
    })).toBe('![alt text](https://example.com/a.png)');

    expect(engine.blockToMarkdown({
      type: 'image',
      image: { type: 'file', file: { url: 'https://files.example.com/b.png' } },
    })).toBe('![](https://files.example.com/b.png)');
  });

  it('video renders a play-arrow link, with or without a caption', () => {
    expect(engine.blockToMarkdown({
      type: 'video',
      video: { type: 'external', external: { url: 'https://example.com/v.mp4' }, caption: rt('demo') },
    })).toBe('[▶ demo](https://example.com/v.mp4)');

    expect(engine.blockToMarkdown({
      type: 'video',
      video: { type: 'external', external: { url: 'https://example.com/v.mp4' } },
    })).toBe('[▶ Watch video](https://example.com/v.mp4)');
  });

  it.each(['bookmark', 'link_preview'])('%s renders the url as its own link text', (type) => {
    expect(engine.blockToMarkdown({ type, [type]: { url: 'https://example.com' } }))
      .toBe('[https://example.com](https://example.com)');
  });

  it('toggle renders a collapsed <details> with an empty body (children not fetched)', () => {
    expect(engine.blockToMarkdown({ type: 'toggle', toggle: { rich_text: rt('More') } }))
      .toBe('<details>\n<summary>More</summary>\n\n</details>');
  });
});

// ─── blocksToMarkdown: list grouping ────────────────────────────────────────────

describe('blocksToMarkdown (list grouping and blank-line separation)', () => {
  const para = (t) => ({ type: 'paragraph', paragraph: { rich_text: rt(t) } });
  const bullet = (t) => ({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(t) } });
  const numbered = (t) => ({ type: 'numbered_list_item', numbered_list_item: { rich_text: rt(t) } });
  const todo = (t) => ({ type: 'to_do', to_do: { checked: false, rich_text: rt(t) } });
  const heading = (t) => ({ type: 'heading_2', heading_2: { rich_text: rt(t) } });

  it('returns an empty string for no blocks', () => {
    expect(engine.blocksToMarkdown([])).toBe('');
  });

  it('separates ordinary blocks with a blank line', () => {
    expect(engine.blocksToMarkdown([para('one'), para('two')])).toBe('one\n\ntwo');
  });

  it('keeps consecutive bulleted list items adjacent, with no blank line between them', () => {
    expect(engine.blocksToMarkdown([bullet('a'), bullet('b'), bullet('c')]))
      .toBe('- a\n- b\n- c');
  });

  it('keeps consecutive numbered list items adjacent', () => {
    expect(engine.blocksToMarkdown([numbered('a'), numbered('b')]))
      .toBe('1. a\n1. b');
  });

  it('groups across differing list types too — grouping keys off "is this any list item", not the specific type', () => {
    expect(engine.blocksToMarkdown([bullet('a'), numbered('b')]))
      .toBe('- a\n1. b');
  });

  it('groups to_do items as a list type too', () => {
    expect(engine.blocksToMarkdown([todo('a'), todo('b')]))
      .toBe('- [ ] a\n- [ ] b');
  });

  it('separates a list from surrounding paragraphs with blank lines on both sides', () => {
    expect(engine.blocksToMarkdown([para('intro'), bullet('a'), bullet('b'), para('outro')]))
      .toBe('intro\n\n- a\n- b\n\noutro');
  });

  it('mixes headings and paragraphs with blank-line separation throughout', () => {
    expect(engine.blocksToMarkdown([heading('Section'), para('body')]))
      .toBe('## Section\n\nbody');
  });

  it('drops blocks that render to null without leaving a stray blank line', () => {
    const unsupported = { type: 'child_database', child_database: { title: 'x' } };
    expect(engine.blocksToMarkdown([para('before'), unsupported, para('after')]))
      .toBe('before\n\nafter');
  });

  it('drops a leading null block entirely (no leading blank line)', () => {
    const unsupported = { type: 'child_page', child_page: { title: 'x' } };
    expect(engine.blocksToMarkdown([unsupported, para('only')])).toBe('only');
  });

  it('a mid-document block that maps to "" (table_of_contents) still consumes a separator slot, doubling the blank line', () => {
    // Documents current behavior, not necessarily ideal: unlike a null-returning
    // block (skipped via `continue` before the separator logic runs), an
    // empty-string block still reaches the "push a blank separator" branch —
    // it just contributes no content of its own.
    expect(engine.blocksToMarkdown([
      para('before'),
      { type: 'table_of_contents', table_of_contents: {} },
      para('after'),
    ])).toBe('before\n\n\nafter');
  });

  it('trims a trailing "" block (table_of_contents) off the assembled body instead of leaving a dangling blank line', () => {
    expect(engine.blocksToMarkdown([
      para('content'),
      { type: 'table_of_contents', table_of_contents: {} },
    ])).toBe('content');
  });

  it('trims a leading "" block (table_of_contents) off the assembled body', () => {
    expect(engine.blocksToMarkdown([
      { type: 'table_of_contents', table_of_contents: {} },
      para('content'),
    ])).toBe('content');
  });
});

// ─── titleToSlug ────────────────────────────────────────────────────────────────

describe('titleToSlug', () => {
  it.each([
    ['Hello World', 'hello-world'],
    ['  Leading and trailing spaces  ', 'leading-and-trailing-spaces'],
    ['Punctuation! Is? Gone.', 'punctuation-is-gone'],
    ['Multiple   Internal    Spaces', 'multiple-internal-spaces'],
    ['Already-Hyphenated-Title', 'already-hyphenated-title'],
    ['--Leading and trailing dashes--', 'leading-and-trailing-dashes'],
    ['UPPERCASE TITLE', 'uppercase-title'],
    ['Under_scores_stay', 'under_scores_stay'],
    ['Numbers 123 Stay', 'numbers-123-stay'],
    ["Apostrophe's and \"quotes\"", 'apostrophes-and-quotes'],
    ['Collapses -- multiple -- dashes', 'collapses-multiple-dashes'],
  ])('titleToSlug(%j) → %j', (title, expected) => {
    expect(engine.titleToSlug(title)).toBe(expected);
  });
});

// ─── typeToLayout ───────────────────────────────────────────────────────────────

describe('typeToLayout', () => {
  it.each([
    ['blog-list', 'blog'],
    ['blog', 'blog'],
    ['home', 'home'],
    ['markdown', 'page'],
    ['anything-unrecognized', 'page'],
    [undefined, 'page'],
  ])('typeToLayout(%j) → %j', (type, expected) => {
    expect(engine.typeToLayout(type)).toBe(expected);
  });
});

// ─── buildPageFrontMatter ───────────────────────────────────────────────────────

describe('buildPageFrontMatter', () => {
  it('renders the required fields in a fixed order, quoting title', () => {
    const meta = { title: 'About', slug: 'about', description: '' };
    expect(engine.buildPageFrontMatter(meta, 'notion-id-123', 'page')).toBe(
      '---\n' +
      'layout: page\n' +
      'title: "About"\n' +
      'slug: about\n' +
      'notion_id: "notion-id-123"\n' +
      '---'
    );
  });

  it('inserts an optional description line only when present', () => {
    const meta = { title: 'About', slug: 'about', description: 'A short blurb' };
    const fm = engine.buildPageFrontMatter(meta, 'id', 'page');
    expect(fm).toContain('description: "A short blurb"');
    // Placed between slug and notion_id.
    expect(fm.split('\n').indexOf('description: "A short blurb"'))
      .toBe(fm.split('\n').indexOf('slug: about') + 1);
  });

  it('JSON-escapes quotes inside the title', () => {
    const meta = { title: 'A "quoted" title', slug: 'x', description: '' };
    expect(engine.buildPageFrontMatter(meta, 'id', 'page')).toContain('title: "A \\"quoted\\" title"');
  });
});

// ─── buildPostFrontMatter / postFilename ────────────────────────────────────────

describe('buildPostFrontMatter', () => {
  const baseMeta = () => ({
    title: 'Hello World',
    date: '2026-01-15',
    slug: 'hello-world',
    tags: [],
    description: '',
    coverImage: '',
    canonicalUrl: '',
    featured: false,
  });

  it('renders only the required fields when all optional metadata is empty', () => {
    expect(engine.buildPostFrontMatter(baseMeta(), 'id')).toBe(
      '---\n' +
      'layout: post\n' +
      'title: "Hello World"\n' +
      'date: 2026-01-15\n' +
      'slug: hello-world\n' +
      'notion_id: "id"\n' +
      '---'
    );
  });

  it('renders tags as a quoted YAML flow sequence', () => {
    const meta = { ...baseMeta(), tags: ['notion', 'jekyll'] };
    expect(engine.buildPostFrontMatter(meta, 'id')).toContain('tags: ["notion", "jekyll"]');
  });

  it('omits the tags line entirely when there are none', () => {
    expect(engine.buildPostFrontMatter(baseMeta(), 'id')).not.toContain('tags:');
  });

  it('includes excerpt, cover_image and canonical_url only when set', () => {
    const meta = {
      ...baseMeta(),
      description: 'An excerpt',
      coverImage: 'https://example.com/cover.png',
      canonicalUrl: 'https://example.com/original',
    };
    const fm = engine.buildPostFrontMatter(meta, 'id');
    expect(fm).toContain('excerpt: "An excerpt"');
    expect(fm).toContain('cover_image: "https://example.com/cover.png"');
    expect(fm).toContain('canonical_url: "https://example.com/original"');
  });

  it('adds a bare "featured: true" line only when featured, never "featured: false"', () => {
    expect(engine.buildPostFrontMatter({ ...baseMeta(), featured: true }, 'id')).toContain('featured: true');
    expect(engine.buildPostFrontMatter(baseMeta(), 'id')).not.toContain('featured');
  });
});

describe('postFilename', () => {
  it('joins date and slug with a Jekyll-style dated filename', () => {
    expect(engine.postFilename('2026-01-15', 'hello-world')).toBe('2026-01-15-hello-world.md');
  });
});
