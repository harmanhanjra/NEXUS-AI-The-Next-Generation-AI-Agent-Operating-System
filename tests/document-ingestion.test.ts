import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createExtractiveSummary, extractDocument, citationLabel, type IngestedChunk } from '../lib/document-ingestion.ts';

describe('extractDocument for text and markdown', () => {
  test('extracts and chunks a markdown file into sections', async () => {
    const bytes = new TextEncoder().encode('# Overview\n\nThis is the summary section with enough words to be indexed.\n\n# Details\n\nSecond section describing the architecture and its tradeoffs.');
    const result = await extractDocument('notes.md', bytes);
    assert.ok(result.chunks.length >= 2, 'should produce more than one chunk');
    assert.ok(result.outline.some((section) => /Overview/.test(section)));
    assert.equal(result.sha256.length, 64);
  });

  test('rejects a binary file type it cannot read', async () => {
    await assert.rejects(() => extractDocument('image.png', new Uint8Array([1, 2, 3])), /Unsupported file type/);
  });
  test('keeps CSV column labels and values together', async () => {
    const result = await extractDocument('budget.csv', new TextEncoder().encode('Project,Allocation,Owner\nMaple,7300,Dev\n'));
    assert.ok(result.chunks.some((chunk) => chunk.text.includes('Maple') && chunk.text.includes('7300') && chunk.text.includes('Allocation')));
    assert.equal(result.chunks.find((chunk) => chunk.text.includes('Maple'))?.sheetName, 'Sheet1');
  });

  test('rejects an empty text file', async () => {
    await assert.rejects(() => extractDocument('empty.txt', new Uint8Array()), /No readable text/);
  });

  test('splits a long text into multiple readable chunks', async () => {
    const long = Array.from({ length: 400 }, (_, i) => `This is sentence number ${i} in a long document body.`).join(' ');
    const result = await extractDocument('long.txt', new TextEncoder().encode(long));
    assert.ok(result.chunks.length > 1, 'a long file should be split into multiple chunks');
  });
  test('keeps the end of long unbroken text and overlaps chunk boundaries', async () => {
    const text = 'a'.repeat(4000) + 'TAIL_VERIFICATION';
    const result = await extractDocument('code.txt', new TextEncoder().encode(text));
    assert.ok(result.chunks.at(-1)?.text.endsWith('TAIL_VERIFICATION'));
    assert.ok(result.chunks.every((chunk) => chunk.text.length <= 1100));
    assert.equal(result.chunks[0].text.slice(-120), result.chunks[1].text.slice(0, 120));
  });
});

describe('citationLabel', () => {
  const base: IngestedChunk = { text: 'x', section: 'Intro', pageNumber: null, slideNumber: null, sheetName: null };

  test('prefers page, then slide, then sheet, then section', () => {
    assert.equal(citationLabel({ ...base, pageNumber: 3 }, 1), 'p. 3');
    assert.equal(citationLabel({ ...base, slideNumber: 2 }, 1), 'slide 2');
    assert.equal(citationLabel({ ...base, sheetName: 'Data' }, 1), 'sheet Data');
    assert.equal(citationLabel(base, 1), 'Intro, part 1');
  });
});

describe('createExtractiveSummary', () => {
  test('produces a brief from the chunks', () => {
    const chunks: IngestedChunk[] = [
      { text: 'The first part explains the setup.', section: 'Setup', pageNumber: null, slideNumber: null, sheetName: null },
      { text: 'The second part covers deployment.', section: 'Deployment', pageNumber: null, slideNumber: null, sheetName: null },
    ];
    const summary = createExtractiveSummary(chunks);
    assert.ok(summary.includes('Brief'));
    assert.ok(summary.includes('Setup'));
    assert.ok(summary.includes('Deployment'));
  });
});
