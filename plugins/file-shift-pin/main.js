'use strict';

/*
 * FileShift+Pin
 * -------------------------------------------------------------
 * Drag-and-drop reordering for the Obsidian File Explorer,
 * PLUS a "pin to top" concept that itself supports drag-reordering.
 *
 * Based on FileShift by Qctsu (https://github.com/qctsu/obsidian-file-shift).
 * Pin concept inspired by pin-folder-top, but implemented through
 * DOM ordering instead of CSS `order: !important` so that pinned
 * items can also be dragged among themselves.
 *
 * Data model:
 *   {
 *     version: 2,
 *     active:  boolean,
 *     pinned:  string[],          // names of pinned top-level items, ordered
 *     order:   { [parentPath]: string[] }  // ordered names per parent
 *   }
 *
 * `pinned` only applies to the vault root ("/"). Items appearing in
 * `pinned` are removed from `order["/"]` and rendered before non-pinned
 * items in the root.
 */

const obsidian = require('obsidian');

const DEFAULT_DATA = {
  version: 2,
  active: false,
  pinned: [],
  order: {}
};

class FileShiftPinPlugin extends obsidian.Plugin {

  async onload() {
    const saved = await this.loadData();
    this.data = Object.assign({}, DEFAULT_DATA, saved || {});
    if (!Array.isArray(this.data.pinned)) this.data.pinned = [];
    if (!this.data.order || typeof this.data.order !== 'object') this.data.order = {};

    // One-time migration: if legacy data from pin-folder-top exists, leave it;
    // user can import via command.
    this.isActive = false;
    this.dragState = null;
    this.abortController = null;
    this.mutationObserver = null;
    this.refreshTimer = null;
    this.originalSort = null;

    // Ribbon icon (toggle)
    this.ribbonEl = this.addRibbonIcon(
      'arrow-up-down',
      'FileShift+Pin: OFF',
      () => this.toggle()
    );

    // Commands
    this.addCommand({
      id: 'toggle',
      name: 'Toggle custom ordering on/off',
      callback: () => this.toggle()
    });

    this.addCommand({
      id: 'reset-order',
      name: 'Reset all custom ordering (keeps pins)',
      callback: () => {
        this.data.order = {};
        this.save();
        if (this.isActive) this.restoreDefaultSort();
        new obsidian.Notice('FileShift+Pin: order reset');
        if (this.isActive) this.applyAllOrders();
      }
    });

    this.addCommand({
      id: 'reset-pins',
      name: 'Clear all pinned folders',
      callback: () => {
        this.data.pinned = [];
        this.save();
        this.refreshPinClasses();
        if (this.isActive) this.applyAllOrders();
        new obsidian.Notice('FileShift+Pin: pins cleared');
      }
    });

    this.addCommand({
      id: 'import-from-pin-folder-top',
      name: 'Import pinned list from pin-folder-top',
      callback: async () => {
        try {
          const path = `${this.app.vault.configDir}/plugins/pin-folder-top/data.json`;
          const raw = await this.app.vault.adapter.read(path);
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed?.pinnedPaths) ? parsed.pinnedPaths : [];
          // Only keep top-level (no slash) names
          const names = list
            .map(p => String(p).trim())
            .filter(p => p && !p.includes('/'));
          this.data.pinned = Array.from(new Set(names));
          this.save();
          this.refreshPinClasses();
          if (this.isActive) this.applyAllOrders();
          new obsidian.Notice(`FileShift+Pin: imported ${this.data.pinned.length} pins`);
        } catch (e) {
          new obsidian.Notice('FileShift+Pin: import failed (pin-folder-top data not found)');
        }
      }
    });

    // Right-click menu: pin / unpin (top-level folders only)
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => this.addFolderMenu(menu, file))
    );

    // Auto-activate on layout ready if was active before
    this.app.workspace.onLayoutReady(() => {
      if (this.data.active) {
        setTimeout(() => this.activate(), 400);
      } else {
        // Even if inactive, refresh pin classes so highlight shows
        this.refreshPinClasses();
      }
    });

    // Re-apply order on layout changes
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (this.isActive) this.scheduleRefresh();
        else this.refreshPinClasses();
      })
    );

    // Handle vault changes
    this.registerEvent(
      this.app.vault.on('create', () => {
        if (this.isActive) this.scheduleRefresh();
        else this.refreshPinClasses();
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.removeFromOrder(file.path);
        // Also unpin if needed
        const name = this.getFileName(file.path);
        if (this.getParentPath(file.path) === '/' && this.data.pinned.includes(name)) {
          this.data.pinned = this.data.pinned.filter(n => n !== name);
          this.save();
        }
        if (this.isActive) this.scheduleRefresh();
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.handleRename(oldPath, file.path);
        if (this.isActive) this.scheduleRefresh();
        else this.refreshPinClasses();
      })
    );
  }

  onunload() {
    this.cleanup();
    this.clearPinClasses();
  }

  // ─── Folder context menu ──────────────────────────────────────

  addFolderMenu(menu, file) {
    if (!(file instanceof obsidian.TFolder)) return;
    // Only top-level folders can be pinned
    if (this.getParentPath(file.path) !== '/') return;

    const name = this.getFileName(file.path);
    const pinned = this.data.pinned.includes(name);

    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(pinned ? '取消置顶' : '置顶分支')
        .setIcon(pinned ? 'pin-off' : 'pin')
        .onClick(() => this.togglePin(name));
    });
  }

  togglePin(name) {
    if (this.data.pinned.includes(name)) {
      this.data.pinned = this.data.pinned.filter(n => n !== name);
    } else {
      this.data.pinned.push(name);
      // Remove from root order list (if any) — pinned takes precedence
      if (Array.isArray(this.data.order['/'])) {
        this.data.order['/'] = this.data.order['/'].filter(n => n !== name);
      }
    }
    this.save();
    this.refreshPinClasses();
    if (this.isActive) this.applyAllOrders();
    new obsidian.Notice(
      this.data.pinned.includes(name) ? `已置顶：${name}` : `已取消置顶：${name}`
    );
  }

  // ─── Toggle & Lifecycle ────────────────────────────────────────

  toggle() {
    if (this.isActive) {
      this.deactivate();
    } else {
      this.activate();
    }
  }

  activate() {
    if (this.isActive) return;

    const explorer = this.getExplorer();
    if (!explorer) {
      new obsidian.Notice('File Explorer not found');
      return;
    }

    this.isActive = true;
    this.data.active = true;
    this.save();

    this.ribbonEl.setAttribute('aria-label', 'FileShift+Pin: ON');
    this.ribbonEl.addClass('is-active');
    this.ribbonEl.addClass('fsp-active');

    this.patchSort(explorer);
    this.setupDragHandlers();
    this.applyAllOrders();
    this.refreshPinClasses();

    new obsidian.Notice('FileShift+Pin: ON');
  }

  deactivate() {
    if (!this.isActive) return;

    this.isActive = false;
    this.data.active = false;
    this.save();

    this.ribbonEl.setAttribute('aria-label', 'FileShift+Pin: OFF');
    this.ribbonEl.removeClass('is-active');
    this.ribbonEl.removeClass('fsp-active');

    this.cleanup();
    this.restoreDefaultSort();
    // Keep pin highlight even when ordering is off
    setTimeout(() => this.refreshPinClasses(), 100);

    new obsidian.Notice('FileShift+Pin: OFF');
  }

  cleanup() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unpatchSort();
    this.clearDraggable();
    this.clearIndicators();
  }

  // ─── Explorer Access ───────────────────────────────────────────

  getExplorer() {
    const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
    return leaf ? leaf.view : null;
  }

  getNavContainer() {
    const explorer = this.getExplorer();
    if (!explorer) return null;
    return explorer.containerEl.querySelector('.nav-files-container');
  }

  getChildrenEl(parentPath) {
    const container = this.getNavContainer();
    if (!container) return null;

    if (parentPath === '/') {
      const modRoot = container.querySelector('.mod-root');
      if (modRoot) {
        const el = modRoot.querySelector('.nav-folder-children');
        if (el) return el;
      }
      return container.querySelector('.nav-folder-children') || container;
    }

    const explorer = this.getExplorer();
    if (explorer && explorer.fileItems) {
      const item = explorer.fileItems[parentPath];
      if (item) {
        const el = item.childrenEl || (item.el ? item.el.querySelector('.nav-folder-children') : null);
        if (el) return el;
      }
    }

    const folderTitle = container.querySelector('.nav-folder-title[data-path="' + CSS.escape(parentPath) + '"]');
    if (folderTitle) {
      const folder = folderTitle.closest('.nav-folder');
      if (folder) return folder.querySelector('.nav-folder-children');
    }

    return null;
  }

  // ─── Sort Patching ─────────────────────────────────────────────

  patchSort(explorer) {
    if (this.originalSort) return;

    const orig = explorer.sort.bind(explorer);
    this.originalSort = orig;

    const self = this;
    explorer.sort = function () {
      orig();
      if (self.isActive) {
        requestAnimationFrame(() => {
          self.applyAllOrders();
          self.refreshDraggable();
          self.refreshPinClasses();
        });
      }
    };
  }

  unpatchSort() {
    if (!this.originalSort) return;
    const explorer = this.getExplorer();
    if (explorer) {
      explorer.sort = this.originalSort;
    }
    this.originalSort = null;
  }

  restoreDefaultSort() {
    const explorer = this.getExplorer();
    if (explorer && explorer.sort) {
      explorer.sort();
    }
  }

  // ─── Drag & Drop ──────────────────────────────────────────────

  setupDragHandlers() {
    const container = this.getNavContainer();
    if (!container) return;

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    container.addEventListener('dragstart', (e) => this.onDragStart(e), { capture: true, signal });
    document.addEventListener('dragenter', (e) => this.onDragEnter(e), { capture: true, signal });
    document.addEventListener('dragover', (e) => this.onDragOver(e), { capture: true, signal });
    document.addEventListener('drop', (e) => this.onDrop(e), { capture: true, signal });
    container.addEventListener('dragend', (e) => this.onDragEnd(e), { signal });

    this.refreshDraggable();

    this.mutationObserver = new MutationObserver(() => {
      this.refreshDraggable();
      this.refreshPinClasses();
    });
    this.mutationObserver.observe(container, { childList: true, subtree: true });
  }

  refreshDraggable() {
    const container = this.getNavContainer();
    if (!container) return;

    const titles = container.querySelectorAll('.nav-file-title, .nav-folder-title');
    titles.forEach(el => {
      if (!el.hasAttribute('data-fsp')) {
        el.setAttribute('draggable', 'true');
        el.setAttribute('data-fsp', '1');
      }
    });
  }

  clearDraggable() {
    const container = this.getNavContainer();
    if (!container) return;

    container.querySelectorAll('[data-fsp]').forEach(el => {
      el.removeAttribute('data-fsp');
    });
  }

  clearIndicators() {
    const container = this.getNavContainer();
    if (!container) return;

    container.querySelectorAll('.fs-drop-above, .fs-drop-below, .fs-drop-into').forEach(el => {
      el.classList.remove('fs-drop-above', 'fs-drop-below', 'fs-drop-into');
    });
    container.querySelectorAll('.fs-dragging').forEach(el => {
      el.classList.remove('fs-dragging');
    });
  }

  clearPinClasses() {
    const container = this.getNavContainer();
    if (!container) return;
    container.querySelectorAll('.fsp-pinned, .fsp-pinned-last').forEach(el => {
      el.classList.remove('fsp-pinned');
      el.classList.remove('fsp-pinned-last');
    });
  }

  refreshPinClasses() {
    const container = this.getNavContainer();
    if (!container) return;

    // Clear all
    container.querySelectorAll('.fsp-pinned, .fsp-pinned-last').forEach(el => {
      el.classList.remove('fsp-pinned');
      el.classList.remove('fsp-pinned-last');
    });

    if (this.data.pinned.length === 0) return;

    // Add pin class to each pinned top-level folder
    let lastPinnedEl = null;
    for (const name of this.data.pinned) {
      // data-path for top-level item equals just the name
      const title = container.querySelector(
        `.nav-folder-title[data-path="${CSS.escape(name)}"]`
      );
      if (title) {
        const folder = title.closest('.nav-folder');
        if (folder) {
          folder.classList.add('fsp-pinned');
          lastPinnedEl = folder;
        }
      }
    }
    if (lastPinnedEl) lastPinnedEl.classList.add('fsp-pinned-last');
  }

  // ─── Event Handlers ────────────────────────────────────────────

  findTitle(e) {
    return e.target && e.target.closest
      ? e.target.closest('.nav-file-title, .nav-folder-title')
      : null;
  }

  getParentPath(filePath) {
    const idx = filePath.lastIndexOf('/');
    return idx === -1 ? '/' : filePath.substring(0, idx);
  }

  getFileName(filePath) {
    return filePath.split('/').pop();
  }

  onDragStart(e) {
    const title = this.findTitle(e);
    if (!title) return;

    const path = title.getAttribute('data-path');
    if (!path) return;

    this.dragState = {
      path: path,
      name: this.getFileName(path),
      parentPath: this.getParentPath(path),
      pendingDrop: null
    };

    const item = title.closest('.nav-file, .nav-folder');
    if (item) item.classList.add('fs-dragging');
  }

  isInsideExplorer(e) {
    const container = this.getNavContainer();
    return container && e.target && container.contains(e.target);
  }

  onDragEnter(e) {
    if (!this.dragState) return;
    if (!this.isInsideExplorer(e)) return;

    const title = this.findTitle(e);
    if (title && title.classList.contains('nav-folder-title')) return;

    e.preventDefault();
    e.stopPropagation();
  }

  onDragOver(e) {
    if (!this.dragState) return;

    if (!this.isInsideExplorer(e)) {
      this.clearDropIndicators();
      if (this.dragState) this.dragState.pendingDrop = null;
      return;
    }

    const title = this.findTitle(e);
    if (!title) {
      e.preventDefault();
      e.stopPropagation();
      this.clearDropIndicators();
      if (this.dragState) this.dragState.pendingDrop = null;
      return;
    }

    const path = title.getAttribute('data-path');
    if (!path || path === this.dragState.path) {
      e.preventDefault();
      e.stopPropagation();
      this.clearDropIndicators();
      if (this.dragState) this.dragState.pendingDrop = null;
      return;
    }

    const isFolder = title.classList.contains('nav-folder-title');
    const rect = title.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;

    // Folder center zone (middle 50%) → drop INTO folder (Obsidian handles move)
    if (isFolder && ratio > 0.25 && ratio < 0.75) {
      this.clearDropIndicators();
      title.classList.add('fs-drop-into');
      if (this.dragState) this.dragState.pendingDrop = null;
      return;
    }

    // Reorder zone — only within same parent
    const parentPath = this.getParentPath(path);
    if (parentPath !== this.dragState.parentPath) {
      this.clearDropIndicators();
      if (this.dragState) this.dragState.pendingDrop = null;
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';

    const position = isFolder
      ? (ratio < 0.25 ? 'above' : 'below')
      : (ratio < 0.5 ? 'above' : 'below');

    this.clearDropIndicators();
    title.classList.add(position === 'above' ? 'fs-drop-above' : 'fs-drop-below');

    const container = this.getNavContainer();
    const dragItem = container.querySelector(
      `.nav-file-title[data-path="${CSS.escape(this.dragState.path)}"], .nav-folder-title[data-path="${CSS.escape(this.dragState.path)}"]`
    );
    if (dragItem) {
      const item = dragItem.closest('.nav-file, .nav-folder');
      if (item) item.classList.add('fs-dragging');
    }

    this.dragState.pendingDrop = {
      targetName: this.getFileName(path),
      position: position === 'above' ? 'before' : 'after'
    };
  }

  clearDropIndicators() {
    const container = this.getNavContainer();
    if (!container) return;
    container.querySelectorAll('.fs-drop-above, .fs-drop-below, .fs-drop-into').forEach(el => {
      el.classList.remove('fs-drop-above', 'fs-drop-below', 'fs-drop-into');
    });
  }

  onDrop(e) {
    if (!this.dragState) return;
    if (!this.isInsideExplorer(e)) return;

    if (!this.dragState.pendingDrop) {
      this.clearIndicators();
      this.finishDrag();
      if (this.isActive) this.scheduleRefresh();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const { targetName, position } = this.dragState.pendingDrop;
    this.reorderItem(
      this.dragState.parentPath,
      this.dragState.name,
      targetName,
      position
    );

    this.clearIndicators();
    this.finishDrag();
    if (this.isActive) {
      this.applyAllOrders();
      this.refreshPinClasses();
    }
  }

  onDragEnd() {
    if (this.dragState && this.dragState.pendingDrop) {
      const { targetName, position } = this.dragState.pendingDrop;
      this.reorderItem(
        this.dragState.parentPath,
        this.dragState.name,
        targetName,
        position
      );
      if (this.isActive) {
        this.applyAllOrders();
        this.refreshPinClasses();
      }
    }
    this.clearIndicators();
    this.finishDrag();
  }

  finishDrag() {
    const container = this.getNavContainer();
    if (container) {
      container.querySelectorAll('.fs-dragging').forEach(el => {
        el.classList.remove('fs-dragging');
      });
    }
    this.dragState = null;
  }

  // ─── Order Management ─────────────────────────────────────────

  captureCurrentOrder(parentPath) {
    const parentEl = this.getChildrenEl(parentPath);
    if (!parentEl) return [];

    const order = [];
    for (const child of parentEl.children) {
      const title = child.querySelector(':scope > .nav-file-title[data-path], :scope > .nav-folder-title[data-path]');
      if (title) {
        const path = title.getAttribute('data-path');
        if (path) order.push(this.getFileName(path));
      }
    }
    return order;
  }

  /**
   * Core reorder. For root ("/"), respects the pinned vs. non-pinned split:
   *   - Drop onto a pinned target → source becomes/stays pinned, inserted into `pinned`.
   *   - Drop onto a non-pinned target → source becomes/stays unpinned, inserted into `order["/"]`.
   * Net effect: dragging from non-pinned area INTO pinned area auto-pins;
   * dragging from pinned area INTO non-pinned area auto-unpins.
   */
  reorderItem(parentPath, sourceName, targetName, position) {
    if (parentPath === '/') {
      this.reorderRoot(sourceName, targetName, position);
      return;
    }

    let order = this.data.order[parentPath];
    if (!order || order.length === 0) {
      order = this.captureCurrentOrder(parentPath);
    }

    order = order.filter(n => n !== sourceName);

    const targetIdx = order.indexOf(targetName);
    if (targetIdx === -1) {
      order.push(sourceName);
    } else {
      const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
      order.splice(insertIdx, 0, sourceName);
    }

    this.data.order[parentPath] = order;
    this.save();
  }

  reorderRoot(sourceName, targetName, position) {
    const tgtInPinned = this.data.pinned.includes(targetName);

    // Remove source from BOTH lists first
    this.data.pinned = this.data.pinned.filter(n => n !== sourceName);
    if (!Array.isArray(this.data.order['/'])) {
      this.data.order['/'] = this.captureCurrentOrder('/').filter(
        n => !this.data.pinned.includes(n) && n !== sourceName
      );
    } else {
      this.data.order['/'] = this.data.order['/'].filter(n => n !== sourceName);
    }

    if (tgtInPinned) {
      const tgtIdx = this.data.pinned.indexOf(targetName);
      const insertIdx = position === 'before' ? tgtIdx : tgtIdx + 1;
      this.data.pinned.splice(insertIdx, 0, sourceName);
    } else {
      // Make sure root order has a baseline if empty
      if (this.data.order['/'].length === 0) {
        const base = this.captureCurrentOrder('/').filter(
          n => !this.data.pinned.includes(n) && n !== sourceName
        );
        this.data.order['/'] = base;
      }
      const tgtIdx = this.data.order['/'].indexOf(targetName);
      if (tgtIdx === -1) {
        this.data.order['/'].push(sourceName);
      } else {
        const insertIdx = position === 'before' ? tgtIdx : tgtIdx + 1;
        this.data.order['/'].splice(insertIdx, 0, sourceName);
      }
    }

    this.save();
  }

  applyAllOrders() {
    const explorer = this.getExplorer();
    if (!explorer) return;

    const container = this.getNavContainer();
    if (!container) return;

    // Root: pinned + order["/"]
    const rootOrder = [
      ...this.data.pinned,
      ...((this.data.order['/'] || []).filter(n => !this.data.pinned.includes(n)))
    ];
    if (rootOrder.length > 0) {
      this.applyFolderOrder(explorer, container, '/', rootOrder);
    }

    // Subfolders
    for (const [parentPath, order] of Object.entries(this.data.order)) {
      if (parentPath === '/') continue;
      if (!order || order.length === 0) continue;
      this.applyFolderOrder(explorer, container, parentPath, order);
    }

    // Refresh pin classes after order changes
    setTimeout(() => this.refreshPinClasses(), 0);
  }

  toObsidianPath(parentPath) {
    return parentPath === '/' ? '' : parentPath;
  }

  applyFolderOrder(explorer, navContainer, parentPath, order) {
    const obsPath = this.toObsidianPath(parentPath);

    if (explorer.fileItems) {
      let folderItem;
      if (parentPath === '/') {
        const firstKey = Object.keys(explorer.fileItems)[0];
        if (firstKey) {
          const fi = explorer.fileItems[firstKey];
          if (fi && fi.parent && fi.parent.vChildren && typeof fi.parent.vChildren.setChildren === 'function') {
            folderItem = fi.parent;
          }
        }
      } else {
        folderItem = explorer.fileItems[obsPath];
      }

      if (folderItem && folderItem.vChildren && typeof folderItem.vChildren.setChildren === 'function') {
        let folder;
        if (parentPath === '/') {
          folder = this.app.vault.root;
          if (!folder) {
            try { folder = this.app.vault.getFolderByPath('/'); } catch(e) {}
          }
        } else {
          folder = this.app.vault.getFolderByPath(obsPath);
        }

        if (folder && folder.children) {
          const pathToItem = new Map();
          for (const child of folder.children) {
            const item = explorer.fileItems[child.path];
            if (item) pathToItem.set(this.getFileName(child.path), item);
          }

          const sortedItems = [];
          const used = new Set();

          for (const name of order) {
            if (pathToItem.has(name)) {
              sortedItems.push(pathToItem.get(name));
              used.add(name);
            }
          }
          for (const [name, item] of pathToItem) {
            if (!used.has(name)) {
              sortedItems.push(item);
            }
          }

          folderItem.vChildren.setChildren(sortedItems);
          if (explorer.tree && explorer.tree.infinityScroll) {
            explorer.tree.infinityScroll.invalidateAll();
            explorer.tree.infinityScroll.compute();
          }
          return;
        }
      }
    }

    // ── DOM fallback ──
    const parentEl = this.getChildrenEl(parentPath);
    if (!parentEl) return;

    const nameToEl = new Map();
    const children = Array.from(parentEl.children);

    for (const child of children) {
      const title = child.querySelector(':scope > .nav-file-title[data-path], :scope > .nav-folder-title[data-path]');
      if (title) {
        const path = title.getAttribute('data-path');
        if (path) {
          nameToEl.set(this.getFileName(path), child);
        }
      }
    }

    const ordered = [];
    const used = new Set();

    for (const name of order) {
      if (nameToEl.has(name)) {
        ordered.push(nameToEl.get(name));
        used.add(name);
      }
    }

    for (const [name, el] of nameToEl) {
      if (!used.has(name)) {
        ordered.push(el);
      }
    }

    for (const el of ordered) {
      parentEl.appendChild(el);
    }
  }

  // ─── Vault Event Handlers ─────────────────────────────────────

  removeFromOrder(filePath) {
    const parentPath = this.getParentPath(filePath);
    const name = this.getFileName(filePath);

    if (this.data.order[parentPath]) {
      this.data.order[parentPath] = this.data.order[parentPath].filter(n => n !== name);
      if (this.data.order[parentPath].length === 0) {
        delete this.data.order[parentPath];
      }
      this.save();
    }

    if (this.data.order[filePath]) {
      delete this.data.order[filePath];
      this.save();
    }
  }

  handleRename(oldPath, newPath) {
    const oldParent = this.getParentPath(oldPath);
    const newParent = this.getParentPath(newPath);
    const oldName = this.getFileName(oldPath);
    const newName = this.getFileName(newPath);

    // Update pinned list (only relevant for root-level items)
    if (oldParent === '/' && this.data.pinned.includes(oldName)) {
      const idx = this.data.pinned.indexOf(oldName);
      if (newParent === '/') {
        this.data.pinned[idx] = newName;
      } else {
        this.data.pinned.splice(idx, 1);
      }
      this.save();
    }

    const order = this.data.order[oldParent];
    if (order) {
      const idx = order.indexOf(oldName);
      if (idx !== -1) {
        if (oldParent === newParent) {
          order[idx] = newName;
        } else {
          order.splice(idx, 1);
          if (!this.data.order[newParent]) {
            this.data.order[newParent] = this.captureCurrentOrder(newParent);
          }
          this.data.order[newParent].push(newName);
        }
        this.save();
      }
    }

    if (this.data.order[oldPath]) {
      this.data.order[newPath] = this.data.order[oldPath];
      delete this.data.order[oldPath];
      this.save();
    }
  }

  scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshDraggable();
      this.applyAllOrders();
      this.refreshPinClasses();
    }, 200);
  }

  // ─── Persistence ──────────────────────────────────────────────

  save() {
    this.saveData(this.data);
  }
}

module.exports = FileShiftPinPlugin;
