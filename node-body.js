/**
 * MarkMind — Node Body Renderer
 *
 * Renders the structured `body` blocks attached to each heading node
 * (lists, code blocks, paragraphs) into HTML for display inside the
 * mind map canvas.
 *
 * Used by:
 *   - layout.js  → measure body card size before layout
 *   - renderer.js → render the actual body card via foreignObject
 */

const NodeBodyRenderer = (() => {

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Render inline markdown (bold/italic/code/latex) into safe HTML.
   */
  function renderInline(text) {
    if (typeof MarkdownParser === 'undefined') return escapeHtml(text);

    let out = '';

    // Step 1: extract LaTeX segments first so they don't interfere with
    // markdown formatting.
    const latexSegments = MarkdownParser.hasLatex(text)
      ? MarkdownParser.parseLatexSegments(text)
      : [{ type: 'text', content: text }];

    for (const seg of latexSegments) {
      if (seg.type === 'text') {
        out += renderInlineMarkdown(seg.content);
      } else if (seg.type === 'inline' || seg.type === 'display') {
        out += renderLatex(seg.content, seg.type === 'display');
      }
    }
    return out;
  }

  function renderInlineMarkdown(text) {
    const segments = MarkdownParser.parseInlineMarkdown(text);
    let out = '';
    for (const seg of segments) {
      if (seg.type === 'text') {
        out += escapeHtml(seg.content);
      } else if (seg.type === 'bold') {
        out += `<strong>${escapeHtml(seg.content)}</strong>`;
      } else if (seg.type === 'italic') {
        out += `<em>${escapeHtml(seg.content)}</em>`;
      } else if (seg.type === 'bold-italic') {
        out += `<strong><em>${escapeHtml(seg.content)}</em></strong>`;
      } else if (seg.type === 'code') {
        out += `<code class="mm-body-inline-code">${escapeHtml(seg.content)}</code>`;
      }
    }
    return out;
  }

  function renderLatex(content, displayMode) {
    if (typeof katex === 'undefined') {
      return `<span class="mm-body-latex-fallback">${escapeHtml(content)}</span>`;
    }
    try {
      const html = katex.renderToString(content, {
        throwOnError: false,
        displayMode,
      });
      return `<span class="mm-body-latex${displayMode ? ' mm-body-latex-display' : ''}">${html}</span>`;
    } catch (_) {
      return `<span class="mm-body-latex-fallback">${escapeHtml(content)}</span>`;
    }
  }

  /**
   * Render a list block (with possible nesting) to HTML.
   */
  function renderList(items, ordered = false) {
    if (!items || items.length === 0) return '';
    const tag = ordered ? 'ol' : 'ul';
    let out = `<${tag} class="mm-body-list">`;
    for (const it of items) {
      const childOrdered = it.children && it.children[0] && it.children[0].ordered;
      const childTag = childOrdered ? 'ol' : 'ul';
      let inner = renderInline(it.text || '');
      if (it.children && it.children.length > 0) {
        inner += `<${childTag} class="mm-body-list">`;
        for (const c of it.children) {
          inner += renderListItem(c);
        }
        inner += `</${childTag}>`;
      }
      out += `<li>${inner}</li>`;
    }
    out += `</${tag}>`;
    return out;
  }

  function renderListItem(item) {
    let inner = renderInline(item.text || '');
    if (item.children && item.children.length > 0) {
      const childOrdered = item.children[0].ordered;
      const tag = childOrdered ? 'ol' : 'ul';
      inner += `<${tag} class="mm-body-list">`;
      for (const c of item.children) {
        inner += renderListItem(c);
      }
      inner += `</${tag}>`;
    }
    return `<li>${inner}</li>`;
  }

  /**
   * Render a fenced code block to HTML, with optional syntax highlighting
   * (uses highlight.js if available).
   */
  function renderCode(block) {
    const lang = (block.lang || '').toLowerCase();
    const raw = block.content || '';
    let body = escapeHtml(raw);
    let langClass = lang ? ` language-${escapeHtml(lang)}` : '';

    if (lang && typeof hljs !== 'undefined') {
      try {
        if (hljs.getLanguage && hljs.getLanguage(lang)) {
          const r = hljs.highlight(raw, { language: lang, ignoreIllegals: true });
          body = r.value;
        } else if (hljs.highlightAuto) {
          const r = hljs.highlightAuto(raw);
          body = r.value;
        }
      } catch (_) {
        body = escapeHtml(raw);
      }
    } else if (typeof hljs !== 'undefined' && hljs.highlightAuto) {
      try {
        const r = hljs.highlightAuto(raw);
        body = r.value;
      } catch (_) {
        body = escapeHtml(raw);
      }
    }

    const langTag = lang
      ? `<span class="mm-body-code-lang">${escapeHtml(lang)}</span>`
      : '';

    return `
      <div class="mm-body-code-wrap">
        ${langTag}
        <pre class="mm-body-code"><code class="hljs${langClass}">${body}</code></pre>
      </div>
    `;
  }

  function renderParagraph(text) {
    return `<p class="mm-body-paragraph">${renderInline(text || '')}</p>`;
  }

  /**
   * Render an array of body blocks into a single HTML string.
   */
  function renderToHtml(body) {
    if (!body || body.length === 0) return '';
    let out = '<div class="mm-body-card-inner">';
    for (const block of body) {
      if (block.type === 'list') {
        const ordered = block.items && block.items[0] && block.items[0].ordered;
        out += renderList(block.items, ordered);
      } else if (block.type === 'code') {
        out += renderCode(block);
      } else if (block.type === 'paragraph') {
        out += renderParagraph(block.text);
      }
    }
    out += '</div>';
    return out;
  }

  /**
   * Briefly summarize body content for tooltip / preview.
   */
  function summarize(body) {
    if (!body || body.length === 0) return '';
    const counts = { list: 0, code: 0, paragraph: 0 };
    for (const b of body) counts[b.type] = (counts[b.type] || 0) + 1;
    const parts = [];
    if (counts.list) parts.push(`${counts.list} 个列表`);
    if (counts.code) parts.push(`${counts.code} 段代码`);
    if (counts.paragraph) parts.push(`${counts.paragraph} 个段落`);
    return parts.join(' · ');
  }

  return {
    renderToHtml,
    summarize,
    escapeHtml,
  };
})();
