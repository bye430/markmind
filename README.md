# MarkMind — Markdown Mind Map

Turn Markdown into an interactive, XMind-style mind map in the browser. Edit in the canvas or in the editor, with LaTeX, rich text, themes, layouts, and session restore.

## Quick Start

No build step. Open in a browser:

```bash
# Option 1: Open file directly
open index.html       # macOS
xdg-open index.html   # Linux

# Option 2: Local server (recommended)
python3 -m http.server 8765
# Then open http://localhost:8765
```

## Features

### Markdown ↔ Mind Map Sync

- Edit Markdown on the left; the mind map updates on the right. Edit nodes on the canvas and the Markdown updates.
- Cursor and selection stay in sync: clicking a node scrolls the editor to that line; moving the cursor in the editor centers the canvas on the corresponding node.

**Markdown support:**

| Syntax | Role |
|--------|------|
| `#`–`######` headings | Tree levels (root, level 1, level 2) |
| `-` / `*` / `+` lists | Leaf nodes, with optional indent nesting |
| `**bold**` `*italic*` `` `code` `` | Inline rich text in nodes |
| `$...$` / `$$...$$` etc. | LaTeX (see table below) |

### LaTeX

Rendered with [KaTeX](https://katex.org/):

| Syntax | Type | Example |
|--------|------|---------|
| `$...$` | Inline | `$E = mc^2$` |
| `\(...\)` | Inline | `\(\alpha + \beta\)` |
| `$$...$$` | Block | `$$\int_0^\infty e^{-x^2} dx$$` |
| `\[...\]` | Block | `\[\sum_{n=1}^{\infty} \frac{1}{n^2}\]` |

### Canvas Editing

All actions on the canvas are reflected in the Markdown:

| Action | How | Notes |
|--------|-----|--------|
| Select | Click node | Editor scrolls to that line |
| Multi-select | `Ctrl` + click | Toggle selection |
| Marquee | Drag on empty area | Select all nodes in rectangle |
| Edit text | Double-click node / `F2` | Inline input; Enter to confirm, Escape to cancel |
| New sibling | With node selected, `Enter` | New node at same level |
| New child | With node selected, `Tab` | New node under current |
| Delete | `Delete` / `Backspace` | Works with multi-select |
| Collapse/expand | Click `+`/`−` next to node | Fold/unfold subtree |
| Move node | Drag node | Reparent or reorder; preview with connector |

**Drag rules:** A node can only be attached to a parent one level above (e.g. level 2 → level 1). Dragging near siblings reorders. Native browser drag and text selection are disabled during node drag and marquee to avoid conflicts.

### Undo / Redo

- **Ctrl+Z** undo, **Ctrl+Y** (or **Ctrl+Shift+Z**) redo.
- Separate from the editor’s text undo; applies to structure only: create, delete, move, rename, reorder.

### Layout & Theme

**Layout** (toolbar): Right (default), Mind Map (left/right), Down (org-chart).

**Theme** (toolbar): Default blue, Ocean, Forest, Sunset, Mono.

### Viewport

| Action | How |
|--------|-----|
| Pan | `Alt` + left drag, or middle-button drag; or switch to “Pan” mode and left-drag |
| Zoom | Mouse wheel (at cursor) |
| Fit | Toolbar “⊞ Fit” / **Ctrl+0** |
| Center root | Toolbar “⌖ Center” |
| Canvas mode | Toolbar “▣ Marquee” ⇄ “✥ Pan”: marquee for box select, pan for left-drag pan |
| Minimap | Bottom-right; click/drag to jump; “−” to collapse to a button, “▤” to expand |
| Touch | Pinch to zoom, single finger to pan |

### Menu & File

Top-right **☰ Menu**:

- **File**: Open (Ctrl+O), Save (Ctrl+S), Save As
- **Edit**: Undo (Ctrl+Z), Redo (Ctrl+Y)
- **Clear cache**: Next open will show the default document
- **Export SVG**: Export current map as vector image

**◐ Editor** (or **Ctrl+E**): Show/hide the left Markdown panel.

| Action | Shortcut |
|--------|----------|
| Open .md | **Ctrl+O** / menu Open / drag file onto window |
| Save | **Ctrl+S** / menu Save |
| Save As | Menu File → Save As |
| Toggle editor | **Ctrl+E** / toolbar “◐” |
| Fit view | **Ctrl+0** |

### Session Cache

- Content, layout, theme, minimap/editor state, and view transform are saved to the browser.
- On next open, the previous session is restored.
- “Clear cache” in the menu removes it; next open shows the default Markdown.

### Unsaved Changes

Closing or leaving the page with unsaved changes triggers the browser’s confirm dialog.

## Project Structure

```
├── index.html          # Entry page
├── style.css           # Styles (themes, menu, nodes)
├── parser.js           # Markdown → tree, LaTeX/rich-text detection
├── layout.js           # Tree layout (Reingold–Tilford), node sizing
├── renderer.js         # SVG incremental render, foreignObject for math/rich text
├── interactions.js     # Zoom, pan, minimap, canvas mode, touch
├── canvas-editor.js    # Canvas state (select, edit, marquee, drag)
├── undo-manager.js     # Undo/redo for structure
└── app.js              # App entry, sync, session cache
```

## Implementation Notes

- **Incremental updates:** Node identity and state transfer so only changed nodes update; others animate to new positions.
- **Layout:** Modified Reingold–Tilford with variable node size and three directions.
- **Math & rich text:** LaTeX and bold/italic/code via `foreignObject`; layout uses off-screen DOM to measure; long text wraps without breaking inside formulas or rich spans.
- **Canvas state:** idle / selected / editing / marquee / dragging; all canvas actions serialize back to Markdown.
- **Dependencies:** Only KaTeX (CDN); rest is vanilla JS/CSS/SVG.

## Browsers

Works in current Chrome, Firefox, Safari, and Edge. Chrome is recommended for the best “Save As” behavior (File System Access API).

## License

MIT
