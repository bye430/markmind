(function () {
  'use strict';

  const CUSTOM_THEMES_STORAGE_KEY = 'markmind_custom_themes';

  /** 默认自定义配色方案配色结构，应与主应用中的结构保持一致 */
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

  function saveCustomThemes(list) {
    try {
      localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(list));
    } catch (_) {
      // ignore
    }
  }

  /** 以主界面当前正在使用的配色方案为模板生成一份颜色对象 */
  function createColorsFromCurrentSession() {
    try {
      const raw = localStorage.getItem('markmind_session');
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.customColors && typeof data.customColors === 'object') {
          // 使用会话中记录的配色作为基础，并补齐默认字段
          return Object.assign(createDefaultCustomColors(), data.customColors);
        }
      }
    } catch (_) {
      // ignore parse errors
    }
    return createDefaultCustomColors();
  }

  function ensureAtLeastOneTheme() {
    const list = loadCustomThemes();
    if (list.length === 0) {
      // 不自动创建任何自定义配色方案，完全由用户手动新建
      return [list, null];
    }
    return [list, list[0].id];
  }

  function $(id) {
    return document.getElementById(id);
  }

  let currentThemeId = null;

  function renderThemeList(selectedId) {
    const container = $('tm-theme-list');
    if (!container) return;
    const list = loadCustomThemes();
    container.innerHTML = '';

    if (!list.length) {
      container.innerHTML = '<div class="mm-tm-empty-tip">暂无自定义配色方案，请点击下方「新建配色方案」。</div>';
      $('btn-tm-delete').disabled = true;
      currentThemeId = null;
      showEditor(null);
      return;
    }

    if (!selectedId) {
      selectedId = currentThemeId || list[0].id;
    }
    currentThemeId = selectedId;
    $('btn-tm-delete').disabled = !currentThemeId;

    list.forEach((theme) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'mm-tm-theme-row' + (theme.id === selectedId ? ' is-active' : '');
      row.dataset.id = theme.id;
      row.textContent = theme.name;
      row.title = theme.name;
      row.addEventListener('click', () => {
        currentThemeId = theme.id;
        renderThemeList(theme.id);
        showEditor(theme.id);
      });
      container.appendChild(row);
    });

    showEditor(selectedId);
  }

  function showEditor(themeId) {
    const emptyEl = $('tm-editor-empty');
    const panelEl = $('tm-editor-panel');
    if (!themeId) {
      if (emptyEl) emptyEl.style.display = '';
      if (panelEl) panelEl.hidden = true;
      return;
    }
    const list = loadCustomThemes();
    const theme = list.find((t) => t.id === themeId);
    if (!theme) {
      if (emptyEl) emptyEl.style.display = '';
      if (panelEl) panelEl.hidden = true;
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (panelEl) panelEl.hidden = false;

    const nameInput = $('tm-theme-name');
    if (nameInput) {
      nameInput.value = theme.name || '';
    }

    const mode = theme.colors && theme.colors.mode === 'uniform' ? 'uniform' : 'levels';
    document.querySelectorAll('input[name="tm-mode"]').forEach((input) => {
      if (input.value === mode) {
        input.checked = true;
      }
    });

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
      const input = document.querySelector('input[data-tm-color="' + key + '"]');
      if (input && theme.colors && typeof theme.colors[key] === 'string') {
        try {
          input.value = theme.colors[key];
        } catch (_) {
          // ignore invalid
        }
      }
    });
    updateModeVisibility();
  }

  function updateModeVisibility() {
    const list = loadCustomThemes();
    const theme = list.find((t) => t.id === currentThemeId);
    const mode = theme && theme.colors && theme.colors.mode === 'uniform' ? 'uniform' : 'levels';
    const uniformSection = document.querySelector('.mm-tm-section-split:nth-of-type(1)');
    const levelsSection = document.querySelector('.mm-tm-section-split:nth-of-type(2)');
    if (uniformSection) {
      uniformSection.classList.toggle('is-disabled', mode !== 'uniform');
    }
    if (levelsSection) {
      levelsSection.classList.toggle('is-disabled', mode !== 'levels');
    }
  }

  function attachEvents() {
    const backBtn = $('btn-tm-back');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
      });
    }

    const confirmBtn = $('btn-tm-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
      });
    }

    const newBtn = $('btn-tm-new');
    if (newBtn) {
      newBtn.addEventListener('click', () => {
        const list = loadCustomThemes();
        const baseName = '新配色方案';
        let idx = 1;
        let name = baseName;
        const existingNames = new Set(list.map((t) => t.name));
        while (existingNames.has(name)) {
          idx += 1;
          name = baseName + ' ' + idx;
        }
        const id = 'ct_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        list.push({
          id,
          name,
          colors: createColorsFromCurrentSession(),
        });
        saveCustomThemes(list);
        currentThemeId = id;
        renderThemeList(id);
      });
    }

    const deleteBtn = $('btn-tm-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        if (!currentThemeId) return;
        const list = loadCustomThemes();
        if (!list.find((t) => t.id === currentThemeId)) return;
        if (!window.confirm('确定要删除当前选中的自定义配色方案吗？此操作不可撤销。')) return;
        const remaining = list.filter((t) => t.id !== currentThemeId);
        saveCustomThemes(remaining);
        currentThemeId = remaining.length ? remaining[0].id : null;
        renderThemeList(currentThemeId || null);
      });
    }

    const nameInput = $('tm-theme-name');
    if (nameInput) {
      nameInput.addEventListener('input', () => {
        if (!currentThemeId) return;
        const list = loadCustomThemes();
        const idx = list.findIndex((t) => t.id === currentThemeId);
        if (idx === -1) return;
        list[idx] = Object.assign({}, list[idx], { name: nameInput.value || '' });
        saveCustomThemes(list);
        renderThemeList(currentThemeId);
      });
    }

    document.querySelectorAll('input[name="tm-mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!currentThemeId || !input.checked) return;
        const list = loadCustomThemes();
        const idx = list.findIndex((t) => t.id === currentThemeId);
        if (idx === -1) return;
        const colors = Object.assign(createDefaultCustomColors(), list[idx].colors || {});
        colors.mode = input.value === 'uniform' ? 'uniform' : 'levels';
        list[idx] = Object.assign({}, list[idx], { colors });
        saveCustomThemes(list);
        updateModeVisibility();
      });
    });

    document.querySelectorAll('input[data-tm-color]').forEach((input) => {
      input.addEventListener('input', () => {
        if (!currentThemeId) return;
        const key = input.getAttribute('data-tm-color');
        if (!key) return;
        const list = loadCustomThemes();
        const idx = list.findIndex((t) => t.id === currentThemeId);
        if (idx === -1) return;
        const colors = Object.assign(createDefaultCustomColors(), list[idx].colors || {});
        colors[key] = input.value;
        list[idx] = Object.assign({}, list[idx], { colors });
        saveCustomThemes(list);
      });
    });
  }

  function init() {
    const [, firstId] = ensureAtLeastOneTheme();
    currentThemeId = firstId;
    renderThemeList(firstId || null);
    attachEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

