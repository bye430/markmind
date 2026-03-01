/**
 * MarkMind — Undo Manager
 *
 * Maintains an independent undo/redo stack for structural canvas operations
 * (insert, delete, move, rename). Stores Markdown snapshots so any operation
 * can be fully reversed by restoring the prior document state.
 *
 * This stack is intentionally separate from the textarea's native undo history,
 * so Ctrl+Z in the editor does normal text undo while Ctrl+Z on the canvas
 * undoes structural operations.
 */

const UndoManager = (() => {
  const MAX_STACK = 80;

  let _undoStack = [];
  let _redoStack = [];
  let _onRestore = null;

  function init(onRestore) {
    _onRestore = onRestore;
  }

  function pushSnapshot(markdown, selectedIds) {
    _undoStack.push({
      md: markdown,
      sel: selectedIds ? [...selectedIds] : [],
    });
    if (_undoStack.length > MAX_STACK) {
      _undoStack.shift();
    }
    _redoStack = [];
  }

  function undo(currentMarkdown, currentSelectedIds) {
    if (_undoStack.length === 0) return false;

    _redoStack.push({
      md: currentMarkdown,
      sel: currentSelectedIds ? [...currentSelectedIds] : [],
    });

    const snapshot = _undoStack.pop();
    if (_onRestore) _onRestore(snapshot.md, snapshot.sel);
    return true;
  }

  function redo(currentMarkdown, currentSelectedIds) {
    if (_redoStack.length === 0) return false;

    _undoStack.push({
      md: currentMarkdown,
      sel: currentSelectedIds ? [...currentSelectedIds] : [],
    });

    const snapshot = _redoStack.pop();
    if (_onRestore) _onRestore(snapshot.md, snapshot.sel);
    return true;
  }

  function canUndo() { return _undoStack.length > 0; }
  function canRedo() { return _redoStack.length > 0; }

  function clear() {
    _undoStack = [];
    _redoStack = [];
  }

  return { init, pushSnapshot, undo, redo, canUndo, canRedo, clear };
})();
