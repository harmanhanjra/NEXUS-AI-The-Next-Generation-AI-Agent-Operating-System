// Tiny dependency-free markdown renderer (safe subset).
// Handles: headings, bold, italic, code (inline + fenced), lists, links, paragraphs.

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function renderMarkdown(md: string): string {
  if (!md) return '';
  let src = md.replace(/\r\n/g, '\n');

  // Extract fenced code blocks first (preserve them)
  const codeBlocks: string[] = [];
  src = src.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push(`<pre><code class="lang-${escapeHtml(lang)}">${escapeHtml(code)}</code></pre>`);
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });

  // Escape everything else
  src = escapeHtml(src);

  // Headings
  src = src.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  src = src.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  src = src.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  src = src.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  src = src.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  src = src.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Inline code
  src = src.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Links [text](url)
  src = src.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Lists (process line-by-line)
  const lines = src.split('\n');
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  for (const line of lines) {
    const ulMatch = line.match(/^[-*]\s+(.*)$/);
    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (ulMatch) {
      if (!inUl) { if (inOl) { out.push('</ol>'); inOl = false; } out.push('<ul>'); inUl = true; }
      out.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (!inOl) { if (inUl) { out.push('</ul>'); inUl = false; } out.push('<ol>'); inOl = true; }
      out.push(`<li>${olMatch[1]}</li>`);
    } else {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
      out.push(line);
    }
  }
  if (inUl) out.push('</ul>');
  if (inOl) out.push('</ol>');
  src = out.join('\n');

  // Paragraphs: wrap consecutive non-empty lines not already in a block
  src = src
    .split(/\n{2,}/)
    .map(block => {
      if (/^\s*<(h\d|ul|ol|pre|blockquote)/.test(block)) return block;
      if (block.includes('\u0000CODE')) return block;
      const trimmed = block.trim();
      if (!trimmed) return '';
      return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('\n');

  // Restore code blocks
  src = src.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeBlocks[parseInt(i)]);

  return src;
}
