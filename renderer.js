/**
 * MarkMind — SVG Renderer
 *
 * Renders the mind map tree as SVG elements.
 * Supports incremental updates with smooth animations.
 */

const Renderer = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let _svg = null;
  let _linksGroup = null;
  let _nodesGroup = null;
  let _transform = { x: 0, y: 0, scale: 1 };
  let _rootGroup = null;
  let _prevNodeMap = new Map();
  let _direction = 'right';
  let _onNodeClick = null;
  let _onNodeDblClick = null;
  let _onNodeToggle = null;
  let _onNodeMouseDown = null;

  function init(svgElement) {
    _svg = svgElement;
    _svg.innerHTML = '';

    const defs = createSvgEl('defs');
    _svg.appendChild(defs);

    _rootGroup = createSvgEl('g', { class: 'mm-root' });
    _svg.appendChild(_rootGroup);

    _linksGroup = createSvgEl('g', { class: 'mm-links' });
    _rootGroup.appendChild(_linksGroup);

    _nodesGroup = createSvgEl('g', { class: 'mm-nodes' });
    _rootGroup.appendChild(_nodesGroup);

    applyTransform();
  }

  function setDirection(dir) {
    _direction = dir;
  }

  function setCallbacks({ onClick, onDblClick, onToggle, onMouseDown }) {
    _onNodeClick = onClick;
    _onNodeDblClick = onDblClick;
    _onNodeToggle = onToggle || null;
    _onNodeMouseDown = onMouseDown || null;
  }

  function createSvgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    return el;
  }

  /**
   * Render the tree with incremental diffing.
   * Nodes that existed before animate to their new positions.
   * New nodes fade in. Removed nodes fade out.
   */
  function render(root, animate = true) {
    const allNodes = MarkdownParser.flatten(root);
    const newNodeMap = new Map();
    allNodes.forEach(n => newNodeMap.set(n.id, n));

    const links = [];
    collectLinks(root, links);

    // Phase 1: Remove nodes that no longer exist
    const toRemove = [];
    for (const [id] of _prevNodeMap) {
      if (!newNodeMap.has(id)) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      const el = _nodesGroup.querySelector(`[data-id="${id}"]`);
      if (el) {
        el.classList.add('mm-node-exit');
        setTimeout(() => el.remove(), 260);
      }
      _prevNodeMap.delete(id);
    }

    // Phase 2: Remove all links (will redraw)
    _linksGroup.innerHTML = '';

    // Phase 3: Update existing nodes and add new ones
    for (const node of allNodes) {
      const existing = _nodesGroup.querySelector(`[data-id="${node.id}"]`);

      if (existing) {
        updateNodeElement(existing, node, animate);
      } else {
        const el = createNodeElement(node);
        _nodesGroup.appendChild(el);
        if (animate) {
          el.classList.add('mm-node-enter');
          setTimeout(() => el.classList.remove('mm-node-enter'), 400);
        }
      }
    }

    // Phase 4: Draw links
    for (const link of links) {
      const pathEl = createLinkElement(link.parent, link.child);
      _linksGroup.appendChild(pathEl);
      if (animate) {
        pathEl.classList.add('mm-link-enter');
        setTimeout(() => pathEl.classList.remove('mm-link-enter'), 450);
      }
    }

    _prevNodeMap = newNodeMap;
  }

  function collectLinks(node, links) {
    const visibleChildren = node.collapsed ? [] : node.children;
    for (const child of visibleChildren) {
      links.push({ parent: node, child });
      collectLinks(child, links);
    }
  }

  function createNodeElement(node) {
    const g = createSvgEl('g', {
      class: `mm-node depth-${node.depth <= 2 ? node.depth : 'leaf'}${node.collapsed ? ' collapsed' : ''}`,
      'data-id': node.id,
      transform: `translate(${node.x}, ${node.y})`,
    });

    const isLeaf = node.depth > 2 || (node.depth > 0 && node.children.length === 0);

    const rect = createSvgEl('rect', {
      class: 'mm-node-rect',
      width: node.width,
      height: node.height,
      rx: node.depth === 0 ? 12 : (isLeaf ? 4 : 8),
      ry: node.depth === 0 ? 12 : (isLeaf ? 4 : 8),
    });
    g.appendChild(rect);

    if (isLeaf) {
      const underline = createSvgEl('line', {
        class: 'mm-node-underline',
        x1: 6,
        y1: node.height - 1,
        x2: node.width - 6,
        y2: node.height - 1,
        stroke: 'var(--link-color)',
        'stroke-width': 1,
        opacity: 0.5,
      });
      g.appendChild(underline);
    }

    g.appendChild(_createTextFO(node));

    if (node.children.length > 0 && node.collapsed) {
      const badge = createSvgEl('text', {
        class: 'collapse-indicator',
        x: node.width - 8,
        y: node.height - 6,
      });
      badge.textContent = `+${countDescendants(node)}`;
      badge.style.display = 'block';
      g.appendChild(badge);
    }

    if (node.children.length > 0) {
      const toggleSize = 14;
      const toggleX = _direction === 'left' || node._direction === 'left'
        ? -toggleSize - 4
        : node.width + 4;
      const toggleY = node.height / 2 - toggleSize / 2;

      const toggleBg = createSvgEl('rect', {
        class: 'mm-toggle-bg',
        x: toggleX,
        y: toggleY,
        width: toggleSize,
        height: toggleSize,
        rx: 3,
        ry: 3,
        fill: 'var(--border)',
        opacity: 0,
        cursor: 'pointer',
      });
      g.appendChild(toggleBg);

      const toggleIcon = createSvgEl('text', {
        class: 'mm-toggle-icon',
        x: toggleX + toggleSize / 2,
        y: toggleY + toggleSize / 2,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': 10,
        fill: 'var(--text-muted)',
        opacity: 0,
        cursor: 'pointer',
      });
      toggleIcon.textContent = node.collapsed ? '+' : '−';
      g.appendChild(toggleIcon);

      const toggleHitArea = createSvgEl('rect', {
        class: 'mm-toggle-hit',
        x: toggleX - 4,
        y: toggleY - 4,
        width: toggleSize + 8,
        height: toggleSize + 8,
        fill: 'transparent',
        cursor: 'pointer',
      });
      g.appendChild(toggleHitArea);

      toggleHitArea.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_onNodeToggle) _onNodeToggle(node, e);
      });

      g.addEventListener('mouseenter', () => {
        toggleBg.setAttribute('opacity', '0.8');
        toggleIcon.setAttribute('opacity', '1');
      });
      g.addEventListener('mouseleave', () => {
        toggleBg.setAttribute('opacity', '0');
        toggleIcon.setAttribute('opacity', '0');
      });
    }

    g.addEventListener('dragstart', (e) => {
      e.preventDefault();
    });
    g.addEventListener('mousedown', (e) => {
      if (_onNodeMouseDown) _onNodeMouseDown(node, e);
    });

    g.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_onNodeClick) _onNodeClick(node, e);
    });

    g.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (_onNodeDblClick) _onNodeDblClick(node, e);
    });

    return g;
  }

  function updateNodeElement(el, node, animate) {
    const depthClass = node.depth <= 2 ? `depth-${node.depth}` : 'depth-leaf';
    el.setAttribute('class', `mm-node ${depthClass}${node.collapsed ? ' collapsed' : ''}`);

    const targetTransform = `translate(${node.x}, ${node.y})`;

    if (animate) {
      animateTransform(el, targetTransform);
    } else {
      el.setAttribute('transform', targetTransform);
    }

    const rect = el.querySelector('.mm-node-rect');
    if (rect) {
      if (animate) {
        animateAttribute(rect, 'width', node.width);
        animateAttribute(rect, 'height', node.height);
      } else {
        rect.setAttribute('width', node.width);
        rect.setAttribute('height', node.height);
      }
    }

    const underline = el.querySelector('.mm-node-underline');
    if (underline) {
      underline.setAttribute('y1', node.height - 1);
      underline.setAttribute('y2', node.height - 1);
      underline.setAttribute('x2', node.width - 6);
    }

    const oldFo = el.querySelector('.mm-node-fo');
    const oldText = el.querySelector('.mm-node-text');
    if (oldFo) oldFo.remove();
    if (oldText) oldText.remove();
    el.appendChild(_createTextFO(node));
  }

  function animateTransform(el, targetTransform) {
    const match = targetTransform.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
    if (!match) {
      el.setAttribute('transform', targetTransform);
      return;
    }

    const targetX = parseFloat(match[1]);
    const targetY = parseFloat(match[2]);

    const currentTransform = el.getAttribute('transform') || '';
    const currentMatch = currentTransform.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
    let startX = targetX, startY = targetY;
    if (currentMatch) {
      startX = parseFloat(currentMatch[1]);
      startY = parseFloat(currentMatch[2]);
    }

    if (Math.abs(startX - targetX) < 0.5 && Math.abs(startY - targetY) < 0.5) {
      el.setAttribute('transform', targetTransform);
      return;
    }

    const duration = 350;
    const startTime = performance.now();

    function ease(t) {
      return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = ease(progress);

      const x = startX + (targetX - startX) * eased;
      const y = startY + (targetY - startY) * eased;
      el.setAttribute('transform', `translate(${x}, ${y})`);

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }

  function animateAttribute(el, attr, targetValue) {
    const startValue = parseFloat(el.getAttribute(attr)) || 0;
    const target = parseFloat(targetValue);

    if (Math.abs(startValue - target) < 0.5) {
      el.setAttribute(attr, targetValue);
      return;
    }

    const duration = 300;
    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress * (2 - progress);
      const current = startValue + (target - startValue) * eased;
      el.setAttribute(attr, current);
      if (progress < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  function createLinkElement(parent, child) {
    const isDown = _direction === 'down';
    const isLeft = child._direction === 'left';

    let d;
    if (isDown) {
      const x1 = parent.x + parent.width / 2;
      const y1 = parent.y + parent.height;
      const x2 = child.x + child.width / 2;
      const y2 = child.y;
      const cy = (y1 + y2) / 2;
      d = `M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}`;
    } else if (isLeft) {
      const x1 = parent.x;
      const y1 = parent.y + parent.height / 2;
      const x2 = child.x + child.width;
      const y2 = child.y + child.height / 2;
      const cx = (x1 + x2) / 2;
      d = `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
    } else {
      const x1 = parent.x + parent.width;
      const y1 = parent.y + parent.height / 2;
      const x2 = child.x;
      const y2 = child.y + child.height / 2;
      const cx = (x1 + x2) / 2;
      d = `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
    }

    const path = createSvgEl('path', {
      class: `mm-link depth-${Math.min(parent.depth, 2)}`,
      d,
    });

    return path;
  }

  function _createTextFO(node) {
    const fontSize = LayoutEngine.DEFAULTS.fontSize[Math.min(node.depth, 3)];
    const fontWeight = LayoutEngine.DEFAULTS.fontWeight[Math.min(node.depth, 3)];
    const padH = node.depth === 0 ? LayoutEngine.DEFAULTS.rootPadH : LayoutEngine.DEFAULTS.nodePadH;

    const fo = createSvgEl('foreignObject', {
      class: 'mm-node-fo',
      x: 0, y: 0,
      width: node.width,
      height: node.height,
    });

    const outer = document.createElement('div');
    outer.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    outer.className = 'mm-text-outer';
    outer.style.cssText =
      `width:${node.width}px;height:${node.height}px;` +
      'display:flex;align-items:center;justify-content:center;' +
      `padding:0 ${padH}px;box-sizing:border-box;` +
      'pointer-events:none;user-select:none;overflow:hidden;';

    const depthClass = node.depth <= 2 ? `depth-${node.depth}` : 'depth-leaf';
    outer.setAttribute('data-depth', depthClass);

    const inner = document.createElement('div');
    inner.className = 'mm-text-inner';
    const ws = node._wrapped ? 'normal' : 'nowrap';
    inner.style.cssText =
      `font-size:${fontSize}px;font-weight:${fontWeight};` +
      `font-family:${LayoutEngine.FONT_FAMILY};line-height:1.45;` +
      `max-width:${node.width - padH * 2}px;` +
      `white-space:${ws};overflow-wrap:break-word;` +
      'text-align:center;';

    if (node._hasLatex && typeof katex !== 'undefined') {
      LayoutEngine.populateLatexText(inner, node.text, fontSize);
    } else if (node._hasRichText) {
      LayoutEngine.populateRichText(inner, node.text, fontSize, fontWeight);
    } else {
      LayoutEngine.populatePlainText(inner, node.text, fontSize, fontWeight);
    }

    outer.appendChild(inner);
    fo.appendChild(outer);
    return fo;
  }

  function truncateText(text, maxWidth, fontSize) {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${fontSize}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    return truncated + '…';
  }

  function countDescendants(node) {
    let count = 0;
    for (const child of node.children) {
      count += 1 + countDescendants(child);
    }
    return count;
  }

  /* ---- Transform (pan/zoom) ---- */

  function setTransform(t) {
    _transform = { ..._transform, ...t };
    applyTransform();
  }

  function getTransform() {
    return { ..._transform };
  }

  function applyTransform() {
    if (_rootGroup) {
      _rootGroup.setAttribute(
        'transform',
        `translate(${_transform.x}, ${_transform.y}) scale(${_transform.scale})`
      );
    }
  }

  function getContentBounds(root) {
    return LayoutEngine.getBounds(root);
  }

  function getSvgElement() {
    return _svg;
  }

  function getNodeElement(id) {
    if (!_nodesGroup) return null;
    return _nodesGroup.querySelector(`[data-id="${id}"]`);
  }

  function getNodesGroup() {
    return _nodesGroup;
  }

  function getLinksGroup() {
    return _linksGroup;
  }

  function getRootGroup() {
    return _rootGroup;
  }

  function getDirection() {
    return _direction;
  }

  function showDropPreview(parentNode, draggedNode, screenX, screenY, insertIndex) {
    removeDropPreview();
    if (!parentNode || !_rootGroup || !draggedNode) return;

    const g = createSvgEl('g', { class: 'mm-drop-preview-group' });
    const isDown = _direction === 'down';

    const ghostW = draggedNode.width * 0.7;
    const ghostH = draggedNode.height * 0.7;

    let ghostSide = parentNode._direction === 'left' ? 'left' : 'right';

    let ghostX, ghostY;

    if (insertIndex >= 0) {
      const children = parentNode.collapsed ? [] : parentNode.children;
      if (_direction === 'mind-map' && parentNode.depth === 0 && children.length > 0) {
        const refIdx = Math.min(insertIndex, children.length - 1);
        const refChild = children[refIdx];
        const parentCx = parentNode.x + parentNode.width / 2;
        ghostSide = (refChild.x + refChild.width / 2) < parentCx ? 'left' : 'right';
      }
      const pos = _computeGhostPosition(parentNode, insertIndex, ghostW, ghostH, isDown, ghostSide === 'left');
      ghostX = pos.x;
      ghostY = pos.y;
    } else {
      const t = getTransform();
      const worldX = (screenX - t.x) / t.scale;
      ghostX = worldX - ghostW / 2;
      ghostY = (screenY - t.y) / t.scale - ghostH / 2;
      if (_direction === 'mind-map' && parentNode.depth === 0) {
        const parentCx = parentNode.x + parentNode.width / 2;
        ghostSide = worldX < parentCx ? 'left' : 'right';
      }
    }

    const isLeft = ghostSide === 'left';

    let x1, y1, x2, y2;
    if (isDown) {
      x1 = parentNode.x + parentNode.width / 2;
      y1 = parentNode.y + parentNode.height;
      x2 = ghostX + ghostW / 2;
      y2 = ghostY;
    } else if (isLeft) {
      x1 = parentNode.x;
      y1 = parentNode.y + parentNode.height / 2;
      x2 = ghostX + ghostW;
      y2 = ghostY + ghostH / 2;
    } else {
      x1 = parentNode.x + parentNode.width;
      y1 = parentNode.y + parentNode.height / 2;
      x2 = ghostX;
      y2 = ghostY + ghostH / 2;
    }

    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    let d;
    if (isDown) {
      d = `M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}`;
    } else {
      d = `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
    }

    const path = createSvgEl('path', { class: 'mm-drop-preview-link', d });
    g.appendChild(path);

    const dot = createSvgEl('circle', {
      class: 'mm-drop-preview-dot', cx: x1, cy: y1, r: 4,
    });
    g.appendChild(dot);

    const depthClass = draggedNode.depth <= 2 ? draggedNode.depth : 'leaf';
    const ghostGroup = createSvgEl('g', {
      class: `mm-drop-ghost-node depth-${depthClass}`,
      transform: `translate(${ghostX}, ${ghostY})`,
    });

    const isLeaf = draggedNode.depth > 2 || (draggedNode.depth > 0 && draggedNode.children.length === 0);
    const rx = draggedNode.depth === 0 ? 12 : (isLeaf ? 4 : 8);
    const rect = createSvgEl('rect', {
      class: 'mm-ghost-rect',
      width: ghostW, height: ghostH, rx, ry: rx,
    });
    ghostGroup.appendChild(rect);

    if (isLeaf) {
      const ul = createSvgEl('line', {
        class: 'mm-ghost-underline',
        x1: 4, y1: ghostH - 1, x2: ghostW - 4, y2: ghostH - 1,
      });
      ghostGroup.appendChild(ul);
    }

    const fontSize = LayoutEngine.DEFAULTS.fontSize[Math.min(draggedNode.depth, 3)] * 0.7;
    const plainText = draggedNode.text.replace(/\*{1,3}(.+?)\*{1,3}/g, '$1').replace(/`([^`]+)`/g, '$1');
    const label = truncateText(plainText, ghostW - 12, fontSize);
    const text = createSvgEl('text', {
      class: 'mm-ghost-text',
      x: ghostW / 2, y: ghostH / 2,
      'text-anchor': 'middle', 'font-size': fontSize,
    });
    text.textContent = label;
    ghostGroup.appendChild(text);

    g.appendChild(ghostGroup);
    _rootGroup.appendChild(g);
  }

  function _computeGhostPosition(parentNode, insertIndex, ghostW, ghostH, isDown, isLeft) {
    const children = parentNode.collapsed ? [] : parentNode.children;

    const defaultPos = (side) => {
      if (isDown) {
        return {
          x: parentNode.x + parentNode.width / 2 - ghostW / 2,
          y: parentNode.y + parentNode.height + 30,
        };
      } else if (side) {
        return {
          x: parentNode.x - ghostW - 30,
          y: parentNode.y + parentNode.height / 2 - ghostH / 2,
        };
      } else {
        return {
          x: parentNode.x + parentNode.width + 30,
          y: parentNode.y + parentNode.height / 2 - ghostH / 2,
        };
      }
    };

    if (children.length === 0) return defaultPos(isLeft);

    let sameChildren;
    if (_direction === 'mind-map' && parentNode.depth === 0) {
      const parentCx = parentNode.x + parentNode.width / 2;
      sameChildren = children.filter(c =>
        isLeft ? (c.x + c.width / 2) < parentCx : (c.x + c.width / 2) >= parentCx
      );
    } else {
      sameChildren = children;
    }

    if (sameChildren.length === 0) return defaultPos(isLeft);

    const refFromList = (list, idx) => {
      let refX, refY;
      if (idx <= 0) {
        refX = list[0].x + list[0].width / 2;
        refY = list[0].y + list[0].height / 2;
      } else if (idx >= list.length) {
        const last = list[list.length - 1];
        refX = last.x + last.width / 2;
        refY = last.y + last.height / 2;
      } else {
        const prev = list[idx - 1];
        const next = list[idx];
        refX = (prev.x + prev.width / 2 + next.x + next.width / 2) / 2;
        refY = (prev.y + prev.height / 2 + next.y + next.height / 2) / 2;
      }
      return { x: refX - ghostW / 2, y: refY - ghostH / 2 };
    };

    if (sameChildren === children) {
      return refFromList(children, insertIndex);
    }

    let localIdx;
    if (insertIndex <= 0) {
      localIdx = 0;
    } else if (insertIndex >= children.length) {
      localIdx = sameChildren.length;
    } else {
      const refChild = children[Math.min(insertIndex, children.length - 1)];
      const pos = sameChildren.indexOf(refChild);
      localIdx = pos >= 0 ? pos : sameChildren.length;
    }

    return refFromList(sameChildren, localIdx);
  }

  function removeDropPreview() {
    if (!_rootGroup) return;
    const existing = _rootGroup.querySelector('.mm-drop-preview-group');
    if (existing) existing.remove();
  }

  return {
    init,
    render,
    setDirection,
    setCallbacks,
    setTransform,
    getTransform,
    applyTransform,
    getContentBounds,
    getSvgElement,
    getNodeElement,
    getNodesGroup,
    getLinksGroup,
    getRootGroup,
    getDirection,
    showDropPreview,
    removeDropPreview,
  };
})();
