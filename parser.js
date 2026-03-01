/**
 * MarkMind — Markdown Parser
 *
 * Parses Markdown headings into a tree structure suitable for mind map rendering.
 * Supports incremental diffing to detect structural changes.
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
   * Parse markdown text into a flat list of heading entries.
   * Also captures list items (- or *) as leaf children.
   */
  function tokenize(markdown) {
    const lines = markdown.split('\n');
    const tokens = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        tokens.push({
          type: 'heading',
          level: headingMatch[1].length,
          text: headingMatch[2].trim(),
          line: i,
        });
        continue;
      }

      const listMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
      if (listMatch) {
        const indent = listMatch[1].length;
        tokens.push({
          type: 'list-item',
          indent,
          text: listMatch[2].trim(),
          line: i,
        });
      }
    }

    return tokens;
  }

  /**
   * Build a tree from tokens.
   * Returns the root node of the mind map.
   */
  function buildTree(tokens) {
    if (tokens.length === 0) {
      return {
        id: generateId(),
        text: '空白脑图',
        depth: 0,
        children: [],
        collapsed: false,
        _key: '空白脑图@0',
        _hasLatex: false,
      };
    }

    const firstToken = tokens[0];
    const root = {
      id: generateId(),
      text: firstToken.text,
      depth: 0,
      children: [],
      collapsed: false,
      _key: firstToken.text + '@0',
      line: firstToken.line,
      _hasLatex: hasLatex(firstToken.text),
    };

    const stack = [root];
    let lastHeadingNode = root;

    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];

      if (token.type === 'heading') {
        const node = {
          id: generateId(),
          text: token.text,
          depth: token.level - firstToken.level,
          children: [],
          collapsed: false,
          _key: token.text + '@' + token.level,
          line: token.line,
          _hasLatex: hasLatex(token.text),
        };

        while (stack.length > 1 && stack[stack.length - 1].depth >= node.depth) {
          stack.pop();
        }

        const parent = stack[stack.length - 1];
        parent.children.push(node);
        stack.push(node);
        lastHeadingNode = node;

      } else if (token.type === 'list-item') {
        const node = {
          id: generateId(),
          text: token.text,
          depth: lastHeadingNode.depth + 1 + Math.floor(token.indent / 2),
          children: [],
          collapsed: false,
          _key: token.text + '@list-' + token.line,
          line: token.line,
          _hasLatex: hasLatex(token.text),
        };

        lastHeadingNode.children.push(node);
      }
    }

    assignDepths(root, 0);
    return root;
  }

  function assignDepths(node, depth) {
    node.depth = depth;
    for (const child of node.children) {
      assignDepths(child, depth + 1);
    }
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
   * Transfer collapsed state and IDs from old tree to new tree
   * so incremental updates preserve user interaction state.
   */
  function transferState(oldRoot, newRoot) {
    const oldMap = new Map();
    flatten(oldRoot).forEach(n => oldMap.set(n._key, n));

    flatten(newRoot).forEach(n => {
      const old = oldMap.get(n._key);
      if (old) {
        n.id = old.id;
        n.collapsed = old.collapsed;
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
   * Returns array of { type: 'text'|'bold'|'italic'|'bold-italic'|'code', content: string }
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
