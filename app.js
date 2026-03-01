/**
 * MarkMind — Application Entry Point
 *
 * Wires together parser, layout, renderer, interactions, and canvas editor.
 * Implements bidirectional sync: editor ↔ canvas.
 */

(function () {
  'use strict';

  const editor = document.getElementById('md-editor');
  const svg = document.getElementById('mindmap-svg');
  const themeSelect = document.getElementById('theme-select');
  const layoutSelect = document.getElementById('layout-select');
  const btnCenter = document.getElementById('btn-center');
  const btnFit = document.getElementById('btn-fit');
  const btnCollapseAll = document.getElementById('btn-collapse-all');
  const btnExpandAll = document.getElementById('btn-expand-all');
  const btnToggleEditor = document.getElementById('btn-toggle-editor');
  const btnMenu = document.getElementById('btn-menu');
  const menuDropdown = document.getElementById('toolbar-menu-dropdown');
  const btnCanvasMode = document.getElementById('btn-canvas-mode');
  const fileInput = document.getElementById('file-input');
  const editorPanel = document.getElementById('editor-panel');

  let currentRoot = null;
  let layoutDirection = 'right';
  let updateTimer = null;
  let currentFileName = 'mindmap.md';
  let _suppressEditorSync = false;
  let _dirty = false;
  let _savedContent = '';
  const UPDATE_DELAY = 200;

  /* ---- Session cache (localStorage) ---- */

  const CACHE_KEY = 'markmind_session';
  const SKIP_CACHE_KEY = 'markmind_skip_cache';
  let _cacheTimer = null;
  const CACHE_DELAY = 500;

  function saveSessionCache() {
    clearTimeout(_cacheTimer);
    _cacheTimer = setTimeout(_flushCache, CACHE_DELAY);
  }

  function _flushCache() {
    try {
      if (localStorage.getItem(SKIP_CACHE_KEY)) return;
      const t = Renderer.getTransform();
      const data = {
        md: editor.value,
        fileName: currentFileName,
        layout: layoutDirection,
        theme: themeSelect.value,
        editorCollapsed: editorPanel.classList.contains('collapsed'),
        cursorPos: editor.selectionStart,
        scrollTop: editor.scrollTop,
        transform: { x: t.x, y: t.y, scale: t.scale },
        dirty: _dirty,
        savedContent: _savedContent,
        minimapCollapsed: typeof Interactions !== 'undefined' && Interactions.isMinimapCollapsed ? Interactions.isMinimapCollapsed() : false,
        canvasMode: typeof Interactions !== 'undefined' && Interactions.getCanvasMode ? Interactions.getCanvasMode() : 'marquee',
        ts: Date.now(),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (_) { /* quota exceeded — ignore */ }
  }

  function loadSessionCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function clearSessionCache() {
    localStorage.removeItem(CACHE_KEY);
    localStorage.setItem(SKIP_CACHE_KEY, '1');
  }

  const DEFAULT_MD = `# MarkMind 脑图工具

## 快速开始
### 编辑 Markdown
- 左侧编辑器输入即时同步画布
- 支持 # 标题 和 - 列表 两种语法
- 编辑器光标移动时画布自动聚焦对应节点
### 画布交互
- 滚轮缩放视图
- Alt + 拖拽平移画布
- 双击节点进入编辑模式
- 单击节点选中并高亮编辑器对应行
### 文件操作
- 支持 .md 文件拖入窗口直接打开
- Ctrl+O 打开文件
- Ctrl+S 保存文件
- 未保存时关闭页面会弹出提示

## Markdown 语法
### 标题层级
- # 根节点 (depth 0)
- ## 一级分支 (depth 1)
- ### 二级分支 (depth 2)
- 更深层级自动转为列表项
### 列表项
- 三级标题下的内容自动渲染为叶子节点
- 支持多级缩进嵌套
- 使用 - 或 * 或 + 均可

## 画布编辑
### 节点选择
- 单击选中节点
- Ctrl + 单击追加/取消选中
- 拖拽空白区域框选多个节点
- 选中节点时编辑器自动滚动到对应行
### 节点编辑
- 双击节点进入编辑模式
- 按 F2 也可进入编辑
- Enter 确认编辑内容
- Escape 取消编辑
### 新建节点
- 选中状态按 Enter 新建同级兄弟节点
- 选中状态按 Tab 新建子节点
- 新节点自动进入编辑模式
### 删除节点
- 选中后按 Delete 删除
- 支持框选多个后批量删除
### 拖拽移动
- 按住节点拖拽寻找新的父节点
- 仅允许挂载到高一级的标题下
- 靠近目标时预览贝塞尔连接线
- 拖拽到兄弟节点附近可调整排序
- 排序时预览缩小版节点和连接线
- 松开鼠标完成移动
### 撤销与恢复
- Ctrl+Z 撤销画布操作
- Ctrl+Y / Ctrl+Shift+Z 恢复
- 独立于编辑器文本的撤销栈
- 支持创建/删除/移动/重命名/排序操作

## 双向焦点同步
### 画布到编辑器
- 单击或双击画布节点
- 编辑器自动滚动到对应 Markdown 行
- 对应行文本被选中高亮
### 编辑器到画布
- 在编辑器中点击或移动光标
- 画布平滑动画聚焦到对应节点
- 节点自动居中并选中高亮

## 富文本格式
### 加粗与斜体
- **加粗文本**显示为粗体
- *斜体文本*显示为斜体
- ***粗斜体***同时加粗和倾斜
### 行内代码
- 使用 \`code\` 标记行内代码
- 节点宽度**自动适应**文本长度

## LaTeX 公式
### 行内公式 (美元符号)
- 欧拉公式 $e^{i\\pi} + 1 = 0$
- 质能方程 $E = mc^2$
- 二次公式 $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$
### 行内公式 (反斜杠)
- 希腊字母 \\(\\alpha + \\beta = \\gamma\\)
- 三角函数 \\(\\sin^2\\theta + \\cos^2\\theta = 1\\)
### 独立公式
- 薛定谔方程 $i\\hbar\\frac{\\partial}{\\partial t}\\Psi = \\hat{H}\\Psi$
- 高斯积分 $\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$
- 麦克斯韦方程 $\\nabla \\times \\vec{E} = -\\frac{\\partial \\vec{B}}{\\partial t}$

## 布局与主题
### 布局方向
- 向右展开 (默认)
- 左右分布 (思维导图)
- 向下展开 (组织架构)
### 主题配色
- 默认主题
- 海洋蓝
- 森林绿
- 日落橙
- 黑白极简

## 导出与快捷键
### 导出 SVG
- 矢量图无损缩放
- 保留完整主题样式
### 全局快捷键
- Ctrl+O 打开文件
- Ctrl+S 保存文件
- Ctrl+E 切换编辑器面板
- Ctrl+Z 撤销 / Ctrl+Y 恢复
- F 适应窗口 / C 居中根节点`;

  /* ---- Node lookup helpers ---- */

  function getNodeById(id) {
    if (!currentRoot) return null;
    const all = MarkdownParser.flatten(currentRoot);
    return all.find(n => n.id === id) || null;
  }

  function findParent(nodeId) {
    if (!currentRoot) return null;
    function search(parent) {
      for (const child of parent.children) {
        if (child.id === nodeId) return parent;
        const found = search(child);
        if (found) return found;
      }
      return null;
    }
    return search(currentRoot);
  }

  /* ---- Tree → Markdown serialization ---- */

  function treeToMarkdown(root) {
    const lines = [];
    serializeNode(root, 1, lines, true);
    return lines.join('\n');
  }

  function serializeNode(node, headingLevel, lines, isFirst) {
    if (node._type === 'list-item') {
      lines.push(`${'  '.repeat(node._indent || 0)}- ${node.text}`);
    } else {
      if (!isFirst && headingLevel <= 2) {
        lines.push('');
      }
      lines.push(`${'#'.repeat(headingLevel)} ${node.text}`);
    }

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child._type === 'list-item') {
        serializeNode(child, headingLevel, lines, false);
      } else {
        serializeNode(child, headingLevel + 1, lines, false);
      }
    }
  }

  function rebuildMarkdownFromTree() {
    if (!currentRoot) return;
    _suppressEditorSync = true;
    const md = treeToMarkdown(currentRoot);
    editor.value = md;
    _suppressEditorSync = false;
    markDirty();
  }

  /* ---- Undo/Redo snapshot helper ---- */

  function saveUndoSnapshot() {
    UndoManager.pushSnapshot(editor.value, CanvasEditor.getSelectedIds());
  }

  function restoreFromSnapshot(md, selectedIds) {
    _suppressEditorSync = true;
    editor.value = md;
    _suppressEditorSync = false;
    markDirty();
    performUpdate(false);

    requestAnimationFrame(() => {
      if (selectedIds && selectedIds.length > 0) {
        CanvasEditor.setSelection(selectedIds);
      } else {
        CanvasEditor.clearSelection();
      }
    });
  }

  /* ---- Canvas edit operations (called by CanvasEditor) ---- */

  let _pendingNewNodeText = null;

  function onInsertSibling(nodeId, text) {
    saveUndoSnapshot();
    const parent = findParent(nodeId);
    if (!parent) return null;

    const node = getNodeById(nodeId);
    const idx = parent.children.indexOf(node);
    const forceList = node._type === 'list-item' || node.depth >= 3;

    const newNode = {
      id: 'n' + Date.now(),
      text,
      depth: node.depth,
      children: [],
      collapsed: false,
      _key: text + '@tmp-' + Date.now(),
      _hasLatex: false,
      _type: forceList ? 'list-item' : 'heading',
      _indent: node._type === 'list-item' ? (node._indent || 0) : 0,
    };

    parent.children.splice(idx + 1, 0, newNode);
    _pendingNewNodeText = text;
    _pendingNewId = newNode.id;
    rebuildMarkdownFromTree();
    return newNode.id;
  }

  function onInsertChild(nodeId, text) {
    saveUndoSnapshot();
    const node = getNodeById(nodeId);
    if (!node) return null;

    const hasListChildren = node.children.length > 0 && node.children[0]._type === 'list-item';
    const forceList = node.depth >= 2 || node._type === 'list-item' || hasListChildren;

    const newNode = {
      id: 'n' + Date.now(),
      text,
      depth: node.depth + 1,
      children: [],
      collapsed: false,
      _key: text + '@tmp-' + Date.now(),
      _hasLatex: false,
      _type: forceList ? 'list-item' : 'heading',
      _indent: forceList ? (node._type === 'list-item' ? (node._indent || 0) + 1 : 0) : 0,
    };

    node.children.push(newNode);
    _pendingNewNodeText = text;
    _pendingNewId = newNode.id;
    rebuildMarkdownFromTree();
    return newNode.id;
  }

  function findNewNodeId() {
    if (!_pendingNewNodeText || !currentRoot) return null;
    const all = MarkdownParser.flatten(currentRoot);
    const found = all.find(n => n.text === _pendingNewNodeText);
    _pendingNewNodeText = null;
    return found ? found.id : null;
  }

  function onDeleteNodes(ids) {
    saveUndoSnapshot();
    const idSet = new Set(ids);

    function removeFromTree(parent) {
      parent.children = parent.children.filter(child => {
        if (idSet.has(child.id)) return false;
        removeFromTree(child);
        return true;
      });
    }

    if (currentRoot && !idSet.has(currentRoot.id)) {
      removeFromTree(currentRoot);
      rebuildMarkdownFromTree();
    }
  }

  let _renamedNodeId = null;
  let _renamedNewText = null;
  let _movedNodeId = null;
  let _movedNodeText = null;

  function onRenameNode(nodeId, newText) {
    saveUndoSnapshot();
    const node = getNodeById(nodeId);
    if (!node) return;
    node.text = newText;
    node._hasLatex = MarkdownParser.hasLatex(newText);
    _renamedNodeId = nodeId;
    _renamedNewText = newText;
    rebuildMarkdownFromTree();
    performUpdate(true);
  }

  function onReorderNode(nodeId, parentId, insertIndex) {
    if (!currentRoot) return;

    const node = getNodeById(nodeId);
    const parent = getNodeById(parentId);
    if (!node || !parent) return;

    const currentIdx = parent.children.indexOf(node);
    if (currentIdx === -1) return;

    if (insertIndex === currentIdx) return;

    saveUndoSnapshot();

    parent.children.splice(currentIdx, 1);
    const finalIdx = Math.min(insertIndex, parent.children.length);
    parent.children.splice(finalIdx, 0, node);

    _movedNodeId = nodeId;
    _movedNodeText = node.text;
    rebuildMarkdownFromTree();
  }

  function onMoveNode(nodeId, newParentId, insertIndex) {
    if (!currentRoot) return;
    if (nodeId === newParentId) return;
    saveUndoSnapshot();

    const node = getNodeById(nodeId);
    const newParent = getNodeById(newParentId);
    if (!node || !newParent) return;

    const oldParent = findParent(nodeId);
    if (!oldParent) return;
    if (oldParent.id === newParentId) return;

    const descendants = new Set();
    (function collect(n) {
      for (const c of n.children) { descendants.add(c.id); collect(c); }
    })(node);
    if (descendants.has(newParentId)) return;

    oldParent.children = oldParent.children.filter(c => c.id !== nodeId);

    node.depth = newParent.depth + 1;
    (function fixDepths(n, d) {
      n.depth = d;
      for (const c of n.children) fixDepths(c, d + 1);
    })(node, newParent.depth + 1);

    const hasListChildren = newParent.children.length > 0 && newParent.children[0]._type === 'list-item';
    const forceList = newParent.depth >= 2 || newParent._type === 'list-item' || hasListChildren;
    if (forceList) {
      node._type = 'list-item';
      node._indent = newParent._type === 'list-item' ? (newParent._indent || 0) + 1 : 0;
    } else {
      node._type = 'heading';
    }

    if (insertIndex >= 0 && insertIndex <= newParent.children.length) {
      newParent.children.splice(insertIndex, 0, node);
    } else {
      newParent.children.push(node);
    }

    if (newParent.collapsed) {
      newParent.collapsed = false;
    }

    _movedNodeId = nodeId;
    _movedNodeText = node.text;
    rebuildMarkdownFromTree();
  }

  /* ---- Bidirectional focus sync ---- */

  let _syncFromEditorTimer = null;
  let _suppressCanvasSync = false;

  function scrollEditorToNode(selectedIds) {
    if (_suppressEditorScroll) return;
    if (!selectedIds || selectedIds.length === 0 || !currentRoot) return;
    const nodeId = selectedIds[selectedIds.length - 1];
    const node = getNodeById(nodeId);
    if (!node || node.line === undefined) return;

    const lines = editor.value.split('\n');
    let charPos = 0;
    for (let i = 0; i < node.line && i < lines.length; i++) {
      charPos += lines[i].length + 1;
    }

    _suppressCanvasSync = true;
    editor.setSelectionRange(charPos, charPos + (lines[node.line] || '').length);
    scrollEditorToLine(node.line, lines);
    requestAnimationFrame(() => { _suppressCanvasSync = false; });
  }

  function scrollEditorToLine(lineIndex, lines) {
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 20;
    const targetScroll = lineIndex * lineHeight - editor.clientHeight / 2 + lineHeight / 2;
    editor.scrollTop = Math.max(0, targetScroll);
  }

  function findNodeAtEditorCursor() {
    if (!currentRoot) return null;
    const cursorPos = editor.selectionStart;
    const textBefore = editor.value.substring(0, cursorPos);
    const lineIndex = textBefore.split('\n').length - 1;

    const allNodes = MarkdownParser.flatten(currentRoot);
    let best = null;
    for (const n of allNodes) {
      if (n.line !== undefined && n.line <= lineIndex) {
        if (!best || n.line > best.line) best = n;
      }
    }
    return best;
  }

  let _suppressEditorScroll = false;

  function syncCanvasFromEditor() {
    if (_suppressCanvasSync) return;
    if (editorPanel.classList.contains('collapsed')) return;
    const node = findNodeAtEditorCursor();
    if (!node) return;
    Interactions.centerOnNode(node);
    _suppressEditorScroll = true;
    CanvasEditor.setSelection([node.id]);
    requestAnimationFrame(() => { _suppressEditorScroll = false; });
  }

  /* ---- Init ---- */

  function markDirty() {
    if (_dirty) return;
    _dirty = true;
    updateTitleDirtyIndicator();
    saveSessionCache();
  }

  function markClean() {
    _savedContent = editor.value;
    _dirty = false;
    updateTitleDirtyIndicator();
    saveSessionCache();
  }

  function updateTitleDirtyIndicator() {
    const base = `MarkMind — ${currentFileName}`;
    document.title = _dirty ? `● ${base}` : base;
  }

  function init() {
    if (localStorage.getItem(SKIP_CACHE_KEY)) {
      localStorage.removeItem(SKIP_CACHE_KEY);
    }
    const cached = loadSessionCache();

    if (cached && cached.md) {
      editor.value = cached.md;
      currentFileName = cached.fileName || 'mindmap.md';
      layoutDirection = cached.layout || 'right';
      _savedContent = cached.savedContent || cached.md;
      _dirty = !!cached.dirty;

      if (cached.theme) {
        themeSelect.value = cached.theme;
        document.documentElement.setAttribute(
          'data-theme', cached.theme === 'default' ? '' : cached.theme
        );
      }
      if (cached.layout) layoutSelect.value = cached.layout;
      if (cached.editorCollapsed) editorPanel.classList.add('collapsed');
    } else {
      editor.value = DEFAULT_MD;
      _savedContent = editor.value;
    }

    updateTitleDirtyIndicator();

    window.addEventListener('beforeunload', (e) => {
      _flushCache();
      if (!_dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });

    UndoManager.init(restoreFromSnapshot);

    Renderer.init(svg);
    Renderer.setDirection(layoutDirection);
    Renderer.setCallbacks({
      onMouseDown: (node, e) => CanvasEditor.handleNodeMouseDown(node, e),
      onClick: (node, e) => CanvasEditor.handleNodeClick(node, e),
      onDblClick: (node) => CanvasEditor.handleNodeDblClick(node),
      onToggle: (node) => {
        node.collapsed = !node.collapsed;
        performUpdate(true);
        saveSessionCache();
      },
    });

    Interactions.init(svg, {
      onTransformChange: () => {
        if (currentRoot) Interactions.updateMinimap(currentRoot);
        CanvasEditor.reapplyAfterRender();
        saveSessionCache();
      },
      onMinimapToggle: () => saveSessionCache(),
    });

    if (cached && cached.minimapCollapsed) Interactions.setMinimapCollapsed(true);
    if (cached && cached.canvasMode) Interactions.setCanvasMode(cached.canvasMode);

    CanvasEditor.init(svg, {
      getRoot: () => currentRoot,
      getNodeById,
      findParent,
      onInsertSibling,
      onInsertChild,
      onDeleteNodes,
      onRenameNode,
      onMoveNode,
      onReorderNode,
      onSelectChange: (ids) => scrollEditorToNode(ids),
      performUpdate: (animate) => performUpdate(animate),
    });

    setupEventListeners();
    performUpdate(false);

    requestAnimationFrame(() => {
      if (cached && cached.transform) {
        Renderer.setTransform(cached.transform);
        if (currentRoot) Interactions.updateMinimap(currentRoot);
      } else {
        Interactions.fitToView(currentRoot);
      }

      if (cached && cached.cursorPos !== undefined) {
        editor.selectionStart = editor.selectionEnd = cached.cursorPos;
        if (cached.scrollTop !== undefined) editor.scrollTop = cached.scrollTop;
      }
      updateCanvasModeButton();
    });
  }

  function setupEventListeners() {
    editor.addEventListener('input', () => {
      if (_suppressEditorSync) return;
      markDirty();
      clearTimeout(updateTimer);
      updateTimer = setTimeout(() => { performUpdate(true); saveSessionCache(); }, UPDATE_DELAY);
    });

    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
        clearTimeout(updateTimer);
        updateTimer = setTimeout(() => performUpdate(true), UPDATE_DELAY);
      }
    });

    editor.addEventListener('click', () => {
      clearTimeout(_syncFromEditorTimer);
      _syncFromEditorTimer = setTimeout(syncCanvasFromEditor, 150);
    });

    editor.addEventListener('keyup', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
           'PageUp', 'PageDown'].includes(e.key)) {
        clearTimeout(_syncFromEditorTimer);
        _syncFromEditorTimer = setTimeout(syncCanvasFromEditor, 150);
      }
    });

    themeSelect.addEventListener('change', () => {
      document.documentElement.setAttribute('data-theme', themeSelect.value === 'default' ? '' : themeSelect.value);
      performUpdate(false);
      saveSessionCache();
    });

    layoutSelect.addEventListener('change', () => {
      layoutDirection = layoutSelect.value;
      Renderer.setDirection(layoutDirection);
      performUpdate(true);
      requestAnimationFrame(() => { Interactions.fitToView(currentRoot); saveSessionCache(); });
    });

    function updateCanvasModeButton() {
      if (!btnCanvasMode) return;
      const mode = typeof Interactions !== 'undefined' && Interactions.getCanvasMode ? Interactions.getCanvasMode() : 'marquee';
      if (mode === 'pan') {
        btnCanvasMode.textContent = '✥ 拖拽';
        btnCanvasMode.title = '当前：拖拽画布。点击切换为框选模式';
      } else {
        btnCanvasMode.textContent = '▣ 框选';
        btnCanvasMode.title = '当前：框选模式。点击切换为拖拽画布模式';
      }
    }

    if (btnCanvasMode) {
      btnCanvasMode.addEventListener('click', () => {
        const mode = Interactions.getCanvasMode();
        Interactions.setCanvasMode(mode === 'marquee' ? 'pan' : 'marquee');
        updateCanvasModeButton();
        saveSessionCache();
      });
    }

    btnCenter.addEventListener('click', () => {
      if (currentRoot) Interactions.centerOnRoot(currentRoot);
    });

    btnFit.addEventListener('click', () => {
      if (currentRoot) Interactions.fitToView(currentRoot);
    });

    btnCollapseAll.addEventListener('click', () => {
      if (currentRoot) {
        setCollapseAll(currentRoot, true);
        performUpdate(true);
      }
    });

    btnExpandAll.addEventListener('click', () => {
      if (currentRoot) {
        setCollapseAll(currentRoot, false);
        performUpdate(true);
      }
    });

    if (btnMenu && menuDropdown) {
      btnMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = menuDropdown.classList.toggle('is-open');
        menuDropdown.setAttribute('aria-hidden', !open);
      });
      document.addEventListener('click', () => {
        menuDropdown.classList.remove('is-open');
        menuDropdown.setAttribute('aria-hidden', 'true');
      });
      menuDropdown.addEventListener('click', (e) => e.stopPropagation());
      menuDropdown.querySelectorAll('.toolbar-menu-item').forEach((el) => {
        el.addEventListener('click', () => {
          const action = el.getAttribute('data-action');
          menuDropdown.classList.remove('is-open');
          menuDropdown.setAttribute('aria-hidden', 'true');
          if (action === 'open') fileInput.click();
          else if (action === 'save') saveFile();
          else if (action === 'saveAs') saveFileAs();
          else if (action === 'undo') UndoManager.undo(editor.value, CanvasEditor.getSelectedIds());
          else if (action === 'redo') UndoManager.redo(editor.value, CanvasEditor.getSelectedIds());
          else if (action === 'clearCache') {
            clearSessionCache();
            if (typeof alert === 'function') alert('缓存已清空，下次打开将恢复默认界面。');
          } else if (action === 'exportSvg') exportSvg();
        });
      });
    }

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      currentFileName = file.name;
      const reader = new FileReader();
      reader.onload = (ev) => {
        editor.value = ev.target.result;
        UndoManager.clear();
        performUpdate(false);
        requestAnimationFrame(() => { Interactions.fitToView(currentRoot); saveSessionCache(); });
        markClean();
      };
      reader.readAsText(file);
      fileInput.value = '';
    });

    btnToggleEditor.addEventListener('click', () => {
      editorPanel.classList.toggle('collapsed');
      saveSessionCache();
    });

    window.addEventListener('keydown', (e) => {
      if (CanvasEditor.isEditing()) return;
      if (e.target.tagName === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        UndoManager.undo(editor.value, CanvasEditor.getSelectedIds());
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        UndoManager.redo(editor.value, CanvasEditor.getSelectedIds());
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        editorPanel.classList.toggle('collapsed');
        saveSessionCache();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        if (currentRoot) Interactions.fitToView(currentRoot);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        fileInput.click();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        if (document.activeElement === editor) return;
        e.preventDefault();
        if (currentRoot) {
          const all = MarkdownParser.flatten(currentRoot);
          // handled via canvas editor in future
        }
      }
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!file.name.match(/\.(md|markdown|txt)$/i)) return;
      currentFileName = file.name;
      const reader = new FileReader();
      reader.onload = (ev) => {
        editor.value = ev.target.result;
        UndoManager.clear();
        performUpdate(false);
        requestAnimationFrame(() => { Interactions.fitToView(currentRoot); saveSessionCache(); });
        markClean();
      };
      reader.readAsText(file);
    });
  }

  /**
   * Core update pipeline.
   * Parses markdown, preserves state, computes layout, renders, updates minimap.
   */
  let _pendingNewId = null;

  function performUpdate(animate) {
    const md = editor.value;
    const newRoot = MarkdownParser.parse(md);

    tagNodeTypes(newRoot, md);

    if (currentRoot) {
      MarkdownParser.transferState(currentRoot, newRoot);
    }

    if (_pendingNewNodeText) {
      const all = MarkdownParser.flatten(newRoot);
      const found = all.find(n => n.text === _pendingNewNodeText);
      if (found && _pendingNewId) {
        found.id = _pendingNewId;
      }
      _pendingNewNodeText = null;
      _pendingNewId = null;
    }

    if (_renamedNodeId && _renamedNewText) {
      const all = MarkdownParser.flatten(newRoot);
      const found = all.find(n => n.text === _renamedNewText);
      if (found) {
        found.id = _renamedNodeId;
      }
      _renamedNodeId = null;
      _renamedNewText = null;
    }

    if (_movedNodeId && _movedNodeText) {
      const all = MarkdownParser.flatten(newRoot);
      const candidates = all.filter(n => n.text === _movedNodeText);
      const unmatched = candidates.find(n => n.id !== _movedNodeId && !n._idRestored);
      if (unmatched) {
        unmatched.id = _movedNodeId;
        unmatched._idRestored = true;
      }
      _movedNodeId = null;
      _movedNodeText = null;
    }

    LayoutEngine.compute(newRoot, layoutDirection);
    Renderer.render(newRoot, animate);
    Interactions.updateMinimap(newRoot);

    currentRoot = newRoot;

    requestAnimationFrame(() => {
      CanvasEditor.reapplyAfterRender();
    });
  }

  /**
   * Tag each node with _type ('heading' or 'list-item') and _indent
   * so we can reconstruct the markdown faithfully.
   */
  function tagNodeTypes(root, md) {
    const lines = md.split('\n');
    const allNodes = MarkdownParser.flatten(root);

    for (const node of allNodes) {
      if (node.line !== undefined && node.line < lines.length) {
        const line = lines[node.line];
        if (line.match(/^\s*[-*+]\s+/)) {
          node._type = 'list-item';
          const indentMatch = line.match(/^(\s*)/);
          node._indent = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;
        } else {
          node._type = 'heading';
        }
      } else {
        node._type = node._type || 'heading';
      }
    }
  }

  function setCollapseAll(node, collapsed) {
    if (node.depth > 0 && node.children.length > 0) {
      node.collapsed = collapsed;
    }
    for (const child of node.children) {
      setCollapseAll(child, collapsed);
    }
  }

  async function saveFile() {
    const content = editor.value;

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: currentFileName,
          types: [{
            description: 'Markdown 文件',
            accept: { 'text/markdown': ['.md'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        currentFileName = handle.name;
        markClean();
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentFileName;
    a.click();
    URL.revokeObjectURL(url);
    markClean();
  }

  async function saveFileAs() {
    const content = editor.value;
    const baseName = currentFileName.replace(/\.(md|markdown|txt)$/i, '') || 'mindmap';
    const suggestedName = baseName + '_副本.md';

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        currentFileName = handle.name;
        markClean();
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
    markClean();
  }

  function exportSvg() {
    if (!svg) return;

    const clone = svg.cloneNode(true);
    const styles = document.createElement('style');
    const computedStyles = getComputedStyle(document.documentElement);
    const cssVars = [
      '--node-root-bg', '--node-root-text', '--node-l1-bg', '--node-l1-text',
      '--node-l2-bg', '--node-l2-text', '--node-leaf-bg', '--node-leaf-text',
      '--link-color', '--border', '--text-muted', '--accent',
    ];

    let inlineCSS = ':root {';
    for (const v of cssVars) {
      inlineCSS += `${v}: ${computedStyles.getPropertyValue(v)};`;
    }
    inlineCSS += '}';

    const styleSheets = document.styleSheets;
    for (const sheet of styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && rule.selectorText.startsWith('.mm-')) {
            inlineCSS += rule.cssText;
          }
        }
      } catch (e) { /* cross-origin */ }
    }

    styles.textContent = inlineCSS;
    clone.insertBefore(styles, clone.firstChild);

    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const bounds = LayoutEngine.getBounds(currentRoot);
    const pad = 40;
    clone.setAttribute('viewBox',
      `${bounds.minX - pad} ${bounds.minY - pad} ${bounds.width + pad * 2} ${bounds.height + pad * 2}`
    );
    clone.setAttribute('width', bounds.width + pad * 2);
    clone.setAttribute('height', bounds.height + pad * 2);

    const rootG = clone.querySelector('.mm-root');
    if (rootG) rootG.setAttribute('transform', '');

    clone.querySelectorAll('.mm-selected').forEach(el => el.classList.remove('mm-selected'));

    const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mindmap.svg';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
