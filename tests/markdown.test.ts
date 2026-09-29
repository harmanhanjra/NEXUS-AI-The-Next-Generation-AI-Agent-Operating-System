import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../lib/markdown.ts';

describe('renderMarkdown security', () => {
  test('escapes script tags and raw HTML', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('escapes HTML inside code fences', () => {
    const html = renderMarkdown('```\n<img src=x onerror=alert(1)>\n```');
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
  });

  test('refuses javascript: and data: links but keeps their label', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))');
    assert.ok(!html.toLowerCase().includes('javascript:'));
    assert.ok(html.includes('click me'));
  });

  test('allows safe http links with noopener', () => {
    const html = renderMarkdown('[docs](https://example.com)');
    assert.ok(html.includes('href="https://example.com"'));
    assert.ok(html.includes('rel="noopener noreferrer"'));
  });

  test('escapes quotes so attributes cannot be broken out of', () => {
    const html = renderMarkdown('[x](https://example.com"onmouseover="alert(1))');
    assert.ok(!html.includes('onmouseover="alert'));
  });
});

describe('renderMarkdown formatting', () => {
  test('renders headings, bold, italic, and lists', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and *italic* text\n\n- one\n- two');
    assert.ok(html.includes('<h1>Title</h1>'));
    assert.ok(html.includes('<strong>bold</strong>'));
    assert.ok(html.includes('<em>italic</em>'));
    assert.ok(html.includes('<li>one</li>'));
  });

  test('renders ordered lists', () => {
    const html = renderMarkdown('1. first\n2. second');
    assert.ok(html.includes('<ol>'));
    assert.ok(html.includes('<li>first</li>'));
  });

  test('preserves fenced code blocks verbatim and does not format inside them', () => {
    const html = renderMarkdown('```ts\nconst a = **1**;\n```');
    assert.ok(html.includes('<pre>'));
    assert.ok(html.includes('class="lang-ts"'));
    assert.ok(html.includes('const a = **1**;'));
  });

  test('renders inline code', () => {
    assert.ok(renderMarkdown('use `npm test` here').includes('<code>npm test</code>'));
  });

  test('handles empty input', () => {
    assert.equal(renderMarkdown(''), '');
  });
});
