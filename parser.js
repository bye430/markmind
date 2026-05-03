/**
 * MarkMind — Markdown Parser
 *
 * Parses Markdown into a tree of heading nodes (unlimited depth).
 * Non-heading content (lists, code fences, paragraphs) is attached as
 * structured `body` blocks on the most recent heading node.
 */

const MarkdownParser = (() => {
  let _nextId = 1;

  function generateId() {
    return 'n' + (_nextId++);
  }

  function resetIdCounter() {
    _nextId = 1;
  }

  /**
   * Parse markdown into a flat sequence of structural tokens.
   * Tokens:
   *   { type: 'heading', level, text, line }
   *   { type: 'list',    items: [...], line, raw: '...' }   // top-level list block
   *   { type: 'code',    lang, content, line, raw: '...' }
   *   { type: 'paragraph', text, line, raw: '...' }
   *
   * Each list item: { text, indent, line, children: [items] }
   */
  function tokenize(markdown) {
    const lines = markdown.split('\n');
    const tokens = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // --- heading ---
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        tokens.push({
          type: 'heading',
          level: headingMatch[1].length,
          text: headingMatch[2].trim(),
          line: i,
        });
        i++;
        continue;
      }

      // --- code fence ---
      const fenceMatch = line.match(/^(\s*)(```|~~~)([\w+-]*)\s*$/);
      if (fenceMatch) {
        const indent = fenceMatch[1];
        const fence = fenceMatch[2];
        const lang = fenceMatch[3] || '';
        const startLine = i;
        const startRaw = line;
        const codeLines = [];
        i++;
        let endRaw = '';
        while (i < lines.length) {
          const closeMatch = lines[i].match(/^(\s*)(```|~~~)\s*$/);
          if (closeMatch && closeMatch[2] === fence) {
            endRaw = lines[i];
            i++;
            break;
          }
          codeLines.push(lines[i]);
          i++;
        }
        tokens.push({
          type: 'code',
          lang,
          content: codeLines.join('\n'),
          line: startLine,
          raw: [startRaw, ...codeLines, endRaw].filter(s => s !== '').join('\n'),
          indent: indent.length,
        });
        continue;
      }

      // --- list block (consecutive list items, possibly nested) ---
      if (/^(\s*)[-*+]\s+(.+)$/.test(line) || /^(\s*)\d+\.\s+(.+)$/.test(line)) {
        const startLine = i;
        const blockLines = [];
        const items = [];
        const stack = [];

        while (i < lines.length) {
          const cur = lines[i];
          const ulMatch = cur.match(/^(\s*)([-*+])\s+(.+)$/);
          const olMatch = cur.match(/^(\s*)(\d+)\.\s+(.+)$/);
          if (!ulMatch && !olMatch) {
            // Allow blank line inside list only if next line is still a list item.
            if (cur.trim() === '') {
              const next = lines[i + 1];
              if (next && (/^(\s*)[-*+]\s+/.test(next) || /^(\s*)\d+\.\s+/.test(next))) {
                blockLines.push(cur);
                i++;
                continue;
              }
            }
            break;
          }

          let indent, marker, ordered, text;
          if (ulMatch) {
            indent = ulMatch[1].length;
            marker = ulMatch[2];
            ordered = false;
            text = ulMatch[3];
          } else {
            indent = olMatch[1].length;
            marker = olMatch[2] + '.';
            ordered = true;
            text = olMatch[3];
          }

          const item = {
            text: text.trim(),
            indent,
            ordered,
            marker,
            line: i,
            children: [],
          };

          while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
          }
          if (stack.length === 0) {
            items.push(item);
          } else {
            stack[stack.length - 1].children.push(item);
          }
          stack.push(item);

          blockLines.push(cur);
          i++;
        }

        tokens.push({
          type: 'list',
          items,
          line: startLine,
          raw: blockLines.join('\n'),
        });
        continue;
      }

      // --- blank line ---
      if (line.trim() === '') {
        i++;
        continue;
      }

      // --- paragraph (consecutive non-heading, non-list, non-code lines) ---
      const paraStart = i;
      const paraLines = [line];
      i++;
      while (i < lines.length) {
        const cur = lines[i];
        if (
          cur.trim() === '' ||
          /^(#{1,6})\s+/.test(cur) ||
          /^(\s*)(```|~~~)/.test(cur) ||
          /^(\s*)[-*+]\s+/.test(cur) ||
          /^(\s*)\d+\.\s+/.test(cur)
        ) {
          break;
        }
        paraLines.push(cur);
        i++;
      }
      tokens.push({
        type: 'paragraph',
        text: paraLines.join('\n').trim(),
        line: paraStart,
        raw: paraLines.join('\n'),
      });
    }

    return tokens;
  }

  /**
   * Build a tree from tokens.
   * Only heading tokens become nodes; everything else gets attached to the
   * most recent heading node's `body` array.
   *
   * If there is no heading at all, a synthetic root is created.
   */
  function buildTree(tokens) {
    if (tokens.length === 0) {
      return makeEmptyRoot();
    }

    const firstHeadingIdx = tokens.findIndex(t => t.type === 'heading');

    let root;
    let bodyForCurrent;
    let stack;
    let baseLevel;
    let cursor = 0;

    if (firstHeadingIdx === -1) {
      // No heading: synthesize a root and put everything in its body.
      root = makeEmptyRoot();
      root.body = tokensToBody(tokens);
      return root;
    }

    if (firstHeadingIdx > 0) {
      // Pre-heading content: put it on a synthetic root that uses the first
      // heading as its title.
      const first = tokens[firstHeadingIdx];
      root = makeNode(first.text, 0, first.line, first.level);
      root.body = tokensToBody(tokens.slice(0, firstHeadingIdx));
      cursor = firstHeadingIdx + 1;
      baseLevel = first.level;
    } else {
      const first = tokens[0];
      root = makeNode(first.text, 0, first.line, first.level);
      cursor = 1;
      baseLevel = first.level;
    }

    stack = [root];
    bodyForCurrent = root.body;

    while (cursor < tokens.length) {
      const tk = tokens[cursor];
      if (tk.type === 'heading') {
        const depth = Math.max(1, tk.level - baseLevel);
        const node = makeNode(tk.text, depth, tk.line, tk.level);

        while (stack.length > 1 && stack[stack.length - 1].depth >= node.depth) {
          stack.pop();
        }
        stack[stack.length - 1].children.push(node);
        stack.push(node);
        bodyForCurrent = node.body;
      } else {
        const block = tokenToBodyBlock(tk);
        if (block) bodyForCurrent.push(block);
      }
      cursor++;
    }

    assignDepths(root, 0);
    finalizeBodyKeys(root);
    return root;
  }

  function makeEmptyRoot() {
    return {
      id: generateId(),
      text: '空白脑图',
      depth: 0,
      children: [],
      body: [],
      collapsed: false,
      bodyExpanded: false,
      _key: '空白脑图@0',
      _hasLatex: false,
      _headingLevel: 1,
    };
  }

  function makeNode(text, depth, line, headingLevel) {
    return {
      id: generateId(),
      text,
      depth,
      children: [],
      body: [],
      collapsed: false,
      bodyExpanded: false,
      _key: text + '@' + (headingLevel || depth),
      line,
      _hasLatex: hasLatex(text),
      _headingLevel: headingLevel || (depth + 1),
    };
  }

  function tokensToBody(tokens) {
    const out = [];
    for (const tk of tokens) {
      if (tk.type === 'heading') continue;
      const b = tokenToBodyBlock(tk);
      if (b) out.push(b);
    }
    return out;
  }

  function tokenToBodyBlock(tk) {
    if (tk.type === 'list') {
      return {
        type: 'list',
        items: tk.items,
        line: tk.line,
        raw: tk.raw,
      };
    }
    if (tk.type === 'code') {
      return {
        type: 'code',
        lang: tk.lang,
        content: tk.content,
        line: tk.line,
        raw: tk.raw,
        indent: tk.indent || 0,
      };
    }
    if (tk.type === 'paragraph') {
      return {
        type: 'paragraph',
        text: tk.text,
        line: tk.line,
        raw: tk.raw,
      };
    }
    return null;
  }

  function assignDepths(node, depth) {
    node.depth = depth;
    for (const child of node.children) {
      assignDepths(child, depth + 1);
    }
  }

  /**
   * Generate stable identity keys for body blocks so state (e.g. expanded
   * code panels) can survive re-parses.
   */
  function finalizeBodyKeys(root) {
    flatten(root).forEach(node => {
      if (!node.body) return;
      node.body.forEach((block, idx) => {
        block._key = `${node._key}::body[${idx}]:${block.type}`;
      });
    });
  }

  /**
   * Parse markdown string into a mind map tree.
   */
  function parse(markdown) {
    const tokens = tokenize(markdown);
    return buildTree(tokens);
  }

  /**
   * Flatten a tree into an array of nodes (pre-order).
   */
  function flatten(node, result = []) {
    result.push(node);
    for (const child of node.children) {
      flatten(child, result);
    }
    return result;
  }

  /**
   * Diff two trees and return change sets.
   * Uses _key for identity matching.
   */
  function diffTrees(oldRoot, newRoot) {
    const oldMap = new Map();
    const newMap = new Map();

    flatten(oldRoot).forEach(n => oldMap.set(n._key, n));
    flatten(newRoot).forEach(n => newMap.set(n._key, n));

    const added = [];
    const removed = [];
    const moved = [];
    const unchanged = [];

    for (const [key, node] of newMap) {
      if (!oldMap.has(key)) {
        added.push(node);
      } else {
        const oldNode = oldMap.get(key);
        if (oldNode.depth !== node.depth) {
          moved.push({ node, oldNode });
        } else {
          unchanged.push({ node, oldNode });
        }
      }
    }

    for (const [key, node] of oldMap) {
      if (!newMap.has(key)) {
        removed.push(node);
      }
    }

    return { added, removed, moved, unchanged };
  }

  /**
   * Transfer collapsed state, body-expanded state, and IDs from old tree to
   * new tree so incremental updates preserve user interaction state.
   */
  function transferState(oldRoot, newRoot) {
    const oldMap = new Map();
    flatten(oldRoot).forEach(n => oldMap.set(n._key, n));

    flatten(newRoot).forEach(n => {
      const old = oldMap.get(n._key);
      if (old) {
        n.id = old.id;
        n.collapsed = old.collapsed;
        n.bodyExpanded = old.bodyExpanded || false;
      }
    });
  }

  /**
   * Detect whether text contains LaTeX formulas.
   * Supports: $...$, $$...$$, \(...\), \[...\]
   */
  const LATEX_PATTERNS = [
    { regex: /\$\$(.+?)\$\$/g, type: 'display' },
    { regex: /\\\[(.+?)\\\]/g, type: 'display' },
    { regex: /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, type: 'inline' },
    { regex: /\\\((.+?)\\\)/g, type: 'inline' },
  ];

  function hasLatex(text) {
    return LATEX_PATTERNS.some(p => {
      p.regex.lastIndex = 0;
      return p.regex.test(text);
    });
  }

  /**
   * Split text into segments of plain text and LaTeX formulas.
   * Returns array of { type: 'text'|'inline'|'display', content: string }
   */
  function parseLatexSegments(text) {
    const markers = [];

    for (const { regex, type } of LATEX_PATTERNS) {
      const re = new RegExp(regex.source, regex.flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        const overlaps = markers.some(
          mk => m.index < mk.end && (m.index + m[0].length) > mk.start
        );
        if (!overlaps) {
          markers.push({
            start: m.index,
            end: m.index + m[0].length,
            formula: m[1],
            type,
            raw: m[0],
          });
        }
      }
    }

    markers.sort((a, b) => a.start - b.start);

    if (markers.length === 0) {
      return [{ type: 'text', content: text }];
    }

    const segments = [];
    let pos = 0;

    for (const mk of markers) {
      if (mk.start > pos) {
        segments.push({ type: 'text', content: text.slice(pos, mk.start) });
      }
      segments.push({ type: mk.type, content: mk.formula });
      pos = mk.end;
    }

    if (pos < text.length) {
      segments.push({ type: 'text', content: text.slice(pos) });
    }

    return segments;
  }

  /**
   * Parse inline markdown formatting into segments.
   * Handles: ***bold-italic***, **bold**, *italic*, `code`
   */
  function parseInlineMarkdown(text) {
    const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
    const segments = [];
    let pos = 0;
    let m;

    while ((m = regex.exec(text)) !== null) {
      if (m.index > pos) {
        segments.push({ type: 'text', content: text.slice(pos, m.index) });
      }
      if (m[2] !== undefined) {
        segments.push({ type: 'bold-italic', content: m[2] });
      } else if (m[3] !== undefined) {
        segments.push({ type: 'bold', content: m[3] });
      } else if (m[4] !== undefined) {
        segments.push({ type: 'italic', content: m[4] });
      } else if (m[5] !== undefined) {
        segments.push({ type: 'code', content: m[5] });
      }
      pos = m.index + m[0].length;
    }

    if (pos < text.length) {
      segments.push({ type: 'text', content: text.slice(pos) });
    }

    return segments.length > 0 ? segments : [{ type: 'text', content: text }];
  }

  function hasInlineFormatting(text) {
    return /(\*\*\*.+?\*\*\*|\*\*.+?\*\*|\*.+?\*|`.+?`)/.test(text);
  }

  return {
    parse,
    tokenize,
    flatten,
    diffTrees,
    transferState,
    resetIdCounter,
    hasLatex,
    parseLatexSegments,
    parseInlineMarkdown,
    hasInlineFormatting,
  };
})();
