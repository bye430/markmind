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
  const btnAddChild = document.getElementById('btn-add-child');
  const btnAddSibling = document.getElementById('btn-add-sibling');
  const btnToggleEditor = document.getElementById('btn-toggle-editor');
  const btnFocusMode = document.getElementById('btn-focus-mode');
  const btnMenu = document.getElementById('btn-menu');
  const menuDropdown = document.getElementById('toolbar-menu-dropdown');
  const btnCanvasMode = document.getElementById('btn-canvas-mode');
  const btnColorSettings = document.getElementById('btn-color-settings');
  const fileInput = document.getElementById('file-input');
  const editorPanel = document.getElementById('editor-panel');
  const canvasPanel = document.getElementById('canvas-panel');

  let currentRoot = null;
  let layoutDirection = 'mind-map';
  let updateTimer = null;
  let currentFileName = 'mindmap.md';
  /** @type {FileSystemFileHandle | null} 通过「打开」或「另存为」得到的可写句柄，用于「保存」时直接写入 */
  let currentFileHandle = null;
  let _suppressEditorSync = false;
  let _dirty = false;
  let _savedContent = '';
  let _externalChangeCheckTimer = null;
  let _externalChangeDialogOpen = false;
  const UPDATE_DELAY = 200;
  const EXTERNAL_CHANGE_CHECK_INTERVAL = 3000;
  const RECENT_FILES_LIMIT = 10;
  const recentFiles = [];
  let recentFilesContainer = null;

  /* ---- Session cache (localStorage) ---- */

  const CACHE_KEY = 'markmind_session';
  const SKIP_CACHE_KEY = 'markmind_skip_cache';
  /** 自定义配色方案列表持久化存储（与 session 缓存分离，清空缓存不影响） */
  const CUSTOM_THEMES_STORAGE_KEY = 'markmind_custom_themes';
  let _cacheTimer = null;
  const CACHE_DELAY = 500;
  let customColors = null;
  let colorPanelEl = null;
  /** 当前正在编辑/使用的自定义配色方案 id（themeSelect 为 custom:<id> 时） */
  let _activeCustomThemeId = null;
  let _gridEnabled = false;
  let _isFocusMode = false;

  const TOOLBAR_CONFIG_KEY = 'markmind_toolbar_config_v2';
  const DEFAULT_TOOLBAR_CONFIG = {
    center: false,
    fit: false,
    collapseAll: true,
    expandAll: true,
    theme: true,
    layout: false,
    canvasMode: true,
    toggleEditor: true,
    colorSettings: false,
    addChild: true,
    addSibling: true,
  };

  function loadToolbarConfig() {
    try {
      const raw = localStorage.getItem(TOOLBAR_CONFIG_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      const base = Object.assign({}, DEFAULT_TOOLBAR_CONFIG);
      if (stored && typeof stored === 'object') {
        for (const k in DEFAULT_TOOLBAR_CONFIG) {
          if (Object.prototype.hasOwnProperty.call(stored, k)) {
            base[k] = !!stored[k];
          }
        }
      }
      return base;
    } catch (_) {
      return Object.assign({}, DEFAULT_TOOLBAR_CONFIG);
    }
  }

  function applyToolbarConfig(config) {
    const cfg = config || loadToolbarConfig();
    if (btnCenter) btnCenter.style.display = cfg.center ? '' : 'none';
    if (btnFit) btnFit.style.display = cfg.fit ? '' : 'none';
    if (btnCollapseAll) btnCollapseAll.style.display = cfg.collapseAll ? '' : 'none';
    if (btnExpandAll) btnExpandAll.style.display = cfg.expandAll ? '' : 'none';
    if (themeSelect) themeSelect.style.display = cfg.theme ? '' : 'none';
    if (layoutSelect) layoutSelect.style.display = cfg.layout ? '' : 'none';
    if (btnCanvasMode) btnCanvasMode.style.display = cfg.canvasMode ? '' : 'none';
    if (btnToggleEditor) btnToggleEditor.style.display = cfg.toggleEditor ? '' : 'none';
    if (btnColorSettings) btnColorSettings.style.display = cfg.colorSettings ? '' : 'none';
    if (btnAddChild) btnAddChild.style.display = cfg.addChild ? '' : 'none';
    if (btnAddSibling) btnAddSibling.style.display = cfg.addSibling ? '' : 'none';
  }

  function saveToolbarConfig(config) {
    try {
      localStorage.setItem(TOOLBAR_CONFIG_KEY, JSON.stringify(config));
    } catch (_) { /* ignore */ }
    applyToolbarConfig(config);
  }

  /** 从 localStorage 读取已保存的自定义配色方案列表（持久化，不受清空缓存影响） */
  function loadCustomThemes() {
    try {
      const raw = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch (_) {
      return [];
    }
  }

  /** 将自定义配色方案列表写入 localStorage */
  function saveCustomThemes(list) {
    try {
      localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(list));
    } catch (_) { /* ignore */ }
  }

  /** 重建配色方案下拉选项：内置配色方案 + 已保存的自定义方案 */
  function rebuildThemeSelectOptions() {
    if (!themeSelect) return;
    const builtin = [
      { value: 'vivid-red', text: '绚丽红' },
      { value: 'default', text: '天空蓝' },
      { value: 'ocean', text: '海洋蓝' },
      { value: 'forest', text: '森林绿' },
      { value: 'sunset', text: '日落橙' },
      { value: 'mono', text: '星空黑' },
    ];
    const saved = loadCustomThemes();
    const currentValue = themeSelect.value;
    themeSelect.innerHTML = '';
    builtin.forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.text;
      themeSelect.appendChild(o);
    });
    if (saved.length > 0) {
      saved.forEach((item) => {
        const o = document.createElement('option');
        o.value = 'custom:' + item.id;
        o.textContent = item.name;
        themeSelect.appendChild(o);
      });
    }
    if (currentValue && Array.prototype.some.call(themeSelect.options, (opt) => opt.value === currentValue)) {
      themeSelect.value = currentValue;
    }
  }

  /** 从主界面跳转到独立的配色方案管理页面 */
  function showThemeManagerDialog() {
    try {
      window.location.href = 'theme-manager.html';
    } catch (_) {
      // ignore
    }
  }

  function saveSessionCache() {
    clearTimeout(_cacheTimer);
    _cacheTimer = setTimeout(_flushCache, CACHE_DELAY);
  }

  function _flushCache() {
    try {
      if (localStorage.getItem(SKIP_CACHE_KEY)) return;
      const t = Renderer.getTransform();
      const currentCanvasMode =
        typeof Interactions !== 'undefined' && Interactions.getCanvasMode
          ? Interactions.getCanvasMode()
          : 'pan';
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
        canvasMode: currentCanvasMode,
        customColors,
        showGrid: _gridEnabled,
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
    /* 不清理 CUSTOM_THEMES_STORAGE_KEY，自定义配色方案持久保留 */
  }

  function setCanvasGridEnabled(enabled) {
    _gridEnabled = !!enabled;
    if (!canvasPanel) return;
    canvasPanel.classList.toggle('canvas-grid-on', _gridEnabled);
  }

  function enterFocusMode() {
    if (_isFocusMode) return;
    _isFocusMode = true;
    document.body.classList.add('mm-focus-mode');
    if (document.documentElement.requestFullscreen) {
      try {
        document.documentElement.requestFullscreen().catch(() => {});
      } catch (_) { /* ignore */ }
    }
  }

  function exitFocusMode() {
    if (!_isFocusMode) return;
    _isFocusMode = false;
    document.body.classList.remove('mm-focus-mode');
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        document.exitFullscreen().catch(() => {});
      } catch (_) { /* ignore */ }
    }
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

## 布局与配色方案
### 布局方向
- 左右分布 (默认，思维导图)
- 向右展开
- 向下展开 (组织架构)
### 配色方案配色
- 绚丽红
- 天空蓝
- 海洋蓝
- 森林绿
- 日落橙
- 星空黑

## 导出与快捷键
### 导出 SVG
- 矢量图无损缩放
- 保留完整配色方案样式
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
    const startLevel = Math.min(Math.max(root._headingLevel || 1, 1), 6);
    serializeNode(root, startLevel, lines, true);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  function serializeNode(node, headingLevel, lines, isFirst) {
    const lvl = Math.min(headingLevel, 6);
    if (!isFirst) {
      lines.push('');
    }
    lines.push(`${'#'.repeat(lvl)} ${node.text}`);

    if (node.body && node.body.length > 0) {
      for (const block of node.body) {
        lines.push('');
        const text = serializeBodyBlock(block);
        if (text) lines.push(text);
      }
    }

    for (const child of node.children) {
      serializeNode(child, headingLevel + 1, lines, false);
    }
  }

  function serializeBodyBlock(block) {
    if (!block) return '';
    if (block.type === 'list') {
      if (block.raw && block.raw.trim() !== '') return block.raw;
      return serializeListItems(block.items || [], 0);
    }
    if (block.type === 'code') {
      if (block.raw && block.raw.trim() !== '') return block.raw;
      return '```' + (block.lang || '') + '\n' + (block.content || '') + '\n```';
    }
    if (block.type === 'paragraph') {
      return block.raw || block.text || '';
    }
    return '';
  }

  function serializeListItems(items, indent) {
    const out = [];
    for (const it of items) {
      const marker = it.ordered ? (it.marker || '1.') : '-';
      out.push(`${'  '.repeat(indent)}${marker} ${it.text}`);
      if (it.children && it.children.length > 0) {
        out.push(serializeListItems(it.children, indent + 1));
      }
    }
    return out.join('\n');
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

  function makeBlankNode(text, depth) {
    return {
      id: 'n' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      text,
      depth,
      children: [],
      body: [],
      collapsed: false,
      bodyExpanded: false,
      _key: text + '@tmp-' + Date.now(),
      _hasLatex: false,
      _type: 'heading',
      _headingLevel: Math.min(depth + 1, 6),
    };
  }

  function onInsertSibling(nodeId, text) {
    saveUndoSnapshot();
    const parent = findParent(nodeId);
    if (!parent) return null;

    const node = getNodeById(nodeId);
    const idx = parent.children.indexOf(node);

    const newNode = makeBlankNode(text, node.depth);

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

    const newNode = makeBlankNode(text, node.depth + 1);

    node.children.push(newNode);
    if (node.collapsed) node.collapsed = false;
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
      n._type = 'heading';
      n._headingLevel = Math.min(d + 1, 6);
      for (const c of n.children) fixDepths(c, d + 1);
    })(node, newParent.depth + 1);

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

    rebuildThemeSelectOptions();

    if (cached && cached.md) {
      editor.value = cached.md;
      currentFileName = cached.fileName || 'mindmap.md';
      layoutDirection = cached.layout || 'mind-map';
      _savedContent = cached.savedContent || cached.md;
      _dirty = !!cached.dirty;

      if (cached.theme) {
        if (cached.theme.startsWith('custom:')) {
          const id = cached.theme.slice(7);
          const list = loadCustomThemes();
          const scheme = list.find((s) => s.id === id);
          if (scheme && scheme.colors) {
            customColors = JSON.parse(JSON.stringify(scheme.colors));
            themeSelect.value = cached.theme;
            document.documentElement.setAttribute('data-theme', '');
            applyCustomColors();
          } else {
            // 找不到对应的自定义配色方案时退回内置默认「绚丽红」
            themeSelect.value = 'vivid-red';
            document.documentElement.setAttribute('data-theme', 'vivid-red');
            clearCustomColors();
          }
        } else if (cached.theme === 'custom') {
          // 旧版本遗留的“临时自定义配色方案”，退回内置默认「绚丽红」
          themeSelect.value = 'vivid-red';
          document.documentElement.setAttribute('data-theme', 'vivid-red');
          clearCustomColors();
        } else {
          themeSelect.value = cached.theme;
          document.documentElement.setAttribute(
            'data-theme',
            cached.theme === 'default' ? '' : cached.theme
          );
          clearCustomColors();
        }
      }
      if (cached.layout && layoutSelect) {
        layoutSelect.value = cached.layout;
      } else if (layoutSelect) {
        layoutSelect.value = layoutDirection;
      }
      if (cached.editorCollapsed) editorPanel.classList.add('collapsed');
      if (typeof cached.showGrid === 'boolean') {
        setCanvasGridEnabled(cached.showGrid);
      } else {
        setCanvasGridEnabled(false);
      }
      if (!cached.theme) {
        themeSelect.value = 'vivid-red';
        document.documentElement.setAttribute('data-theme', 'vivid-red');
        clearCustomColors();
      }
    } else {
      editor.value = DEFAULT_MD;
      _savedContent = editor.value;
      layoutDirection = 'mind-map';
      if (layoutSelect) layoutSelect.value = 'mind-map';
      setCanvasGridEnabled(false);
      themeSelect.value = 'vivid-red';
      document.documentElement.setAttribute('data-theme', 'vivid-red');
      clearCustomColors();
    }

    applyToolbarConfig();

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
      onBodyToggle: (node) => {
        node.bodyExpanded = !node.bodyExpanded;
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
    if (cached && cached.canvasMode) {
      Interactions.setCanvasMode(cached.canvasMode);
    } else {
      Interactions.setCanvasMode('pan');
    }

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && _isFocusMode) {
        // 用户按下 ESC 退出全屏时，同步退出专注模式
        _isFocusMode = false;
        document.body.classList.remove('mm-focus-mode');
      }
    });

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
      const value = themeSelect.value;
      if (value.startsWith('custom:')) {
        const id = value.slice(7);
        _activeCustomThemeId = id;
        const list = loadCustomThemes();
        const scheme = list.find((s) => s.id === id);
        if (scheme && scheme.colors) {
          customColors = JSON.parse(JSON.stringify(scheme.colors));
          document.documentElement.setAttribute('data-theme', '');
          applyCustomColors();
        } else {
          if (!customColors) customColors = createDefaultCustomColors();
          applyCustomColors();
        }
      } else {
        _activeCustomThemeId = null;
        document.documentElement.setAttribute('data-theme', value === 'default' ? '' : value);
        clearCustomColors();
      }
      performUpdate(false);
      saveSessionCache();
    });

    layoutSelect.addEventListener('change', () => {
      layoutDirection = layoutSelect.value;
      Renderer.setDirection(layoutDirection);
      performUpdate(true);
      requestAnimationFrame(() => { Interactions.fitToView(currentRoot); saveSessionCache(); });
    });

    if (btnCanvasMode) {
      btnCanvasMode.addEventListener('click', () => {
        const mode = Interactions.getCanvasMode();
        Interactions.setCanvasMode(mode === 'marquee' ? 'pan' : 'marquee');
        updateCanvasModeButton();
        saveSessionCache();
      });
    }

    if (btnColorSettings) {
      btnColorSettings.addEventListener('click', (e) => {
        e.stopPropagation();
        showThemeManagerDialog();
      });
    }

    if (btnFocusMode) {
      btnFocusMode.addEventListener('click', () => {
        enterFocusMode();
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

    if (btnAddChild) {
      btnAddChild.addEventListener('click', () => {
        if (typeof CanvasEditor !== 'undefined' && CanvasEditor.insertChild) {
          CanvasEditor.insertChild();
        }
      });
    }

    if (btnAddSibling) {
      btnAddSibling.addEventListener('click', () => {
        if (typeof CanvasEditor !== 'undefined' && CanvasEditor.insertSibling) {
          CanvasEditor.insertSibling();
        }
      });
    }

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
          if (!action) return;
          if (action === 'open') openFile();
          else if (action === 'save') saveFile();
          else if (action === 'saveAs') saveFileAs();
          else if (action === 'undo') UndoManager.undo(editor.value, CanvasEditor.getSelectedIds());
          else if (action === 'redo') UndoManager.redo(editor.value, CanvasEditor.getSelectedIds());
          else if (action === 'clearCache') {
            clearSessionCache();
            if (typeof alert === 'function') alert('缓存已清空，下次打开将恢复默认界面。');
          } else if (action === 'exportSvg') exportSvg();
          else if (action === 'centerView') {
            if (btnCenter) btnCenter.click();
          } else if (action === 'fitView') {
            if (btnFit) btnFit.click();
          } else if (action === 'collapseAll') {
            if (btnCollapseAll) btnCollapseAll.click();
          } else if (action === 'expandAll') {
            if (btnExpandAll) btnExpandAll.click();
          } else if (action === 'toggleEditor') {
            if (btnToggleEditor) btnToggleEditor.click();
          } else if (action === 'toggleCanvasMode') {
            if (btnCanvasMode) btnCanvasMode.click();
          } else if (action === 'toggleMinimap') {
            const minimapToggle = document.getElementById('minimap-toggle');
            if (minimapToggle) minimapToggle.click();
          } else if (action === 'focusMode') {
            enterFocusMode();
          } else if (action === 'customizeToolbar') {
            showToolbarCustomizeDialog();
          } else if (action === 'manageThemes') {
            showThemeManagerDialog();
          } else if (action === 'toggleGrid') {
            setCanvasGridEnabled(!_gridEnabled);
            saveSessionCache();
          } else if (action.startsWith('theme:')) {
            const theme = action.split(':')[1];
            if (themeSelect) {
              themeSelect.value = theme;
              themeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else if (action.startsWith('layout:')) {
            const layout = action.split(':')[1];
            if (layoutSelect) {
              layoutSelect.value = layout;
              layoutSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        });
      });
    }

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      currentFileName = file.name;
      currentFileHandle = null;
      const reader = new FileReader();
      reader.onload = (ev) => {
        editor.value = ev.target.result;
        UndoManager.clear();
        performUpdate(false);
        requestAnimationFrame(() => { Interactions.fitToView(currentRoot); saveSessionCache(); });
        markClean();
        stopExternalChangeCheck();
      };
      reader.readAsText(file);
      fileInput.value = '';
    });

    btnToggleEditor.addEventListener('click', () => {
      editorPanel.classList.toggle('collapsed');
      saveSessionCache();
    });

    window.addEventListener('keydown', (e) => {
      // Ctrl+Shift+F / Cmd+Shift+F 进入专注模式（不受焦点限制）
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        enterFocusMode();
        return;
      }

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
        openFile();
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

    window.addEventListener('focus', () => {
      if (currentFileHandle) checkExternalChange();
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
      currentFileHandle = null;
      const reader = new FileReader();
      reader.onload = (ev) => {
        editor.value = ev.target.result;
        UndoManager.clear();
        performUpdate(false);
        requestAnimationFrame(() => { Interactions.fitToView(currentRoot); saveSessionCache(); });
        markClean();
        stopExternalChangeCheck();
      };
      reader.readAsText(file);
    });
  }

  function updateCanvasModeButton() {
    if (!btnCanvasMode) return;
    const mode = typeof Interactions !== 'undefined' && Interactions.getCanvasMode ? Interactions.getCanvasMode() : 'marquee';
    if (mode === 'pan') {
      btnCanvasMode.textContent = '✥';
      btnCanvasMode.title = '当前：拖拽画布。点击切换为框选模式';
    } else {
      btnCanvasMode.textContent = '▣';
      btnCanvasMode.title = '当前：框选模式。点击切换为拖拽画布模式';
    }
  }

  /**
   * Core update pipeline.
   * Parses markdown, preserves state, computes layout, renders, updates minimap.
   */
  let _pendingNewId = null;

  function performUpdate(animate) {
    const md = editor.value;
    const newRoot = MarkdownParser.parse(md);

    tagNodeTypes(newRoot);

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
   * Tag every node as a heading. (After the parser refactor every node in the
   * tree is derived from a markdown heading; list / code / paragraph content
   * lives inside `node.body`.)
   */
  function tagNodeTypes(root /*, md */) {
    const allNodes = MarkdownParser.flatten(root);
    for (const node of allNodes) {
      node._type = 'heading';
    }
  }

  function createDefaultCustomColors() {
    return {
      mode: 'levels',
      canvasBg: '#0f1117',
      editorBg: '#161822',
      linkColor: '#3a4a7a',
      nodeUniformFill: '#6c8cff',
      nodeUniformBorder: '#6c8cff',
      nodeRootFill: '#6c8cff',
      nodeRootBorder: '#6c8cff',
      nodeL1Fill: '#2a3a6e',
      nodeL1Border: '#6c8cff',
      nodeL2Fill: '#1e2540',
      nodeL2Border: '#6c8cff',
      nodeLeafFill: '#0f1117',
      nodeLeafBorder: '#6c8cff',
    };
  }

  function applyCustomColors() {
    if (!customColors) return;
    const root = document.documentElement;
    root.style.setProperty('--canvas-bg', customColors.canvasBg);
    if (customColors.editorBg) {
      root.style.setProperty('--bg-editor', customColors.editorBg);
    }
    root.style.setProperty('--link-color', customColors.linkColor);
    root.style.setProperty('--link-highlight', customColors.linkColor);

    if (customColors.mode === 'uniform') {
      const fill = customColors.nodeUniformFill;
      const border = customColors.nodeUniformBorder;
      root.style.setProperty('--node-root-bg', fill);
      root.style.setProperty('--node-l1-bg', fill);
      root.style.setProperty('--node-l2-bg', fill);
      root.style.setProperty('--node-leaf-bg', fill);
      root.style.setProperty('--node-root-border', border);
      root.style.setProperty('--node-l1-border', border);
      root.style.setProperty('--node-l2-border', border);
      root.style.setProperty('--node-leaf-border', border);
    } else {
      root.style.setProperty('--node-root-bg', customColors.nodeRootFill);
      root.style.setProperty('--node-l1-bg', customColors.nodeL1Fill);
      root.style.setProperty('--node-l2-bg', customColors.nodeL2Fill);
      root.style.setProperty('--node-leaf-bg', customColors.nodeLeafFill);
      root.style.setProperty('--node-root-border', customColors.nodeRootBorder);
      root.style.setProperty('--node-l1-border', customColors.nodeL1Border);
      root.style.setProperty('--node-l2-border', customColors.nodeL2Border);
      root.style.setProperty('--node-leaf-border', customColors.nodeLeafBorder);
    }
  }

  function clearCustomColors() {
    const root = document.documentElement;
    const props = [
      '--canvas-bg',
      '--bg-editor',
      '--link-color',
      '--link-highlight',
      '--node-root-bg',
      '--node-l1-bg',
      '--node-l2-bg',
      '--node-leaf-bg',
      '--node-root-border',
      '--node-l1-border',
      '--node-l2-border',
      '--node-leaf-border',
    ];
    for (const p of props) {
      root.style.removeProperty(p);
    }
  }

  function openColorPanel() {
    if (!customColors) return;
    if (!colorPanelEl) {
      colorPanelEl = buildColorPanelElement();
      document.addEventListener('click', handleDocumentClickForColorPanel);
    }
    if (!document.body.contains(colorPanelEl)) {
      document.body.appendChild(colorPanelEl);
    }
    syncColorPanelFromState();
    updateColorPanelModeVisibility();
  }

  function closeColorPanel() {
    if (colorPanelEl && document.body.contains(colorPanelEl)) {
      colorPanelEl.remove();
    }
  }

  function handleDocumentClickForColorPanel(e) {
    if (!colorPanelEl || !document.body.contains(colorPanelEl)) return;
    if (colorPanelEl.contains(e.target)) return;
    if (btnColorSettings && btnColorSettings.contains(e.target)) return;
    closeColorPanel();
  }

  function buildColorPanelElement() {
    const panel = document.createElement('div');
    panel.className = 'mm-color-panel';
    panel.innerHTML = `
      <button type="button" class="mm-color-panel-close" aria-label="关闭">×</button>
      <div class="mm-color-panel-title">配色设置</div>
      <div class="mm-color-panel-subtitle">仅编辑当前配色方案的配色。新建 / 删除配色方案请在「配色方案管理」中完成。</div>
      <div class="mm-color-panel-mode">
        <span>节点模式：</span>
        <label><input type="radio" name="mm-color-mode" value="uniform"> 统一</label>
        <label><input type="radio" name="mm-color-mode" value="levels"> 按层级</label>
      </div>
      <div class="mm-color-panel-row">
        <label>画布背景</label>
        <input type="color" data-mm-color="canvasBg">
      </div>
      <div class="mm-color-panel-row">
        <label>编辑器背景</label>
        <input type="color" data-mm-color="editorBg">
      </div>
      <div class="mm-color-panel-row">
        <label>连接线</label>
        <input type="color" data-mm-color="linkColor">
      </div>
      <div class="mm-color-panel-section" data-mm-section="uniform">
        <div class="mm-color-panel-subtitle">统一节点颜色</div>
        <div class="mm-color-panel-row">
          <label>填充</label>
          <input type="color" data-mm-color="nodeUniformFill">
        </div>
        <div class="mm-color-panel-row">
          <label>边框</label>
          <input type="color" data-mm-color="nodeUniformBorder">
        </div>
      </div>
      <div class="mm-color-panel-section" data-mm-section="levels">
        <div class="mm-color-panel-subtitle">按层级设置</div>
        <div class="mm-color-panel-row">
          <label>根节点填充</label>
          <input type="color" data-mm-color="nodeRootFill">
        </div>
        <div class="mm-color-panel-row">
          <label>根节点边框</label>
          <input type="color" data-mm-color="nodeRootBorder">
        </div>
        <div class="mm-color-panel-row">
          <label>一级填充</label>
          <input type="color" data-mm-color="nodeL1Fill">
        </div>
        <div class="mm-color-panel-row">
          <label>一级边框</label>
          <input type="color" data-mm-color="nodeL1Border">
        </div>
        <div class="mm-color-panel-row">
          <label>二级填充</label>
          <input type="color" data-mm-color="nodeL2Fill">
        </div>
        <div class="mm-color-panel-row">
          <label>二级边框</label>
          <input type="color" data-mm-color="nodeL2Border">
        </div>
        <div class="mm-color-panel-row">
          <label>叶子填充</label>
          <input type="color" data-mm-color="nodeLeafFill">
        </div>
        <div class="mm-color-panel-row">
          <label>叶子边框</label>
          <input type="color" data-mm-color="nodeLeafBorder">
        </div>
      </div>
    `;

    panel.addEventListener('click', (e) => e.stopPropagation());

    const btnClose = panel.querySelector('.mm-color-panel-close');
    if (btnClose) {
      btnClose.addEventListener('click', () => {
        closeColorPanel();
      });
    }

    panel.querySelectorAll('input[name="mm-color-mode"]').forEach((input) => {
      input.addEventListener('change', (e) => {
        const value = e.target.value === 'uniform' ? 'uniform' : 'levels';
        if (!customColors) customColors = createDefaultCustomColors();
        customColors.mode = value;
        updateColorPanelModeVisibility();
        applyCustomColors();
        performUpdate(false);
        saveSessionCache();
      });
    });

    panel.querySelectorAll('input[type="color"][data-mm-color]').forEach((input) => {
      input.addEventListener('input', (e) => {
        const key = e.target.getAttribute('data-mm-color');
        if (!key) return;
        if (!customColors) customColors = createDefaultCustomColors();
        customColors[key] = e.target.value;
        applyCustomColors();
        persistActiveCustomThemeColors();
        performUpdate(false);
        saveSessionCache();
      });
    });

    // 旧的「保存/删除方案」相关事件在配色方案管理中统一处理，这里不再挂载

    return panel;
  }

  /** 将当前 customColors 写回正在编辑的自定义配色方案（如果有） */
  function persistActiveCustomThemeColors() {
    if (!_activeCustomThemeId || !customColors) return;
    const list = loadCustomThemes();
    const idx = list.findIndex((s) => s.id === _activeCustomThemeId);
    if (idx === -1) return;
    list[idx] = {
      id: list[idx].id,
      name: list[idx].name,
      colors: JSON.parse(JSON.stringify(customColors)),
    };
    saveCustomThemes(list);
  }

  /** 针对指定自定义配色方案，打开配色面板进行编辑 */
  function editThemeColors(themeId) {
    const list = loadCustomThemes();
    const scheme = list.find((s) => s.id === themeId);
    if (!scheme) return; // 不自动创建，必须是已存在的自定义配色方案
    _activeCustomThemeId = themeId;
    customColors = JSON.parse(JSON.stringify(scheme.colors));
    document.documentElement.setAttribute('data-theme', '');
    applyCustomColors();
    if (themeSelect) {
      themeSelect.value = 'custom:' + themeId;
    }
    openColorPanel();
  }

  function syncColorPanelFromState() {
    if (!colorPanelEl || !customColors) return;
    const modeValue = customColors.mode === 'uniform' ? 'uniform' : 'levels';
    const modeInput = colorPanelEl.querySelector(`input[name="mm-color-mode"][value="${modeValue}"]`);
    if (modeInput) modeInput.checked = true;

    const mapping = [
      'canvasBg',
      'editorBg',
      'linkColor',
      'nodeUniformFill',
      'nodeUniformBorder',
      'nodeRootFill',
      'nodeRootBorder',
      'nodeL1Fill',
      'nodeL1Border',
      'nodeL2Fill',
      'nodeL2Border',
      'nodeLeafFill',
      'nodeLeafBorder',
    ];
    mapping.forEach((key) => {
      const input = colorPanelEl.querySelector(`input[data-mm-color="${key}"]`);
      if (input && typeof customColors[key] === 'string') {
        try {
          input.value = customColors[key];
        } catch (_) {
          // ignore invalid color for input[type=color]
        }
      }
    });
  }

  function updateColorPanelModeVisibility() {
    if (!colorPanelEl || !customColors) return;
    const modeValue = customColors.mode === 'uniform' ? 'uniform' : 'levels';
    const uniformSection = colorPanelEl.querySelector('[data-mm-section="uniform"]');
    const levelsSection = colorPanelEl.querySelector('[data-mm-section="levels"]');
    if (uniformSection) {
      uniformSection.classList.toggle('is-hidden', modeValue !== 'uniform');
    }
    if (levelsSection) {
      levelsSection.classList.toggle('is-hidden', modeValue !== 'levels');
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

  function startExternalChangeCheck() {
    stopExternalChangeCheck();
    if (!currentFileHandle) return;
    _externalChangeCheckTimer = setInterval(checkExternalChange, EXTERNAL_CHANGE_CHECK_INTERVAL);
  }

  function stopExternalChangeCheck() {
    if (_externalChangeCheckTimer) {
      clearInterval(_externalChangeCheckTimer);
      _externalChangeCheckTimer = null;
    }
  }

  async function checkExternalChange() {
    if (!currentFileHandle || _externalChangeDialogOpen) return;
    try {
      const file = await currentFileHandle.getFile();
      const diskContent = await file.text();
      if (diskContent === _savedContent) return;
      stopExternalChangeCheck();
      _externalChangeDialogOpen = true;
      showExternalChangeDialog(diskContent);
    } catch (_) { /* 无权限或文件不可用 */ }
  }

  function showExternalChangeDialog(diskContent) {
    const overlay = document.createElement('div');
    overlay.className = 'mm-external-change-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'mm-external-change-title');
    const msg = _dirty
      ? '该文件已被其他程序修改，且当前有未保存的修改。请选择：'
      : '该文件已被其他程序修改。请选择：';
    overlay.innerHTML = `
      <div class="mm-external-change-dialog">
        <p id="mm-external-change-title" class="mm-external-change-title">${msg}</p>
        <div class="mm-external-change-actions">
          <button type="button" data-action="reload">重新加载</button>
          <button type="button" data-action="overwrite">用当前内容覆盖</button>
          <button type="button" data-action="cancel">取消</button>
        </div>
      </div>`;
    const style = document.createElement('style');
    style.textContent = `
      .mm-external-change-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; z-index:9999; }
      .mm-external-change-dialog { background:var(--bg, #fff); padding:1.25rem; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,0.15); max-width:420px; }
      .mm-external-change-title { margin:0 0 1rem; font-size:0.95rem; line-height:1.4; color:var(--text, #333); }
      .mm-external-change-actions { display:flex; gap:0.5rem; flex-wrap:wrap; }
      .mm-external-change-actions button { padding:0.4rem 0.75rem; border-radius:4px; border:1px solid var(--border, #ccc); background:var(--bg, #fff); cursor:pointer; font-size:0.9rem; }
      .mm-external-change-actions button[data-action="reload"] { background:var(--accent, #2563eb); color:#fff; border-color:var(--accent, #2563eb); }
      .mm-external-change-actions button:hover { opacity:0.9; }
    `;
    overlay.appendChild(style);
    document.body.appendChild(overlay);

    function close() {
      _externalChangeDialogOpen = false;
      overlay.remove();
      if (currentFileHandle) startExternalChangeCheck();
    }

    overlay.querySelector('[data-action="reload"]').addEventListener('click', () => {
      editor.value = diskContent;
      _savedContent = diskContent;
      _dirty = false;
      updateTitleDirtyIndicator();
      UndoManager.clear();
      performUpdate(false);
      close();
    });
    overlay.querySelector('[data-action="overwrite"]').addEventListener('click', () => {
      saveFile();
      close();
    });
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  function showToolbarCustomizeDialog() {
    const config = loadToolbarConfig();
    const overlay = document.createElement('div');
    overlay.className = 'mm-toolbar-customize-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'mm-toolbar-customize-title');
    overlay.innerHTML = `
      <div class="mm-toolbar-customize-dialog">
        <p id="mm-toolbar-customize-title" class="mm-toolbar-customize-title">选择要在工具栏中显示的按钮：</p>
        <div class="mm-toolbar-customize-list">
          <label><input type="checkbox" data-key="center" ${config.center ? 'checked' : ''}> 居中视图按钮</label>
          <label><input type="checkbox" data-key="fit" ${config.fit ? 'checked' : ''}> 适应画布按钮</label>
          <label><input type="checkbox" data-key="collapseAll" ${config.collapseAll ? 'checked' : ''}> 全部折叠按钮</label>
          <label><input type="checkbox" data-key="expandAll" ${config.expandAll ? 'checked' : ''}> 全部展开按钮</label>
          <label><input type="checkbox" data-key="theme" ${config.theme ? 'checked' : ''}> 配色方案选择器</label>
          <label><input type="checkbox" data-key="layout" ${config.layout ? 'checked' : ''}> 布局选择器</label>
          <label><input type="checkbox" data-key="addChild" ${config.addChild ? 'checked' : ''}> 新建子节点按钮</label>
          <label><input type="checkbox" data-key="addSibling" ${config.addSibling ? 'checked' : ''}> 新建兄弟节点按钮</label>
          <label><input type="checkbox" data-key="canvasMode" ${config.canvasMode ? 'checked' : ''}> 画布模式按钮</label>
          <label><input type="checkbox" data-key="toggleEditor" ${config.toggleEditor ? 'checked' : ''}> 显示/隐藏编辑器按钮</label>
          <label><input type="checkbox" data-key="colorSettings" ${config.colorSettings ? 'checked' : ''}> 配色按钮</label>
        </div>
        <div class="mm-toolbar-customize-actions">
          <button type="button" data-action="reset">恢复默认</button>
          <div class="mm-toolbar-customize-actions-spacer"></div>
          <button type="button" data-action="cancel">取消</button>
          <button type="button" data-action="save">保存</button>
        </div>
      </div>`;
    const style = document.createElement('style');
    style.textContent = `
      .mm-toolbar-customize-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; z-index:9999; }
      .mm-toolbar-customize-dialog { background:var(--bg, #fff); padding:1.25rem 1.5rem; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,0.15); max-width:420px; width:100%; box-sizing:border-box; }
      .mm-toolbar-customize-title { margin:0 0 0.75rem; font-size:0.95rem; line-height:1.4; color:var(--text, #333); }
      .mm-toolbar-customize-list { display:flex; flex-direction:column; gap:0.25rem; margin-bottom:0.75rem; font-size:0.9rem; }
      .mm-toolbar-customize-list label { display:flex; align-items:center; gap:0.4rem; cursor:pointer; }
      .mm-toolbar-customize-list input[type="checkbox"] { width:14px; height:14px; }
      .mm-toolbar-customize-actions { display:flex; align-items:center; gap:0.5rem; margin-top:0.25rem; }
      .mm-toolbar-customize-actions-spacer { flex:1; }
      .mm-toolbar-customize-actions button { padding:0.35rem 0.8rem; border-radius:4px; border:1px solid var(--border, #ccc); background:var(--bg, #fff); cursor:pointer; font-size:0.85rem; }
      .mm-toolbar-customize-actions button[data-action="save"] { background:var(--accent, #2563eb); color:#fff; border-color:var(--accent, #2563eb); }
      .mm-toolbar-customize-actions button:hover { opacity:0.92; }
    `;
    overlay.appendChild(style);
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    const btnCancel = overlay.querySelector('[data-action="cancel"]');
    const btnSave = overlay.querySelector('[data-action="save"]');
    const btnReset = overlay.querySelector('[data-action="reset"]');

    if (btnCancel) {
      btnCancel.addEventListener('click', () => close());
    }
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        const cfg = loadToolbarConfig();
        overlay.querySelectorAll('input[type="checkbox"][data-key]').forEach((input) => {
          const key = input.getAttribute('data-key');
          if (!key) return;
          cfg[key] = input.checked;
        });
        saveToolbarConfig(cfg);
        close();
      });
    }
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        const cfg = Object.assign({}, DEFAULT_TOOLBAR_CONFIG);
        saveToolbarConfig(cfg);
        overlay.querySelectorAll('input[type="checkbox"][data-key]').forEach((input) => {
          const key = input.getAttribute('data-key');
          if (!key) return;
          input.checked = !!cfg[key];
        });
      });
    }
  }

  function addRecentFile(name, handle) {
    if (!name || !handle) return;
    const existingIndex = recentFiles.findIndex((entry) => entry.handle === handle);
    if (existingIndex !== -1) {
      recentFiles.splice(existingIndex, 1);
    }
    recentFiles.unshift({ name, handle });
    if (recentFiles.length > RECENT_FILES_LIMIT) {
      recentFiles.length = RECENT_FILES_LIMIT;
    }
    renderRecentFilesMenu();
  }

  function renderRecentFilesMenu() {
    if (!menuDropdown || !recentFiles.length) return;
    const fileParent = menuDropdown.querySelector('.toolbar-menu-parent-wrap');
    if (!fileParent) return;
    const submenu = fileParent.querySelector('.toolbar-menu-submenu');
    if (!submenu) return;

    if (!recentFilesContainer) {
      const separator = document.createElement('div');
      separator.className = 'toolbar-menu-separator';
      submenu.appendChild(separator);

      const header = document.createElement('div');
      header.className = 'toolbar-menu-recent-header';
      header.textContent = '最近文件';
      submenu.appendChild(header);

      const container = document.createElement('div');
      container.className = 'toolbar-menu-recent-list';
      recentFilesContainer = container;
      submenu.appendChild(container);
    }

    recentFilesContainer.innerHTML = '';

    recentFiles.forEach((entry, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toolbar-menu-item';
      btn.setAttribute('data-action', 'openRecent');
      btn.setAttribute('data-index', String(index));
      btn.textContent = entry.name;
      btn.title = entry.name;
      btn.addEventListener('click', () => {
        menuDropdown.classList.remove('is-open');
        menuDropdown.setAttribute('aria-hidden', 'true');
        openRecentFile(index);
      });
      recentFilesContainer.appendChild(btn);
    });

    if (!recentFiles.length) {
      const empty = document.createElement('div');
      empty.className = 'toolbar-menu-recent-empty';
      empty.textContent = '暂无最近文件';
      recentFilesContainer.appendChild(empty);
    }
  }

  async function loadFileFromHandle(handle) {
    const file = await handle.getFile();
    const text = await file.text();
    currentFileName = file.name;
    currentFileHandle = handle;
    editor.value = text;
    _savedContent = text;
    _dirty = false;
    updateTitleDirtyIndicator();
    UndoManager.clear();
    performUpdate(false);
    requestAnimationFrame(() => { Interactions.fitToView(currentRoot); saveSessionCache(); });
    startExternalChangeCheck();
  }

  async function openRecentFile(index) {
    const entry = recentFiles[index];
    if (!entry || !entry.handle) return;
    try {
      await loadFileFromHandle(entry.handle);
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) console.error(e);
      if (typeof alert === 'function') alert('无法重新打开该文件，请使用“打开”重新选择。');
      recentFiles.splice(index, 1);
      renderRecentFilesMenu();
    }
  }

  async function openFile() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }],
          multiple: false,
        });
        await loadFileFromHandle(handle);
        addRecentFile(currentFileName, handle);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    fileInput.click();
  }

  async function saveFile() {
    const content = editor.value;

    if (currentFileHandle) {
      try {
        const writable = await currentFileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        currentFileName = currentFileHandle.name;
        markClean();
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        currentFileHandle = null;
        stopExternalChangeCheck();
      }
    }

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
        currentFileHandle = handle;
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
        currentFileHandle = handle;
        markClean();
        addRecentFile(currentFileName, handle);
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
