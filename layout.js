/**
 * MarkMind — Layout Engine
 *
 * Computes positions for each node in the mind map tree.
 * Supports multiple layout directions: right, mind-map (left+right), down.
 * Uses a modified Reingold-Tilford approach with variable node sizes.
 */

const LayoutEngine = (() => {
  const DEFAULTS = {
    hGap: 60,
    vGap: 14,
    rootPadH: 24,
    rootPadV: 12,
    nodePadH: 16,
    nodePadV: 8,
    minNodeWidth: 40,
    maxNodeWidth: 600,
    fontSize: [16, 14, 13, 12],
    fontWeight: [700, 600, 500, 400],
    bodyMaxWidth: 520,
    bodyMinWidth: 240,
    bodyGap: 8,
  };

  let _measureDiv = null;
  const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif';

  function getCanvasFontConfig() {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (!root) {
      return { fontFamily: FONT_FAMILY, fontSize: DEFAULTS.fontSize.slice(), fontWeight: DEFAULTS.fontWeight.slice() };
    }
    const style = getComputedStyle(root);
    const getNum = (name, fallback) => {
      const v = style.getPropertyValue(name).trim();
      const n = parseInt(v, 10);
      return v && !isNaN(n) ? n : fallback;
    };
    const getStr = (name, fallback) => {
      const v = style.getPropertyValue(name).trim();
      return v || fallback;
    };
    return {
      fontFamily: getStr('--canvas-font-family', FONT_FAMILY),
      fontSize: [
        getNum('--canvas-font-size-0', DEFAULTS.fontSize[0]),
        getNum('--canvas-font-size-1', DEFAULTS.fontSize[1]),
        getNum('--canvas-font-size-2', DEFAULTS.fontSize[2]),
        getNum('--canvas-font-size-3', DEFAULTS.fontSize[3]),
      ],
      fontWeight: [
        getNum('--canvas-font-weight-0', DEFAULTS.fontWeight[0]),
        getNum('--canvas-font-weight-1', DEFAULTS.fontWeight[1]),
        getNum('--canvas-font-weight-2', DEFAULTS.fontWeight[2]),
        getNum('--canvas-font-weight-3', DEFAULTS.fontWeight[3]),
      ],
    };
  }
  const CODE_FONT = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
  const WRAP_THRESHOLD = 280;

  function getMeasureDiv() {
    if (!_measureDiv) {
      _measureDiv = document.createElement('div');
      _measureDiv.style.cssText =
        'position:absolute;visibility:hidden;pointer-events:none;' +
        'left:-9999px;top:-9999px;';
      document.body.appendChild(_measureDiv);
    }
    return _measureDiv;
  }

  function _populatePlainText(container, text, fontSize, fontWeight) {
    const span = document.createElement('span');
    span.style.fontWeight = fontWeight;
    span.style.verticalAlign = 'middle';
    span.textContent = text;
    container.appendChild(span);
  }

  function _populateRichText(container, text, fontSize, fontWeight) {
    const segments = MarkdownParser.parseInlineMarkdown(text);
    for (const seg of segments) {
      const span = document.createElement('span');
      span.textContent = seg.content;
      span.style.verticalAlign = 'middle';
      if (seg.type === 'bold' || seg.type === 'bold-italic') {
        span.style.fontWeight = '700';
        span.classList.add('mm-bold');
      } else {
        span.style.fontWeight = fontWeight;
      }
      if (seg.type === 'italic' || seg.type === 'bold-italic') {
        span.style.fontStyle = 'italic';
        span.classList.add('mm-italic');
      }
      if (seg.type === 'code') {
        span.style.fontFamily = CODE_FONT;
        span.style.fontSize = (fontSize * 0.9) + 'px';
        span.classList.add('mm-inline-code');
      }
      if (seg.type !== 'text') {
        span.style.display = 'inline';
        span.style.whiteSpace = 'nowrap';
      }
      container.appendChild(span);
    }
  }

  function _populateLatexText(container, text, fontSize) {
    const segments = MarkdownParser.parseLatexSegments(text);
    for (const seg of segments) {
      if (seg.type === 'text') {
        const span = document.createElement('span');
        span.style.verticalAlign = 'middle';
        span.textContent = seg.content;
        container.appendChild(span);
      } else if (typeof katex !== 'undefined') {
        const span = document.createElement('span');
        span.style.display = 'inline-block';
        span.style.whiteSpace = 'nowrap';
        span.style.verticalAlign = 'middle';
        try {
          katex.render(seg.content, span, {
            throwOnError: false,
            displayMode: seg.type === 'display',
          });
        } catch (_) {
          span.textContent = seg.content;
        }
        container.appendChild(span);
      } else {
        const span = document.createElement('span');
        span.style.verticalAlign = 'middle';
        span.textContent = seg.content;
        container.appendChild(span);
      }
    }
  }

  function measureNode(text, depth, hasLatex, hasRichText) {
    const cfg = getCanvasFontConfig();
    const fontSize = cfg.fontSize[Math.min(depth, cfg.fontSize.length - 1)];
    const fontWeight = cfg.fontWeight[Math.min(depth, cfg.fontWeight.length - 1)];
    const padH = depth === 0 ? DEFAULTS.rootPadH : DEFAULTS.nodePadH;
    const maxContentW = DEFAULTS.maxNodeWidth - padH * 2;

    const div = getMeasureDiv();
    div.style.fontSize = fontSize + 'px';
    div.style.fontFamily = cfg.fontFamily;
    div.style.fontWeight = fontWeight;
    div.style.lineHeight = '1.45';
    div.style.padding = '0';
    div.style.textAlign = 'center';
    div.innerHTML = '';

    div.style.whiteSpace = 'nowrap';
    div.style.width = 'auto';
    div.style.wordBreak = 'normal';
    div.style.overflowWrap = 'normal';

    if (hasLatex && typeof katex !== 'undefined') {
      _populateLatexText(div, text, fontSize);
    } else if (hasRichText) {
      _populateRichText(div, text, fontSize, fontWeight);
    } else {
      _populatePlainText(div, text, fontSize, fontWeight);
    }

    const singleRect = div.getBoundingClientRect();
    const singleW = Math.ceil(singleRect.width);
    const singleH = Math.ceil(singleRect.height);

    if (singleW <= maxContentW) {
      return { textWidth: singleW, textHeight: singleH, wrapped: false };
    }

    div.style.whiteSpace = 'normal';
    div.style.overflowWrap = 'break-word';
    div.style.width = maxContentW + 'px';

    const wrappedRect = div.getBoundingClientRect();
    return {
      textWidth: Math.ceil(wrappedRect.width),
      textHeight: Math.ceil(wrappedRect.height),
      wrapped: true,
    };
  }

  /**
   * Compute the bounding box for each node.
   * Uses KaTeX pre-render for nodes containing LaTeX.
   */
  function measureNodes(node) {
    node._hasRichText = !node._hasLatex && MarkdownParser.hasInlineFormatting(node.text);

    const m = measureNode(node.text, node.depth, node._hasLatex, node._hasRichText);

    const padH = node.depth === 0 ? DEFAULTS.rootPadH : DEFAULTS.nodePadH;
    const padV = node.depth === 0 ? DEFAULTS.rootPadV : DEFAULTS.nodePadV;
    const cfg = getCanvasFontConfig();
    const minH = cfg.fontSize[Math.min(node.depth, 3)] + padV * 2;

    node.width = Math.min(Math.max(m.textWidth + padH * 2, DEFAULTS.minNodeWidth), DEFAULTS.maxNodeWidth);
    node.height = Math.max(m.textHeight + padV * 2, minH);
    node.textWidth = m.textWidth;
    node.textHeight = m.textHeight;
    node._wrapped = m.wrapped;

    if (node.body && node.body.length > 0 && node.bodyExpanded) {
      const bm = measureBody(node);
      node._bodyWidth = bm.width;
      node._bodyHeight = bm.height;
      node._totalHeight = node.height + DEFAULTS.bodyGap + bm.height;
      node._totalWidth = Math.max(node.width, bm.width);
    } else {
      node._bodyWidth = 0;
      node._bodyHeight = 0;
      node._totalHeight = node.height;
      node._totalWidth = node.width;
    }

    const visibleChildren = node.collapsed ? [] : node.children;
    for (const child of visibleChildren) {
      measureNodes(child);
    }
  }

  let _bodyMeasureDiv = null;
  function getBodyMeasureDiv() {
    if (!_bodyMeasureDiv) {
      _bodyMeasureDiv = document.createElement('div');
      _bodyMeasureDiv.className = 'mm-body-card mm-body-measure';
      _bodyMeasureDiv.style.cssText =
        'position:absolute;visibility:hidden;pointer-events:none;' +
        'left:-9999px;top:-9999px;' +
        'box-sizing:border-box;' +
        `max-width:${DEFAULTS.bodyMaxWidth}px;` +
        `min-width:${DEFAULTS.bodyMinWidth}px;`;
      document.body.appendChild(_bodyMeasureDiv);
    }
    return _bodyMeasureDiv;
  }

  /**
   * Render body content into a hidden DOM element to measure its natural
   * size. Returns { width, height }.
   */
  function measureBody(node) {
    if (typeof NodeBodyRenderer === 'undefined') {
      return { width: DEFAULTS.bodyMinWidth, height: 60 };
    }
    const div = getBodyMeasureDiv();
    div.innerHTML = NodeBodyRenderer.renderToHtml(node.body);
    const r = div.getBoundingClientRect();
    return {
      width: Math.min(Math.max(Math.ceil(r.width), DEFAULTS.bodyMinWidth), DEFAULTS.bodyMaxWidth),
      height: Math.max(Math.ceil(r.height), 40),
    };
  }

  /**
   * Layout: right-expanding tree.
   * Each node is positioned to the right of its parent.
   */
  function layoutRight(root) {
    measureNodes(root);
    computeSubtreeHeights(root);
    let startY = 0;
    positionRight(root, 0, startY);
    const bounds = getBounds(root);
    const offsetX = -bounds.minX;
    const offsetY = -bounds.minY;
    shiftAll(root, offsetX, offsetY);
    return root;
  }

  function computeSubtreeHeights(node) {
    const visibleChildren = node.collapsed ? [] : node.children;
    const ownHeight = node._totalHeight || node.height;
    if (visibleChildren.length === 0) {
      node._subtreeHeight = ownHeight;
      return;
    }
    let total = 0;
    for (const child of visibleChildren) {
      computeSubtreeHeights(child);
      total += child._subtreeHeight;
    }
    total += (visibleChildren.length - 1) * DEFAULTS.vGap;
    node._subtreeHeight = Math.max(ownHeight, total);
  }

  function positionRight(node, x, yStart) {
    node.x = x;
    const visibleChildren = node.collapsed ? [] : node.children;
    const ownHeight = node._totalHeight || node.height;

    if (visibleChildren.length === 0) {
      node.y = yStart + node._subtreeHeight / 2 - ownHeight / 2;
      return;
    }

    let childY = yStart;
    const totalChildHeight = visibleChildren.reduce((s, c) => s + c._subtreeHeight, 0)
      + (visibleChildren.length - 1) * DEFAULTS.vGap;

    const offset = (node._subtreeHeight - totalChildHeight) / 2;
    childY += offset;

    for (const child of visibleChildren) {
      positionRight(child, x + node.width + DEFAULTS.hGap, childY);
      childY += child._subtreeHeight + DEFAULTS.vGap;
    }

    const firstChild = visibleChildren[0];
    const lastChild = visibleChildren[visibleChildren.length - 1];
    const childrenMidY = (firstChild.y + firstChild.height / 2 + lastChild.y + lastChild.height / 2) / 2;
    node.y = childrenMidY - node.height / 2;
  }

  /**
   * Layout: mind-map (left + right balanced).
   * Splits children into left and right groups.
   */
  function layoutMindMap(root) {
    measureNodes(root);

    const visibleChildren = root.collapsed ? [] : root.children;
    const mid = Math.ceil(visibleChildren.length / 2);
    const rightChildren = visibleChildren.slice(0, mid);
    const leftChildren = visibleChildren.slice(mid);

    root.x = 0;
    root.y = 0;

    layoutBranch(root, rightChildren, 'right');
    layoutBranch(root, leftChildren, 'left');

    const bounds = getBounds(root);
    const offsetX = -bounds.minX + 40;
    const offsetY = -bounds.minY + 40;
    shiftAll(root, offsetX, offsetY);

    return root;
  }

  function layoutBranch(root, children, direction) {
    if (children.length === 0) return;

    for (const child of children) {
      computeSubtreeHeights(child);
    }

    let totalHeight = children.reduce((s, c) => s + c._subtreeHeight, 0)
      + (children.length - 1) * DEFAULTS.vGap;

    let y = root.y + root.height / 2 - totalHeight / 2;

    for (const child of children) {
      const xOffset = direction === 'right'
        ? root.x + root.width + DEFAULTS.hGap
        : root.x - child.width - DEFAULTS.hGap;

      if (direction === 'left') {
        positionLeft(child, xOffset, y);
      } else {
        positionRight(child, xOffset, y);
      }
      y += child._subtreeHeight + DEFAULTS.vGap;
    }

    for (const child of children) {
      child._direction = direction;
      markDirection(child, direction);
    }
  }

  function markDirection(node, direction) {
    node._direction = direction;
    const visibleChildren = node.collapsed ? [] : node.children;
    for (const child of visibleChildren) {
      markDirection(child, direction);
    }
  }

  function positionLeft(node, x, yStart) {
    node.x = x;
    const visibleChildren = node.collapsed ? [] : node.children;
    const ownHeight = node._totalHeight || node.height;

    if (visibleChildren.length === 0) {
      node.y = yStart + node._subtreeHeight / 2 - ownHeight / 2;
      return;
    }

    let childY = yStart;
    const totalChildHeight = visibleChildren.reduce((s, c) => s + c._subtreeHeight, 0)
      + (visibleChildren.length - 1) * DEFAULTS.vGap;
    const offset = (node._subtreeHeight - totalChildHeight) / 2;
    childY += offset;

    for (const child of visibleChildren) {
      positionLeft(child, x - child.width - DEFAULTS.hGap, childY);
      childY += child._subtreeHeight + DEFAULTS.vGap;
    }

    const firstChild = visibleChildren[0];
    const lastChild = visibleChildren[visibleChildren.length - 1];
    const childrenMidY = (firstChild.y + firstChild.height / 2 + lastChild.y + lastChild.height / 2) / 2;
    node.y = childrenMidY - node.height / 2;
  }

  /**
   * Layout: top-down tree.
   */
  function layoutDown(root) {
    measureNodes(root);
    computeSubtreeWidths(root);

    let startX = 0;
    positionDown(root, startX, 0);

    const bounds = getBounds(root);
    shiftAll(root, -bounds.minX + 40, -bounds.minY + 40);
    return root;
  }

  function computeSubtreeWidths(node) {
    const visibleChildren = node.collapsed ? [] : node.children;
    const ownWidth = node._totalWidth || node.width;
    if (visibleChildren.length === 0) {
      node._subtreeWidth = ownWidth;
      return;
    }
    let total = 0;
    for (const child of visibleChildren) {
      computeSubtreeWidths(child);
      total += child._subtreeWidth;
    }
    total += (visibleChildren.length - 1) * DEFAULTS.hGap * 0.6;
    node._subtreeWidth = Math.max(ownWidth, total);
  }

  function positionDown(node, xStart, y) {
    node.y = y;
    const visibleChildren = node.collapsed ? [] : node.children;
    const ownHeight = node._totalHeight || node.height;

    if (visibleChildren.length === 0) {
      node.x = xStart + node._subtreeWidth / 2 - node.width / 2;
      return;
    }

    let childX = xStart;
    const totalChildWidth = visibleChildren.reduce((s, c) => s + c._subtreeWidth, 0)
      + (visibleChildren.length - 1) * DEFAULTS.hGap * 0.6;
    const offset = (node._subtreeWidth - totalChildWidth) / 2;
    childX += offset;

    for (const child of visibleChildren) {
      positionDown(child, childX, y + ownHeight + DEFAULTS.vGap * 3);
      childX += child._subtreeWidth + DEFAULTS.hGap * 0.6;
    }

    const firstChild = visibleChildren[0];
    const lastChild = visibleChildren[visibleChildren.length - 1];
    const childrenMidX = (firstChild.x + firstChild.width / 2 + lastChild.x + lastChild.width / 2) / 2;
    node.x = childrenMidX - node.width / 2;
  }

  /**
   * Compute the layout based on the selected direction.
   */
  function compute(root, direction = 'right') {
    switch (direction) {
      case 'mind-map': return layoutMindMap(root);
      case 'down': return layoutDown(root);
      default: return layoutRight(root);
    }
  }

  function getBounds(root) {
    const nodes = MarkdownParser.flatten(root);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x === undefined) continue;
      const w = n._totalWidth || n.width || 0;
      const h = n._totalHeight || n.height || 0;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + w);
      maxY = Math.max(maxY, n.y + h);
    }
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }

  function shiftAll(node, dx, dy) {
    if (node.x !== undefined) node.x += dx;
    if (node.y !== undefined) node.y += dy;
    const visibleChildren = node.collapsed ? [] : node.children;
    for (const child of visibleChildren) {
      shiftAll(child, dx, dy);
    }
  }

  return {
    compute,
    getBounds,
    measureBody,
    DEFAULTS,
    FONT_FAMILY,
    CODE_FONT,
    getCanvasFontConfig,
    populatePlainText: _populatePlainText,
    populateRichText: _populateRichText,
    populateLatexText: _populateLatexText,
  };
})();
