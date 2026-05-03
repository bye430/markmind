/**
 * MarkMind — Interaction Controller
 *
 * Handles pan, zoom, resizer, minimap, and keyboard shortcuts.
 */

const Interactions = (() => {
  let _svg = null;
  let _isPanning = false;
  let _panStart = { x: 0, y: 0 };
  let _zoomInfoEl = null;
  let _zoomInfoTimer = null;
  let _minimapCanvas = null;
  let _minimapViewport = null;
  let _minimapContainer = null;
  let _minimapToggleBtn = null;
  let _minimapCollapsed = false;
  let _currentRoot = null;
  let _onTransformChange = null;
  let _onMinimapToggle = null;
  let _canvasMode = 'marquee'; // 'marquee' | 'pan'

  const ZOOM_MIN = 0.15;
  const ZOOM_MAX = 3;
  const ZOOM_STEP = 0.08;

  function init(svgElement, opts = {}) {
    _svg = svgElement;
    _zoomInfoEl = document.getElementById('zoom-info');
    _minimapCanvas = document.getElementById('minimap');
    _minimapViewport = document.getElementById('minimap-viewport');
    _minimapContainer = document.getElementById('minimap-container');
    _minimapToggleBtn = document.getElementById('minimap-toggle');
    _onTransformChange = opts.onTransformChange || (() => {});
    _onMinimapToggle = opts.onMinimapToggle || (() => {});

    setupPan();
    setupZoom();
    setupResizer();
    setupMinimapDrag();
    setupMinimapToggle();
  }

  /* ---- Pan ---- */
  function setupPan() {
    _svg.addEventListener('mousedown', (e) => {
      if (e.target.closest('.mm-node')) return;
      if (e.target.closest('#minimap-container')) return;
      if (typeof CanvasEditor !== 'undefined' && CanvasEditor.isEditing()) return;

      const wantPan = e.button === 1 || (e.button === 0 && e.altKey) || (_canvasMode === 'pan' && e.button === 0);

      if (wantPan) {
        _isPanning = true;
        _panStart = { x: e.clientX, y: e.clientY };
        _svg.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      if (e.button === 0 && typeof CanvasEditor !== 'undefined') {
        e.preventDefault();
        CanvasEditor.handleCanvasMouseDown(e);
      }
    });

    _svg.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    });

    _svg.addEventListener('dragstart', (e) => {
      if (e.target.closest('.mm-node') || e.target.closest('#mindmap-svg')) e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (typeof CanvasEditor !== 'undefined' && CanvasEditor.isDragging()) {
        e.preventDefault();
        CanvasEditor.handleCanvasMouseMove(e);
        return;
      }
      if (typeof CanvasEditor !== 'undefined' && CanvasEditor.isMarqueeActive && CanvasEditor.isMarqueeActive()) {
        e.preventDefault();
      }

      if (_isPanning) {
        const dx = e.clientX - _panStart.x;
        const dy = e.clientY - _panStart.y;
        _panStart = { x: e.clientX, y: e.clientY };
        const t = Renderer.getTransform();
        Renderer.setTransform({ x: t.x + dx, y: t.y + dy });
        _onTransformChange();
        return;
      }

      if (typeof CanvasEditor !== 'undefined') {
        CanvasEditor.handleCanvasMouseMove(e);
      }
    }, { passive: false });

    window.addEventListener('mouseup', (e) => {
      if (typeof CanvasEditor !== 'undefined' && CanvasEditor.isDragging()) {
        e.preventDefault();
        CanvasEditor.handleCanvasMouseUp(e);
        return;
      }
      if (typeof CanvasEditor !== 'undefined' && CanvasEditor.isMarqueeActive && CanvasEditor.isMarqueeActive()) {
        e.preventDefault();
      }

      if (_isPanning) {
        _isPanning = false;
        _svg.style.cursor = '';
        return;
      }

      if (typeof CanvasEditor !== 'undefined') {
        CanvasEditor.handleCanvasMouseUp(e);
      }
    });
  }

  /* ---- Zoom ---- */
  function setupZoom() {
    _svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const t = Renderer.getTransform();
      const rect = _svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, t.scale + delta));

      const ratio = newScale / t.scale;
      const newX = mouseX - (mouseX - t.x) * ratio;
      const newY = mouseY - (mouseY - t.y) * ratio;

      Renderer.setTransform({ x: newX, y: newY, scale: newScale });
      showZoomInfo(newScale);
      _onTransformChange();
    }, { passive: false });

    _svg.addEventListener('touchstart', handleTouchStart, { passive: false });
    _svg.addEventListener('touchmove', handleTouchMove, { passive: false });
    _svg.addEventListener('touchend', handleTouchEnd, { passive: false });
  }

  let _touches = [];
  let _lastPinchDist = 0;
  let _lastTouchCenter = null;

  function handleTouchStart(e) {
    _touches = Array.from(e.touches);
    if (_touches.length === 2) {
      _lastPinchDist = getTouchDist(_touches);
      _lastTouchCenter = getTouchCenter(_touches);
    } else if (_touches.length === 1) {
      _panStart = { x: _touches[0].clientX, y: _touches[0].clientY };
      _isPanning = true;
    }
  }

  function handleTouchMove(e) {
    e.preventDefault();
    const touches = Array.from(e.touches);

    if (touches.length === 2) {
      const dist = getTouchDist(touches);
      const center = getTouchCenter(touches);
      const t = Renderer.getTransform();

      if (_lastPinchDist > 0) {
        const ratio = dist / _lastPinchDist;
        const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, t.scale * ratio));
        const scaleRatio = newScale / t.scale;
        const rect = _svg.getBoundingClientRect();
        const cx = center.x - rect.left;
        const cy = center.y - rect.top;
        const newX = cx - (cx - t.x) * scaleRatio;
        const newY = cy - (cy - t.y) * scaleRatio;

        Renderer.setTransform({ x: newX, y: newY, scale: newScale });
        showZoomInfo(newScale);
      }

      if (_lastTouchCenter) {
        const dx = center.x - _lastTouchCenter.x;
        const dy = center.y - _lastTouchCenter.y;
        const t2 = Renderer.getTransform();
        Renderer.setTransform({ x: t2.x + dx, y: t2.y + dy });
      }

      _lastPinchDist = dist;
      _lastTouchCenter = center;
      _onTransformChange();

    } else if (touches.length === 1 && _isPanning) {
      const dx = touches[0].clientX - _panStart.x;
      const dy = touches[0].clientY - _panStart.y;
      _panStart = { x: touches[0].clientX, y: touches[0].clientY };
      const t = Renderer.getTransform();
      Renderer.setTransform({ x: t.x + dx, y: t.y + dy });
      _onTransformChange();
    }
  }

  function handleTouchEnd() {
    _isPanning = false;
    _lastPinchDist = 0;
    _lastTouchCenter = null;
  }

  function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function getTouchCenter(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  function showZoomInfo(scale) {
    if (!_zoomInfoEl) return;
    _zoomInfoEl.textContent = `${Math.round(scale * 100)}%`;
    _zoomInfoEl.classList.add('visible');
    clearTimeout(_zoomInfoTimer);
    _zoomInfoTimer = setTimeout(() => {
      _zoomInfoEl.classList.remove('visible');
    }, 1200);
  }

  /* ---- Resizer ---- */
  function setupResizer() {
    const resizer = document.getElementById('resizer');
    const editorPanel = document.getElementById('editor-panel');
    if (!resizer || !editorPanel) return;

    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      resizer.classList.add('active');
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1200;
      const minWidth = 160;
      const maxWidth = Math.max(minWidth + 200, viewportWidth - 160);
      const raw = e.clientX;
      const clamped = Math.max(minWidth, Math.min(maxWidth, raw));
      editorPanel.style.width = clamped + 'px';
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('active');
      }
    });
  }

  /* ---- Minimap toggle ---- */
  function setupMinimapToggle() {
    if (!_minimapToggleBtn || !_minimapContainer) return;
    _minimapToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      _minimapCollapsed = !_minimapCollapsed;
      _minimapContainer.classList.toggle('minimap-collapsed', _minimapCollapsed);
      _minimapToggleBtn.textContent = _minimapCollapsed ? '▤' : '−';
      _minimapToggleBtn.title = _minimapCollapsed ? '展开小地图' : '收起小地图';
      _minimapToggleBtn.setAttribute('aria-label', _minimapCollapsed ? '展开小地图' : '收起小地图');
      if (_onMinimapToggle) _onMinimapToggle();
    });
  }

  function setMinimapCollapsed(collapsed) {
    _minimapCollapsed = !!collapsed;
    if (_minimapContainer) _minimapContainer.classList.toggle('minimap-collapsed', _minimapCollapsed);
    if (_minimapToggleBtn) {
      _minimapToggleBtn.textContent = _minimapCollapsed ? '▤' : '−';
      _minimapToggleBtn.title = _minimapCollapsed ? '展开小地图' : '收起小地图';
      _minimapToggleBtn.setAttribute('aria-label', _minimapCollapsed ? '展开小地图' : '收起小地图');
    }
  }

  function isMinimapCollapsed() {
    return _minimapCollapsed;
  }

  /* ---- Canvas mode (pan vs marquee) ---- */
  function setCanvasMode(mode) {
    _canvasMode = mode === 'pan' ? 'pan' : 'marquee';
  }

  function getCanvasMode() {
    return _canvasMode;
  }

  /* ---- Minimap ---- */
  function updateMinimap(root) {
    _currentRoot = root;
    if (!_minimapCanvas || _minimapCollapsed) return;

    const ctx = _minimapCanvas.getContext('2d');
    const cw = _minimapCanvas.width;
    const ch = _minimapCanvas.height;
    ctx.clearRect(0, 0, cw, ch);

    const bounds = LayoutEngine.getBounds(root);
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const padding = 10;
    const scaleX = (cw - padding * 2) / bounds.width;
    const scaleY = (ch - padding * 2) / bounds.height;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = padding + (cw - padding * 2 - bounds.width * scale) / 2 - bounds.minX * scale;
    const offsetY = padding + (ch - padding * 2 - bounds.height * scale) / 2 - bounds.minY * scale;

    const allNodes = MarkdownParser.flatten(root);

    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--link-color').trim() || '#3a4a7a';
    ctx.lineWidth = 1;
    drawMinimapLinks(ctx, root, scale, offsetX, offsetY);

    for (const node of allNodes) {
      if (node.x === undefined) continue;
      const x = node.x * scale + offsetX;
      const y = node.y * scale + offsetY;
      const w = node.width * scale;
      const h = node.height * scale;

      if (node.depth === 0) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--node-root-bg').trim() || '#6c8cff';
      } else if (node.depth === 1) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--node-l1-bg').trim() || '#2a3a6e';
      } else {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--node-l2-bg').trim() || '#1e2540';
      }

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, Math.max(w, 2), Math.max(h, 2), 2);
      } else {
        ctx.rect(x, y, Math.max(w, 2), Math.max(h, 2));
      }
      ctx.fill();
    }

    updateMinimapViewport(bounds, scale, offsetX, offsetY);
  }

  function drawMinimapLinks(ctx, node, scale, ox, oy) {
    const visibleChildren = node.collapsed ? [] : node.children;
    for (const child of visibleChildren) {
      if (child.x === undefined) continue;
      ctx.beginPath();
      ctx.moveTo(
        (node.x + node.width) * scale + ox,
        (node.y + node.height / 2) * scale + oy
      );
      ctx.lineTo(
        child.x * scale + ox,
        (child.y + child.height / 2) * scale + oy
      );
      ctx.stroke();
      drawMinimapLinks(ctx, child, scale, ox, oy);
    }
  }

  function updateMinimapViewport(bounds, scale, offsetX, offsetY) {
    if (!_minimapViewport || !_svg) return;

    const svgRect = _svg.getBoundingClientRect();
    const t = Renderer.getTransform();

    const viewLeft = -t.x / t.scale;
    const viewTop = -t.y / t.scale;
    const viewWidth = svgRect.width / t.scale;
    const viewHeight = svgRect.height / t.scale;

    const left = viewLeft * scale + offsetX;
    const top = viewTop * scale + offsetY;
    const width = viewWidth * scale;
    const height = viewHeight * scale;

    _minimapViewport.style.left = Math.max(0, left) + 'px';
    _minimapViewport.style.top = Math.max(0, top) + 'px';
    _minimapViewport.style.width = Math.min(180, Math.max(10, width)) + 'px';
    _minimapViewport.style.height = Math.min(120, Math.max(10, height)) + 'px';
  }

  function setupMinimapDrag() {
    const container = document.getElementById('minimap-container');
    if (!container) return;

    let dragging = false;

    container.addEventListener('mousedown', (e) => {
      if (e.target.id === 'minimap-toggle' || e.target.closest('#minimap-toggle')) return;
      if (_minimapCollapsed) return;
      dragging = true;
      handleMinimapClick(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (dragging) handleMinimapClick(e);
    });

    window.addEventListener('mouseup', () => { dragging = false; });
  }

  function handleMinimapClick(e) {
    if (!_currentRoot || !_minimapCanvas || !_svg) return;

    const rect = _minimapCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const bounds = LayoutEngine.getBounds(_currentRoot);
    const cw = _minimapCanvas.width;
    const ch = _minimapCanvas.height;
    const padding = 10;
    const scaleX = (cw - padding * 2) / bounds.width;
    const scaleY = (ch - padding * 2) / bounds.height;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = padding + (cw - padding * 2 - bounds.width * scale) / 2 - bounds.minX * scale;
    const offsetY = padding + (ch - padding * 2 - bounds.height * scale) / 2 - bounds.minY * scale;

    const worldX = (mx - offsetX) / scale;
    const worldY = (my - offsetY) / scale;

    const svgRect = _svg.getBoundingClientRect();
    const t = Renderer.getTransform();

    Renderer.setTransform({
      x: -worldX * t.scale + svgRect.width / 2,
      y: -worldY * t.scale + svgRect.height / 2,
    });
    _onTransformChange();
  }

  /* ---- Fit & Center ---- */
  function fitToView(root) {
    if (!_svg || !root) return;
    const svgRect = _svg.getBoundingClientRect();
    const bounds = LayoutEngine.getBounds(root);
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const padding = 80;
    const scaleX = (svgRect.width - padding * 2) / bounds.width;
    const scaleY = (svgRect.height - padding * 2) / bounds.height;
    const scale = Math.min(scaleX, scaleY, 1.5);

    const cx = bounds.minX + bounds.width / 2;
    const cy = bounds.minY + bounds.height / 2;

    Renderer.setTransform({
      x: svgRect.width / 2 - cx * scale,
      y: svgRect.height / 2 - cy * scale,
      scale,
    });
    showZoomInfo(scale);
    _onTransformChange();
  }

  function centerOnRoot(root) {
    if (!_svg || !root) return;
    const svgRect = _svg.getBoundingClientRect();
    const t = Renderer.getTransform();

    const cx = root.x + root.width / 2;
    const cy = root.y + root.height / 2;

    Renderer.setTransform({
      x: svgRect.width / 2 - cx * t.scale,
      y: svgRect.height / 2 - cy * t.scale,
    });
    _onTransformChange();
  }

  let _centerAnimFrame = null;

  function centerOnNode(node, animate = true) {
    if (!_svg || !node || node.x === undefined) return;
    const svgRect = _svg.getBoundingClientRect();
    const t = Renderer.getTransform();

    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    const targetX = svgRect.width / 2 - cx * t.scale;
    const targetY = svgRect.height / 2 - cy * t.scale;

    if (!animate) {
      Renderer.setTransform({ x: targetX, y: targetY });
      _onTransformChange();
      return;
    }

    if (_centerAnimFrame) cancelAnimationFrame(_centerAnimFrame);

    const startX = t.x, startY = t.y;
    const dx = targetX - startX, dy = targetY - startY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

    const duration = 250;
    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);

      Renderer.setTransform({
        x: startX + dx * ease,
        y: startY + dy * ease,
      });
      _onTransformChange();

      if (progress < 1) {
        _centerAnimFrame = requestAnimationFrame(step);
      } else {
        _centerAnimFrame = null;
      }
    }

    _centerAnimFrame = requestAnimationFrame(step);
  }

  function isPanning() { return _isPanning; }

  return {
    init,
    updateMinimap,
    fitToView,
    centerOnRoot,
    centerOnNode,
    isPanning,
    setMinimapCollapsed,
    isMinimapCollapsed,
    setCanvasMode,
    getCanvasMode,
  };
})();
