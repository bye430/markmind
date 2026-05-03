/**
 * MarkMind — Canvas Editor
 *
 * Provides direct on-canvas editing of mind map nodes.
 *
 * State machine:
 *   idle → (click node) → selected
 *   selected → (dblclick / Enter-on-new) → editing
 *   selected → (Enter) → insert sibling → editing new
 *   selected → (Tab) → insert child → editing new
 *   selected → (Delete) → delete node(s)
 *   editing → (Enter / Escape / click-away) → selected
 *   idle → (drag on blank) → marquee → (mouseup) → selected (multi)
 */

const CanvasEditor = (() => {
  let _state = 'idle';
  let _selectedIds = new Set();
  let _editingId = null;
  let _inputEl = null;
  let _marqueeEl = null;
  let _marqueeStart = null;
  let _isMarquee = false;

  let _dragState = null;
  let _ghostEl = null;
  let _dragHoldTimer = null;
  const DRAG_HOLD_MS = 180;
  const DRAG_THRESHOLD = 6;

  let _svg = null;
  let _callbacks = {
    getRoot: () => null,
    getNodeById: () => null,
    findParent: () => null,
    onInsertSibling: () => {},
    onInsertChild: () => {},
    onDeleteNodes: () => {},
    onRenameNode: () => {},
    onMoveNode: () => {},
    onReorderNode: () => {},
    onSelectChange: () => {},
    performUpdate: () => {},
  };

  function init(svgElement, callbacks) {
    _svg = svgElement;
    Object.assign(_callbacks, callbacks);

    _inputEl = document.createElement('input');
    _inputEl.className = 'mm-inline-input';
    _inputEl.type = 'text';
    document.getElementById('canvas-panel').appendChild(_inputEl);
    _inputEl.style.display = 'none';

    _marqueeEl = document.createElement('div');
    _marqueeEl.className = 'mm-marquee';
    document.getElementById('canvas-panel').appendChild(_marqueeEl);
    _marqueeEl.style.display = 'none';

    _ghostEl = document.createElement('div');
    _ghostEl.className = 'mm-drag-ghost';
    document.getElementById('canvas-panel').appendChild(_ghostEl);
    _ghostEl.style.display = 'none';

    _inputEl.addEventListener('keydown', handleInputKeydown);
    _inputEl.addEventListener('blur', () => {
      if (_state === 'editing') commitEdit();
    });

    window.addEventListener('keydown', handleGlobalKeydown);
  }

  /* ---- Public API for app.js to call ---- */

  function handleNodeMouseDown(node, e) {
    if (e.button !== 0) return;
    if (e.target.closest('.mm-toggle-hit')) return;
    if (_state === 'editing') return;

    const root = _callbacks.getRoot();
    if (root && node.id === root.id) return;

    const canvasPanel = document.getElementById('canvas-panel');
    const rect = canvasPanel.getBoundingClientRect();

    _dragState = {
      nodeId: node.id,
      startX: e.clientX,
      startY: e.clientY,
      panelX: e.clientX - rect.left,
      panelY: e.clientY - rect.top,
      active: false,
      dropTarget: null,
      dropIndex: -1,
      isReorder: false,
    };

    clearTimeout(_dragHoldTimer);
    _dragHoldTimer = setTimeout(() => {
      if (_dragState && !_dragState.active) {
        startDrag();
      }
    }, DRAG_HOLD_MS);
  }

  function handleNodeClick(node, e) {
    if (_dragState && _dragState.active) return;
    cancelDragSetup();

    if (_state === 'editing') {
      commitEdit();
    }

    if (e.ctrlKey || e.metaKey) {
      if (_selectedIds.has(node.id)) {
        _selectedIds.delete(node.id);
      } else {
        _selectedIds.add(node.id);
      }
    } else {
      _selectedIds = new Set([node.id]);
    }

    _state = 'selected';
    applySelectionVisuals();
    _callbacks.onSelectChange([..._selectedIds]);
  }

  function handleNodeDblClick(node) {
    if (_dragState && _dragState.active) return;
    cancelDragSetup();

    _selectedIds = new Set([node.id]);
    _state = 'selected';
    applySelectionVisuals();
    _callbacks.onSelectChange([...(_selectedIds)]);
    startEdit(node.id);
  }

  function handleCanvasMouseDown(e) {
    if (e.target.closest('.mm-node')) return;
    if (e.target.closest('#minimap-container')) return;
    if (e.target.closest('.mm-inline-input')) return;

    if (_state === 'editing') {
      commitEdit();
      return;
    }

    if (_dragState && _dragState.active) {
      finishDrag(e);
      return;
    }

    if (_selectedIds.size > 0) {
      _selectedIds.clear();
      _state = 'idle';
      applySelectionVisuals();
      _callbacks.onSelectChange([]);
    }

    const canvasPanel = document.getElementById('canvas-panel');
    const rect = canvasPanel.getBoundingClientRect();
    _marqueeStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    _isMarquee = false;
  }

  function handleCanvasMouseMove(e) {
    if (_dragState && _dragState.active) {
      updateDrag(e);
      return;
    }

    if (_dragState && !_dragState.active) {
      const dx = Math.abs(e.clientX - _dragState.startX);
      const dy = Math.abs(e.clientY - _dragState.startY);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        startDrag();
        updateDrag(e);
        return;
      }
    }

    if (!_marqueeStart) return;
    if (_state === 'editing') return;

    const canvasPanel = document.getElementById('canvas-panel');
    const rect = canvasPanel.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const dx = Math.abs(cx - _marqueeStart.x);
    const dy = Math.abs(cy - _marqueeStart.y);

    if (!_isMarquee && (dx > 5 || dy > 5)) {
      _isMarquee = true;
      _state = 'marquee';
      _marqueeEl.style.display = 'block';
      if (document.body) document.body.classList.add('mm-marquee-active');
    }

    if (_isMarquee) {
      const left = Math.min(_marqueeStart.x, cx);
      const top = Math.min(_marqueeStart.y, cy);
      const width = Math.abs(cx - _marqueeStart.x);
      const height = Math.abs(cy - _marqueeStart.y);

      _marqueeEl.style.left = left + 'px';
      _marqueeEl.style.top = top + 'px';
      _marqueeEl.style.width = width + 'px';
      _marqueeEl.style.height = height + 'px';
    }
  }

  function handleCanvasMouseUp(e) {
    if (_dragState && _dragState.active) {
      finishDrag(e);
      return;
    }
    cancelDragSetup();

    if (_isMarquee) {
      finishMarquee(e);
    }
    if (document.body) document.body.classList.remove('mm-marquee-active');
    _marqueeStart = null;
    _isMarquee = false;
    _marqueeEl.style.display = 'none';
  }

  /* ---- Drag to reparent ---- */

  function cancelDragSetup() {
    clearTimeout(_dragHoldTimer);
    _dragHoldTimer = null;
    if (_dragState && !_dragState.active) {
      _dragState = null;
    }
  }

  function startDrag() {
    if (!_dragState) return;
    const node = _callbacks.getNodeById(_dragState.nodeId);
    if (!node) { _dragState = null; return; }

    _dragState.active = true;
    _state = 'dragging';
    if (document.body) document.body.classList.add('mm-dragging-node');

    _ghostEl.textContent = node.text.length > 30 ? node.text.slice(0, 30) + '…' : node.text;
    _ghostEl.style.display = 'block';

    const nodeEl = Renderer.getNodeElement(_dragState.nodeId);
    if (nodeEl) nodeEl.classList.add('mm-dragging');

    _svg.style.cursor = 'grabbing';
  }

  function updateDrag(e) {
    if (!_dragState || !_dragState.active) return;

    const canvasPanel = document.getElementById('canvas-panel');
    const rect = canvasPanel.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    _ghostEl.style.left = px + 'px';
    _ghostEl.style.top = py + 'px';

    const svgRect = _svg.getBoundingClientRect();
    const screenX = e.clientX - svgRect.left;
    const screenY = e.clientY - svgRect.top;

    computeDropResult(screenX, screenY);
    applyDropVisuals(screenX, screenY);
  }

  function computeDropResult(screenX, screenY) {
    const root = _callbacks.getRoot();
    if (!root) { clearDropResult(); return; }

    const draggedId = _dragState.nodeId;
    const draggedNode = _callbacks.getNodeById(draggedId);
    if (!draggedNode) { clearDropResult(); return; }

    const currentParent = _callbacks.findParent(draggedId);
    const draggedDepth = draggedNode.depth;
    const validParentDepth = draggedDepth - 1;

    const descendants = new Set();
    collectDescendantIds(draggedNode, descendants);

    const t = Renderer.getTransform();
    const allNodes = MarkdownParser.flatten(root);

    let bestParent = null;
    let bestParentDist = Infinity;
    let bestSibling = null;
    let bestSiblingDist = Infinity;

    for (const node of allNodes) {
      if (node.id === draggedId) continue;
      if (descendants.has(node.id)) continue;
      if (node.x === undefined) continue;

      const cx = node.x * t.scale + t.x + (node.width * t.scale) / 2;
      const cy = node.y * t.scale + t.y + (node.height * t.scale) / 2;
      const dx = screenX - cx;
      const dy = screenY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (node.depth === validParentDepth && dist < bestParentDist) {
        bestParentDist = dist;
        bestParent = node;
      }

      if (node.depth === draggedDepth && dist < bestSiblingDist) {
        bestSiblingDist = dist;
        bestSibling = node;
      }
    }

    if (!bestParent) { clearDropResult(); return; }

    const siblingParent = bestSibling ? _callbacks.findParent(bestSibling.id) : null;
    const siblingParentValid = siblingParent && siblingParent.depth === validParentDepth
      && !descendants.has(siblingParent.id);

    let chosenParent;
    if (bestSibling && siblingParentValid && bestSiblingDist < bestParentDist) {
      chosenParent = siblingParent;
    } else {
      chosenParent = bestParent;
    }

    const isSameParent = currentParent && chosenParent.id === currentParent.id;
    const siblings = chosenParent.collapsed ? [] : chosenParent.children;

    if (siblings.length > (isSameParent ? 1 : 0)) {
      const insertIdx = computeInsertIndex(
        siblings, isSameParent ? draggedId : null, screenX, screenY, t, chosenParent
      );
      _dragState.dropTarget = chosenParent.id;
      _dragState.dropIndex = insertIdx;
      _dragState.isReorder = true;
    } else {
      _dragState.dropTarget = chosenParent.id;
      _dragState.dropIndex = -1;
      _dragState.isReorder = false;
    }
  }

  function computeInsertIndex(siblings, draggedId, screenX, screenY, t, parentNode) {
    const direction = Renderer.getDirection();
    const isDown = direction === 'down';
    const isMindMap = direction === 'mind-map';

    const worldX = (screenX - t.x) / t.scale;
    const worldY = (screenY - t.y) / t.scale;

    if (isMindMap && parentNode && parentNode.depth === 0) {
      const rootCx = parentNode.x + parentNode.width / 2;
      const cursorOnLeft = worldX < rootCx;

      const sideSiblings = siblings.filter(s => {
        if (draggedId && s.id === draggedId) return false;
        const sCx = s.x + s.width / 2;
        return cursorOnLeft ? sCx < rootCx : sCx >= rootCx;
      });

      const otherCount = siblings.filter(s => {
        if (draggedId && s.id === draggedId) return false;
        const sCx = s.x + s.width / 2;
        return cursorOnLeft ? sCx >= rootCx : sCx < rootCx;
      }).length;

      let localIdx = 0;
      for (let i = 0; i < sideSiblings.length; i++) {
        const midY = sideSiblings[i].y + sideSiblings[i].height / 2;
        if (worldY < midY) { localIdx = i; break; }
        localIdx = i + 1;
      }

      if (cursorOnLeft) {
        return otherCount + localIdx;
      } else {
        return localIdx;
      }
    }

    const filtered = draggedId
      ? siblings.filter(s => s.id !== draggedId)
      : siblings;
    if (filtered.length === 0) return 0;

    if (isDown) {
      for (let i = 0; i < filtered.length; i++) {
        const midX = filtered[i].x + filtered[i].width / 2;
        if (worldX < midX) return i;
      }
    } else {
      for (let i = 0; i < filtered.length; i++) {
        const midY = filtered[i].y + filtered[i].height / 2;
        if (worldY < midY) return i;
      }
    }
    return filtered.length;
  }

  function clearDropResult() {
    _dragState.dropTarget = null;
    _dragState.dropIndex = -1;
    _dragState.isReorder = false;
  }

  function collectDescendantIds(node, idSet) {
    for (const child of node.children) {
      idSet.add(child.id);
      collectDescendantIds(child, idSet);
    }
  }

  function applyDropVisuals(screenX, screenY) {
    const nodesGroup = Renderer.getNodesGroup();
    if (nodesGroup) {
      nodesGroup.querySelectorAll('.mm-drop-target').forEach(el => {
        el.classList.remove('mm-drop-target');
      });
    }

    const targetId = _dragState.dropTarget;

    if (!targetId) {
      Renderer.removeDropPreview();
      return;
    }

    const targetNode = _callbacks.getNodeById(targetId);
    if (!targetNode) { Renderer.removeDropPreview(); return; }

    const draggedNode = _callbacks.getNodeById(_dragState.nodeId);
    if (!draggedNode) { Renderer.removeDropPreview(); return; }

    const el = Renderer.getNodeElement(targetId);
    if (el) el.classList.add('mm-drop-target');

    if (_dragState.isReorder) {
      const siblings = targetNode.collapsed ? [] : targetNode.children;
      const currentParent = _callbacks.findParent(_dragState.nodeId);
      const isSameParent = currentParent && currentParent.id === targetId;

      let visualIndex = _dragState.dropIndex;
      if (isSameParent) {
        const filtered = siblings.filter(s => s.id !== _dragState.nodeId);
        const clamped = Math.min(_dragState.dropIndex, filtered.length - 1);
        if (clamped >= 0 && filtered[clamped]) {
          const realPos = siblings.indexOf(filtered[clamped]);
          visualIndex = realPos >= 0 ? realPos : _dragState.dropIndex;
        }
      }
      Renderer.showDropPreview(targetNode, draggedNode, screenX, screenY, visualIndex);
    } else {
      Renderer.showDropPreview(targetNode, draggedNode, screenX, screenY, -1);
    }
  }

  function finishDrag(e) {
    if (!_dragState) return;

    const wasActive = _dragState.active;
    const draggedId = _dragState.nodeId;
    const dropTargetId = _dragState.dropTarget;
    const dropIndex = _dragState.dropIndex;
    const isReorder = _dragState.isReorder;

    cleanupDrag();

    if (!wasActive) return;
    if (!dropTargetId) {
      _state = _selectedIds.size > 0 ? 'selected' : 'idle';
      return;
    }

    const currentParent = _callbacks.findParent(draggedId);
    const isSameParent = currentParent && currentParent.id === dropTargetId;

    if (isSameParent && isReorder) {
      _callbacks.onReorderNode(draggedId, dropTargetId, dropIndex);
    } else if (!isSameParent) {
      _callbacks.onMoveNode(draggedId, dropTargetId, isReorder ? dropIndex : -1);
    }
    _callbacks.performUpdate(true);

    requestAnimationFrame(() => {
      _selectedIds = new Set([draggedId]);
      _state = 'selected';
      applySelectionVisuals();
      _callbacks.onSelectChange([draggedId]);
    });
  }

  function cleanupDrag() {
    clearTimeout(_dragHoldTimer);
    _dragHoldTimer = null;
    if (document.body) document.body.classList.remove('mm-dragging-node');

    if (_ghostEl) _ghostEl.style.display = 'none';
    _svg.style.cursor = '';

    const nodesGroup = Renderer.getNodesGroup();
    if (nodesGroup) {
      nodesGroup.querySelectorAll('.mm-dragging').forEach(el => el.classList.remove('mm-dragging'));
      nodesGroup.querySelectorAll('.mm-drop-target').forEach(el => el.classList.remove('mm-drop-target'));
    }

    Renderer.removeDropPreview();
    _dragState = null;
  }

  function isDragging() {
    return _dragState && _dragState.active;
  }

  /* ---- Marquee selection ---- */

  function finishMarquee() {
    const marqueeRect = _marqueeEl.getBoundingClientRect();
    const root = _callbacks.getRoot();
    if (!root) return;

    const allNodes = MarkdownParser.flatten(root);
    const t = Renderer.getTransform();
    const svgRect = _svg.getBoundingClientRect();
    const hits = new Set();

    for (const node of allNodes) {
      if (node.x === undefined) continue;
      const screenX = node.x * t.scale + t.x + svgRect.left;
      const screenY = node.y * t.scale + t.y + svgRect.top;
      const screenW = node.width * t.scale;
      const screenH = node.height * t.scale;

      if (
        screenX + screenW > marqueeRect.left &&
        screenX < marqueeRect.right &&
        screenY + screenH > marqueeRect.top &&
        screenY < marqueeRect.bottom
      ) {
        hits.add(node.id);
      }
    }

    if (hits.size > 0) {
      _selectedIds = hits;
      _state = 'selected';
    } else {
      _selectedIds.clear();
      _state = 'idle';
    }

    applySelectionVisuals();
    _callbacks.onSelectChange([..._selectedIds]);
  }

  /* ---- Inline editing ---- */

  function startEdit(nodeId) {
    const node = _callbacks.getNodeById(nodeId);
    if (!node) return;

    _editingId = nodeId;
    _state = 'editing';

    const t = Renderer.getTransform();
    const svgRect = _svg.getBoundingClientRect();
    const canvasRect = document.getElementById('canvas-panel').getBoundingClientRect();

    const screenX = node.x * t.scale + t.x + svgRect.left - canvasRect.left;
    const screenY = node.y * t.scale + t.y + svgRect.top - canvasRect.top;
    const screenW = node.width * t.scale;
    const screenH = node.height * t.scale;
    const cfg = LayoutEngine.getCanvasFontConfig();
    const fontSize = cfg.fontSize[Math.min(node.depth, 3)] * t.scale;

    _inputEl.style.display = 'block';
    _inputEl.style.left = screenX + 'px';
    _inputEl.style.top = screenY + 'px';
    _inputEl.style.minWidth = Math.max(screenW, 80) + 'px';
    _inputEl.style.width = 'auto';
    _inputEl.style.height = screenH + 'px';
    _inputEl.style.fontSize = Math.max(fontSize, 11) + 'px';
    _inputEl.value = node.text;
    _inputEl.style.width = Math.max(_inputEl.scrollWidth + 16, screenW, 80) + 'px';

    const nodeEl = Renderer.getNodeElement(nodeId);
    if (nodeEl) nodeEl.style.opacity = '0.15';

    requestAnimationFrame(() => {
      _inputEl.focus();
      _inputEl.select();
    });
  }

  function commitEdit() {
    if (_state !== 'editing' || !_editingId) return;

    const newText = _inputEl.value.trim();
    _inputEl.style.display = 'none';

    const nodeEl = Renderer.getNodeElement(_editingId);
    if (nodeEl) nodeEl.style.opacity = '';

    if (newText && _editingId) {
      _callbacks.onRenameNode(_editingId, newText);
    }

    const prevId = _editingId;
    _editingId = null;
    _state = 'selected';
    _selectedIds = new Set([prevId]);
    applySelectionVisuals();
  }

  function cancelEdit() {
    if (_state !== 'editing') return;

    _inputEl.style.display = 'none';
    const nodeEl = Renderer.getNodeElement(_editingId);
    if (nodeEl) nodeEl.style.opacity = '';

    const prevId = _editingId;
    _editingId = null;
    _state = 'selected';
    _selectedIds = new Set([prevId]);
    applySelectionVisuals();
  }

  /* ---- Keyboard handling ---- */

  function handleInputKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const editingNodeId = _editingId;
      commitEdit();
      _selectedIds = new Set([editingNodeId]);
      _state = 'selected';
      insertChild();
    }
  }

  function handleGlobalKeydown(e) {
    if (_state === 'editing') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (_dragState && _dragState.active && e.key === 'Escape') {
      e.preventDefault();
      cleanupDrag();
      _state = _selectedIds.size > 0 ? 'selected' : 'idle';
      return;
    }
    if (_state === 'dragging') return;

    if (_state === 'selected' && _selectedIds.size > 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (_selectedIds.size === 1) {
          insertSibling();
        }
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        if (_selectedIds.size === 1) {
          insertChild();
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault();
        if (_selectedIds.size === 1) {
          startEdit([..._selectedIds][0]);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        _selectedIds.clear();
        _state = 'idle';
        applySelectionVisuals();
        _callbacks.onSelectChange([]);
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        navigateArrow(e.key);
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (_selectedIds.size === 1) {
          const id = [..._selectedIds][0];
          startEdit(id);
          requestAnimationFrame(() => {
            _inputEl.value = e.key;
            _inputEl.setSelectionRange(1, 1);
          });
          e.preventDefault();
        }
      }
    }
  }

  /* ---- Node operations ---- */

  function insertSibling() {
    if (_selectedIds.size !== 1) return;
    const id = [..._selectedIds][0];
    const node = _callbacks.getNodeById(id);
    if (!node) return;

    if (node.depth === 0) {
      const newId = _callbacks.onInsertChild(id, '细分主题');
      if (newId) {
        _callbacks.performUpdate(true);
        requestAnimationFrame(() => {
          _selectedIds = new Set([newId]);
          _state = 'selected';
          applySelectionVisuals();
          startEdit(newId);
        });
      }
      return;
    }

    const newId = _callbacks.onInsertSibling(id, '细分主题');
    if (newId) {
      _callbacks.performUpdate(true);
      requestAnimationFrame(() => {
        _selectedIds = new Set([newId]);
        _state = 'selected';
        applySelectionVisuals();
        startEdit(newId);
      });
    }
  }

  function insertChild() {
    if (_selectedIds.size !== 1) return;
    const id = [..._selectedIds][0];

    const node = _callbacks.getNodeById(id);
    if (node && node.collapsed) {
      node.collapsed = false;
    }

    const newId = _callbacks.onInsertChild(id, '细分主题');
    if (newId) {
      _callbacks.performUpdate(true);
      requestAnimationFrame(() => {
        _selectedIds = new Set([newId]);
        _state = 'selected';
        applySelectionVisuals();
        startEdit(newId);
      });
    }
  }

  function deleteSelected() {
    if (_selectedIds.size === 0) return;
    const ids = [..._selectedIds];

    const root = _callbacks.getRoot();
    if (root && ids.includes(root.id)) return;

    _callbacks.onDeleteNodes(ids);
    _selectedIds.clear();
    _state = 'idle';
    applySelectionVisuals();
    _callbacks.onSelectChange([]);
    _callbacks.performUpdate(true);
  }

  /* ---- Arrow key navigation ---- */

  function navigateArrow(key) {
    if (_selectedIds.size !== 1) return;
    const id = [..._selectedIds][0];
    const root = _callbacks.getRoot();
    if (!root) return;

    const node = _callbacks.getNodeById(id);
    if (!node) return;

    let target = null;

    if (key === 'ArrowRight') {
      const visible = node.collapsed ? [] : node.children;
      if (visible.length > 0) target = visible[0];
    } else if (key === 'ArrowLeft') {
      target = _callbacks.findParent(id);
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      const parent = _callbacks.findParent(id);
      if (parent) {
        const siblings = parent.children;
        const idx = siblings.findIndex(c => c.id === id);
        if (key === 'ArrowDown' && idx < siblings.length - 1) {
          target = siblings[idx + 1];
        } else if (key === 'ArrowUp' && idx > 0) {
          target = siblings[idx - 1];
        }
      }
    }

    if (target) {
      _selectedIds = new Set([target.id]);
      applySelectionVisuals();
      _callbacks.onSelectChange([target.id]);
    }
  }

  /* ---- Visual feedback ---- */

  function applySelectionVisuals() {
    const nodesGroup = Renderer.getNodesGroup();
    if (!nodesGroup) return;

    nodesGroup.querySelectorAll('.mm-node').forEach(el => {
      el.classList.remove('mm-selected');
    });

    for (const id of _selectedIds) {
      const el = Renderer.getNodeElement(id);
      if (el) el.classList.add('mm-selected');
    }
  }

  function getState() { return _state; }
  function getSelectedIds() { return [..._selectedIds]; }
  function isEditing() { return _state === 'editing'; }
  function isMarquee() { return _isMarquee; }
  function isMarqueeActive() { return _marqueeStart !== null; }

  function clearSelection() {
    _selectedIds.clear();
    _state = 'idle';
    applySelectionVisuals();
  }

  function setSelection(ids) {
    _selectedIds = new Set(ids);
    _state = ids.length > 0 ? 'selected' : 'idle';
    applySelectionVisuals();
    _callbacks.onSelectChange([..._selectedIds]);
  }

  function reapplyAfterRender() {
    applySelectionVisuals();
    if (_state === 'editing' && _editingId) {
      const node = _callbacks.getNodeById(_editingId);
      if (node) {
        const t = Renderer.getTransform();
        const svgRect = _svg.getBoundingClientRect();
        const canvasRect = document.getElementById('canvas-panel').getBoundingClientRect();
        const screenX = node.x * t.scale + t.x + svgRect.left - canvasRect.left;
        const screenY = node.y * t.scale + t.y + svgRect.top - canvasRect.top;
        const screenW = node.width * t.scale;
        const screenH = node.height * t.scale;
        _inputEl.style.left = screenX + 'px';
        _inputEl.style.top = screenY + 'px';
        _inputEl.style.width = Math.max(screenW, 80) + 'px';
        _inputEl.style.height = screenH + 'px';
      }
    }
  }

  return {
    init,
    handleNodeMouseDown,
    handleNodeClick,
    handleNodeDblClick,
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseUp,
    getState,
    getSelectedIds,
    isEditing,
    isDragging,
    isMarquee,
    isMarqueeActive,
    clearSelection,
    setSelection,
    reapplyAfterRender,
    insertSibling,
    insertChild,
  };
})();
