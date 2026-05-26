const {
  MarkdownRenderer,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath,
} = require("obsidian");
const { RangeSetBuilder } = require("@codemirror/state");
const { Decoration, ViewPlugin, WidgetType } = require("@codemirror/view");

const ANCHOR_REGEX = /<span class="ma-anchor" data-ma-id="([a-zA-Z0-9_-]+)"><\/span>/g;
const LEGACY_MARKER_REGEX = /%%\s*ma:(left|right)(?::([a-zA-Z0-9_-]+))?\s*:\s*([\s\S]*?)%%/gi;
const LEGACY_ANCHOR_MARKER_REGEX = /<span class="ma-anchor" data-ma-id="([a-zA-Z0-9_-]+)"><\/span>\s*%%\s*ma:(left|right):\1\s*:\s*([\s\S]*?)%%/gi;

const DEFAULT_SETTINGS = {
  showReadingAnnotations: true,
  showEditorAnnotations: true,
  defaultSide: "right",
  defaultColor: "#ffe066",
  marginWidth: 240,
  marginGap: 28,
  noteFontSize: 78,
  mediaMaxHeight: 180,
  attachmentFolder: "Margin Annotations Attachments",
  autoMigrateLegacy: true,
};

const COLOR_OPTIONS = [
  { name: "黄色", value: "#ffe066" },
  { name: "绿色", value: "#8ce99a" },
  { name: "蓝色", value: "#74c0fc" },
  { name: "粉色", value: "#faa2c1" },
  { name: "紫色", value: "#b197fc" },
  { name: "橙色", value: "#ffc078" },
  { name: "灰色", value: "#ced4da" },
];

module.exports = class MarginAnnotationsPlugin extends Plugin {
  async onload() {
    this.data = normalizeData(await this.loadData());
    this.revision = 0;
    this.applySettings();
    this.addSettingTab(new MarginAnnotationsSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const selection = editor.getSelection();
        if (!selection || !selection.trim()) return;
        const from = editor.getCursor("from");
        const to = editor.getCursor("to");
        const sides = orderedSides(this.data.settings.defaultSide);

        menu.addSeparator();
        for (const side of sides) {
          menu.addItem((item) => {
            item
              .setTitle(side === "right" ? "添加右侧旁注" : "添加左侧旁注")
              .setIcon("message-square-plus")
              .setSection("annotation")
              .onClick(() => this.openAnnotationComposer(editor, side, selection, from, to));
          });
        }
        menu.addItem((item) => {
          item
            .setTitle("添加默认旁注")
            .setIcon("message-square")
            .setSection("annotation")
            .onClick(() =>
              this.openAnnotationComposer(editor, this.data.settings.defaultSide, selection, from, to)
            );
        });
      })
    );

    this.addCommand({
      id: "add-right-margin-annotation",
      name: "添加右侧旁注",
      editorCallback: (editor) => this.openAnnotationComposer(editor, "right"),
    });

    this.addCommand({
      id: "add-left-margin-annotation",
      name: "添加左侧旁注",
      editorCallback: (editor) => this.openAnnotationComposer(editor, "left"),
    });

    this.addCommand({
      id: "add-default-margin-annotation",
      name: "添加默认旁注",
      editorCallback: (editor) => this.openAnnotationComposer(editor, this.data.settings.defaultSide),
    });

    this.addCommand({
      id: "migrate-inline-margin-annotations",
      name: "迁移旧版行内旁注",
      callback: () => this.migrateLegacyAnnotations(true),
    });

    this.registerMarkdownPostProcessor((el, ctx) => {
      this.renderAnnotations(el, ctx);
    });

    this.registerEditorExtension(createEditorAnnotationExtension(this));

    this.app.workspace.onLayoutReady(() => {
      if (!this.data.settings.autoMigrateLegacy) return;
      this.migrateLegacyAnnotations(false).catch((error) => {
        console.error("Margin Annotations legacy migration failed", error);
      });
    });
  }

  onunload() {
    this.closeComposer();
    this.clearSettings();
  }

  openAnnotationComposer(editor, side, capturedSelection, capturedFrom, capturedTo) {
    const selection = capturedSelection ?? editor.getSelection();
    if (!selection || !selection.trim()) {
      new Notice("先选中一个词或一句话，再添加旁注。");
      return;
    }

    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("没有找到当前笔记。");
      return;
    }

    const from = capturedFrom ?? editor.getCursor("from");
    const to = capturedTo ?? editor.getCursor("to");
    const annotationId = createAnnotationId();
    const built = buildAnnotatedSelection(selection, annotationId);
    if (!built) {
      new Notice("选区里没有可注释的文字。");
      return;
    }

    this.showComposer({
      title: side === "right" ? "添加右侧旁注" : "添加左侧旁注",
      previewText: compactSelection(built.quote),
      sourcePath: file.path,
      initialColor: this.data.settings.defaultColor,
      saveText: "保存旁注",
      onClose: () => editor.focus(),
      onSubmit: async (note, close, color) => {
        editor.setSelection(from, to);
        editor.replaceSelection(built.markup);

        await this.upsertAnnotation(file.path, {
          id: annotationId,
          side,
          note,
          color,
          quote: built.quote,
        });

        close();
        new Notice(side === "right" ? "已添加右侧旁注" : "已添加左侧旁注");
      },
    });
  }

  showComposer({
    title,
    previewText,
    sourcePath,
    initialValue = "",
    initialColor = DEFAULT_SETTINGS.defaultColor,
    saveText = "保存",
    onSubmit,
    onClose,
  }) {
    this.closeComposer();

    const overlay = document.createElement("div");
    overlay.className = "ma-composer-overlay";

    const card = document.createElement("div");
    card.className = "ma-composer-card";

    const header = document.createElement("div");
    header.className = "ma-composer-header";

    const titleEl = document.createElement("div");
    titleEl.className = "ma-composer-title";
    titleEl.textContent = title;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "ma-composer-close";
    closeButton.setAttribute("aria-label", "关闭");
    closeButton.textContent = "×";

    header.append(titleEl, closeButton);

    const preview = document.createElement("div");
    preview.className = "ma-composer-preview";
    preview.textContent = previewText;

    let selectedColor = normalizeColor(initialColor);
    const colorRow = createColorPickerRow(selectedColor, (color) => {
      selectedColor = color;
    });

    const textarea = document.createElement("textarea");
    textarea.className = "ma-composer-input";
    textarea.placeholder = "输入你的旁注，Ctrl + Enter 保存";
    textarea.value = initialValue;

    const mediaRow = document.createElement("div");
    mediaRow.className = "ma-composer-media";

    const mediaButton = document.createElement("button");
    mediaButton.type = "button";
    mediaButton.textContent = "添加媒体";

    const mediaHint = document.createElement("span");
    mediaHint.className = "ma-composer-media-hint";
    mediaHint.textContent = "支持图片、音频、视频、PDF，也可以直接粘贴截图";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*,audio/*,video/*,application/pdf";
    fileInput.multiple = true;
    fileInput.className = "ma-composer-file-input";

    mediaRow.append(mediaButton, mediaHint, fileInput);

    const actions = document.createElement("div");
    actions.className = "ma-composer-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "取消";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = saveText;
    saveButton.className = "mod-cta";

    actions.append(cancelButton, saveButton);
    card.append(header, preview, colorRow, textarea, mediaRow, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const close = () => {
      overlay.remove();
      if (this.activeComposer?.overlay === overlay) {
        this.activeComposer = null;
      }
      onClose?.();
    };

    const submit = async () => {
      const note = textarea.value.trim();
      if (!note) {
        new Notice("旁注不能为空。");
        textarea.focus();
        return;
      }

      saveButton.disabled = true;
      try {
        await onSubmit(note, close, selectedColor);
      } catch (error) {
        console.error("Margin Annotations save failed", error);
        new Notice("保存旁注失败，请看控制台错误。");
        saveButton.disabled = false;
      }
    };

    const insertMediaFiles = async (files) => {
      const realFiles = Array.from(files).filter(Boolean);
      if (realFiles.length === 0) return;

      mediaButton.disabled = true;
      try {
        for (const file of realFiles) {
          const embed = await this.saveAttachment(file);
          insertTextAtTextarea(textarea, `\n${embed}\n`);
        }
        textarea.focus();
        new Notice(realFiles.length === 1 ? "媒体已插入旁注" : `已插入 ${realFiles.length} 个媒体文件`);
      } catch (error) {
        console.error("Margin Annotations media import failed", error);
        new Notice("插入媒体失败，请检查附件目录设置。");
      } finally {
        mediaButton.disabled = false;
        fileInput.value = "";
      }
    };

    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) close();
    });
    card.addEventListener("mousedown", (event) => event.stopPropagation());
    card.addEventListener("click", (event) => event.stopPropagation());
    textarea.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    textarea.addEventListener("keyup", (event) => event.stopPropagation());
    textarea.addEventListener("input", (event) => event.stopPropagation());
    textarea.addEventListener("paste", (event) => {
      event.stopPropagation();
      const clipboardFiles = getClipboardFiles(event);
      if (clipboardFiles.length === 0) return;

      event.preventDefault();
      insertMediaFiles(clipboardFiles);
    });
    mediaButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => insertMediaFiles(fileInput.files ?? []));
    closeButton.addEventListener("click", close);
    cancelButton.addEventListener("click", close);
    saveButton.addEventListener("click", submit);

    this.activeComposer = { overlay, close };
    window.setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 30);
  }

  closeComposer() {
    if (!this.activeComposer) return;
    this.activeComposer.close();
    this.activeComposer = null;
  }

  renderAnnotations(el, ctx) {
    if (!this.data.settings.showReadingAnnotations) return;
    if (el.closest("pre, code")) return;

    const legacyById = this.getLegacyAnnotationsForSection(el, ctx);
    const anchors = Array.from(el.querySelectorAll(".ma-anchor[data-ma-id]"));

    for (const anchor of anchors) {
      const annotationId = anchor.getAttribute("data-ma-id");
      const annotation =
        this.getAnnotation(ctx.sourcePath, annotationId) ||
        legacyById.get(annotationId);

      if (!annotation || !annotation.note?.trim()) continue;

      const target = getAnchorContainer(anchor) || el;
      this.attachMarginNote(target, annotation, ctx, anchor);
    }
  }

  getLegacyAnnotationsForSection(el, ctx) {
    const annotations = new Map();
    const sectionInfo = ctx.getSectionInfo(el);
    if (!sectionInfo) return annotations;

    const lines = sectionInfo.text.split("\n");
    const sectionText = lines.slice(sectionInfo.lineStart, sectionInfo.lineEnd + 1).join("\n");

    LEGACY_MARKER_REGEX.lastIndex = 0;
    let match;
    while ((match = LEGACY_MARKER_REGEX.exec(sectionText)) !== null) {
      const side = match[1].toLowerCase();
      const id = match[2];
      const note = decodeLegacyNote(match[3]);
      if (id) {
        annotations.set(id, {
          id,
          sourcePath: ctx.sourcePath,
          side,
          note,
          color: this.data.settings.defaultColor,
          quote: "",
        });
      }
    }
    LEGACY_MARKER_REGEX.lastIndex = 0;

    return annotations;
  }

  attachMarginNote(target, annotation, ctx, anchor) {
    if (!target || !annotation.note.trim()) return;

    target.classList.add("ma-reading-container");
    const side = normalizeSide(annotation.side);
    const columnClass = side === "left" ? "ma-col-left" : "ma-col-right";
    let column = Array.from(target.children).find((child) =>
      child.classList?.contains(columnClass)
    );

    if (!column) {
      column = document.createElement("div");
      column.className = `ma-col ${columnClass}`;
      target.appendChild(column);
    }

    const noteEl = document.createElement("div");
    noteEl.className = `ma-margin-note ma-margin-note-${side}`;
    noteEl.dataset.maId = annotation.id;
    applyAnnotationColor(noteEl, annotation.color);
    noteEl.setAttribute("aria-label", "旁注。右键可编辑或删除。");

    if (anchor) {
      const offset = getAnchorOffset(target, anchor);
      noteEl.classList.add("ma-positioned-note");
      noteEl.style.top = `${offset}px`;
      applyHighlightColor(anchor, annotation.color);
    }

    const contentEl = document.createElement("div");
    contentEl.className = "ma-note-content";
    noteEl.appendChild(contentEl);

    noteEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showAnnotationMenu(event, {
        ...annotation,
        sourcePath: ctx.sourcePath,
        side,
      });
    });

    MarkdownRenderer.render(this.app, annotation.note.trim(), contentEl, ctx.sourcePath, this);
    column.appendChild(noteEl);
  }

  showAnnotationMenu(event, annotation) {
    const menu = new Menu();
    const otherSide = annotation.side === "left" ? "right" : "left";

    menu.addItem((item) => {
      item
        .setTitle("编辑旁注")
        .setIcon("pencil")
        .onClick(() => this.editAnnotation(annotation));
    });

    menu.addItem((item) => {
      item
        .setTitle(otherSide === "right" ? "移到右侧" : "移到左侧")
        .setIcon("move-horizontal")
        .onClick(() => this.moveAnnotation(annotation.sourcePath, annotation.id, otherSide));
    });

    menu.addSeparator();

    for (const option of COLOR_OPTIONS) {
      menu.addItem((item) => {
        item
          .setTitle(`颜色：${option.name}`)
          .setIcon("palette")
          .onClick(() =>
            this.updateAnnotationColor(annotation.sourcePath, annotation.id, option.value)
          );
      });
    }

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle("删除旁注")
        .setIcon("trash")
        .onClick(async () => {
          if (window.confirm("删除这条旁注和对应高亮？")) {
            await this.deleteAnnotation(annotation.sourcePath, annotation.id);
          }
        });
    });

    menu.showAtMouseEvent(event);
  }

  editAnnotation(annotation) {
    this.showComposer({
      title: annotation.side === "right" ? "编辑右侧旁注" : "编辑左侧旁注",
      previewText: annotation.quote ? compactSelection(annotation.quote) : "修改这条旁注内容",
      sourcePath: annotation.sourcePath,
      initialValue: annotation.note,
      initialColor: annotation.color,
      saveText: "保存修改",
      onSubmit: async (nextNote, close, color) => {
        await this.upsertAnnotation(annotation.sourcePath, {
          ...annotation,
          note: nextNote,
          color,
        });
        close();
        new Notice("旁注已更新");
      },
    });
  }

  async updateAnnotationColor(sourcePath, annotationId, color) {
    const annotation = this.getAnnotation(sourcePath, annotationId);
    if (!annotation) {
      new Notice("没有找到这条旁注。");
      return;
    }

    await this.upsertAnnotation(sourcePath, {
      ...annotation,
      color,
    });
    new Notice("标注颜色已更新");
  }

  async moveAnnotation(sourcePath, annotationId, side) {
    const annotation = this.getAnnotation(sourcePath, annotationId);
    if (!annotation) {
      new Notice("没有找到这条旁注。");
      return;
    }

    await this.upsertAnnotation(sourcePath, {
      ...annotation,
      side,
    });
    new Notice(side === "right" ? "旁注已移到右侧" : "旁注已移到左侧");
  }

  async deleteAnnotation(sourcePath, annotationId) {
    if (!annotationId) {
      new Notice("这条旁注缺少 ID，无法删除。");
      return;
    }

    const file = this.getSourceFile(sourcePath);
    if (!file) return;

    const content = await this.app.vault.read(file);
    const nextContent = deleteAnnotationMarkup(content, annotationId);

    delete this.data.files[sourcePath]?.[annotationId];
    if (this.data.files[sourcePath] && Object.keys(this.data.files[sourcePath]).length === 0) {
      delete this.data.files[sourcePath];
    }

    if (nextContent !== content) {
      await this.app.vault.modify(file, nextContent);
    }

    await this.persistData();
    new Notice("旁注已删除");
  }

  async saveAttachment(file) {
    if (!file) throw new Error("Missing attachment file");

    const folder = getAttachmentFolder(this.data.settings.attachmentFolder);
    await ensureFolder(this.app, folder);

    const baseName = sanitizeFileBase(file.name.replace(/\.[^.]+$/, "")) || "margin-media";
    const extension = getFileExtension(file);
    const time = Date.now().toString(36);
    let targetPath = normalizePath(`${folder}/${baseName}-${time}.${extension}`);
    targetPath = await getUniqueVaultPath(this.app, targetPath);

    const buffer = await file.arrayBuffer();
    await this.app.vault.adapter.writeBinary(targetPath, buffer);

    return `![[${targetPath}]]`;
  }

  async updateSettings(partial) {
    this.data.settings = normalizeSettings({
      ...this.data.settings,
      ...partial,
    });
    this.applySettings();
    await this.persistData();
  }

  applySettings() {
    const settings = this.data.settings;
    document.body.style.setProperty("--ma-margin-width", `${settings.marginWidth}px`);
    document.body.style.setProperty("--ma-margin-gap", `${settings.marginGap}px`);
    document.body.style.setProperty("--ma-note-font-size", `${settings.noteFontSize / 100}em`);
    document.body.style.setProperty("--ma-media-max-height", `${settings.mediaMaxHeight}px`);
    document.body.classList.toggle("ma-hide-reading-annotations", !settings.showReadingAnnotations);
    document.body.classList.toggle("ma-hide-editor-annotations", !settings.showEditorAnnotations);
  }

  clearSettings() {
    document.body.style.removeProperty("--ma-margin-width");
    document.body.style.removeProperty("--ma-margin-gap");
    document.body.style.removeProperty("--ma-note-font-size");
    document.body.style.removeProperty("--ma-media-max-height");
    document.body.classList.remove("ma-hide-reading-annotations", "ma-hide-editor-annotations");
  }

  async upsertAnnotation(sourcePath, annotation) {
    const now = new Date().toISOString();
    const side = normalizeSide(annotation.side);
    const bucket = this.getFileBucket(sourcePath);
    const existing = bucket[annotation.id];

    bucket[annotation.id] = {
      id: annotation.id,
      side,
      note: annotation.note.trim(),
      color: normalizeColor(annotation.color ?? existing?.color ?? this.data.settings.defaultColor),
      quote: annotation.quote ?? existing?.quote ?? "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.persistData();
  }

  getFileBucket(sourcePath) {
    if (!this.data.files[sourcePath]) {
      this.data.files[sourcePath] = {};
    }
    return this.data.files[sourcePath];
  }

  getAnnotation(sourcePath, annotationId) {
    if (!sourcePath || !annotationId) return null;
    const annotation = this.data.files[sourcePath]?.[annotationId];
    if (!annotation) return null;

      return {
        ...annotation,
        sourcePath,
        side: normalizeSide(annotation.side),
        color: normalizeColor(annotation.color),
      };
  }

  findAnnotationById(annotationId) {
    if (!annotationId) return null;

    for (const [sourcePath, annotations] of Object.entries(this.data.files)) {
      const annotation = annotations?.[annotationId];
      if (annotation) {
        return {
          ...annotation,
          sourcePath,
          side: normalizeSide(annotation.side),
          color: normalizeColor(annotation.color),
        };
      }
    }

    return null;
  }

  async persistData({ refresh = true } = {}) {
    await this.saveData(this.data);
    this.revision += 1;
    if (refresh) this.refreshViews();
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view?.previewMode?.rerender) {
        view.previewMode.rerender(true);
      }
      if (view?.editor?.cm) {
        view.editor.cm.dispatch({});
      }
    }
  }

  getSourceFile(sourcePath) {
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!file || file.children) {
      new Notice("无法定位当前笔记文件。");
      return null;
    }
    return file;
  }

  async migrateLegacyAnnotations(manual) {
    if (!manual && this.data.inlineMigrationComplete) return;

    const files = this.app.vault.getMarkdownFiles?.() ?? [];
    let changedFiles = 0;
    let changedNotes = 0;

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      if (!hasLegacyAnnotation(content)) continue;

      const migrated = this.migrateLegacyContent(file.path, content);
      if (!migrated.changed) continue;

      await this.app.vault.modify(file, migrated.content);
      changedFiles += 1;
      changedNotes += migrated.count;
    }

    this.data.inlineMigrationComplete = true;
    await this.persistData({ refresh: true });

    if (manual || changedFiles > 0) {
      new Notice(
        changedFiles > 0
          ? `已迁移 ${changedFiles} 篇笔记里的 ${changedNotes} 条旧旁注`
          : "没有发现需要迁移的旧旁注"
      );
    }
  }

  migrateLegacyContent(sourcePath, content) {
    let count = 0;
    const nextContent = content.replace(
      LEGACY_ANCHOR_MARKER_REGEX,
      (match, annotationId, side, note, offset) => {
        const quote = inferQuoteBefore(content, offset);
        this.upsertAnnotationInMemory(sourcePath, {
          id: annotationId,
          side,
          note: decodeLegacyNote(note),
          quote,
        });
        count += 1;
        return `<span class="ma-anchor" data-ma-id="${annotationId}"></span>`;
      }
    );

    LEGACY_ANCHOR_MARKER_REGEX.lastIndex = 0;

    return {
      changed: nextContent !== content,
      content: nextContent,
      count,
    };
  }

  upsertAnnotationInMemory(sourcePath, annotation) {
    const now = new Date().toISOString();
    const bucket = this.getFileBucket(sourcePath);
    const existing = bucket[annotation.id];

    bucket[annotation.id] = {
      id: annotation.id,
      side: normalizeSide(annotation.side),
      note: annotation.note.trim(),
      color: normalizeColor(annotation.color ?? this.data.settings.defaultColor),
      quote: annotation.quote ?? existing?.quote ?? "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }
};

class MarginAnnotationsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const settings = this.plugin.data.settings;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Margin Annotations 设置" });

    new Setting(containerEl)
      .setName("阅读模式显示旁注")
      .setDesc("关闭后，阅读模式不在左右留白显示旁注。")
      .addToggle((toggle) =>
        toggle.setValue(settings.showReadingAnnotations).onChange(async (value) => {
          await this.plugin.updateSettings({ showReadingAnnotations: value });
        })
      );

    new Setting(containerEl)
      .setName("编辑模式显示旁注")
      .setDesc("关闭后，Live Preview 只隐藏定位锚点，不显示留白旁注。")
      .addToggle((toggle) =>
        toggle.setValue(settings.showEditorAnnotations).onChange(async (value) => {
          await this.plugin.updateSettings({ showEditorAnnotations: value });
        })
      );

    new Setting(containerEl)
      .setName("默认旁注方向")
      .setDesc("右键菜单中的默认旁注和命令面板会使用这个方向。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("right", "右侧")
          .addOption("left", "左侧")
          .setValue(settings.defaultSide)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ defaultSide: normalizeSide(value) });
          })
      );

    new Setting(containerEl)
      .setName("默认标注颜色")
      .setDesc("新建旁注会默认使用这个颜色，之后仍可单独修改。")
      .addDropdown((dropdown) => {
        for (const option of COLOR_OPTIONS) {
          dropdown.addOption(option.value, option.name);
        }
        dropdown.setValue(settings.defaultColor).onChange(async (value) => {
          await this.plugin.updateSettings({ defaultColor: normalizeColor(value) });
        });
      });

    new Setting(containerEl)
      .setName("旁注宽度")
      .setDesc(`${settings.marginWidth}px`)
      .addSlider((slider) =>
        slider
          .setLimits(140, 420, 10)
          .setValue(settings.marginWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateSettings({ marginWidth: value });
          })
      );

    new Setting(containerEl)
      .setName("正文与旁注间距")
      .setDesc(`${settings.marginGap}px`)
      .addSlider((slider) =>
        slider
          .setLimits(8, 96, 2)
          .setValue(settings.marginGap)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateSettings({ marginGap: value });
          })
      );

    new Setting(containerEl)
      .setName("旁注字号")
      .setDesc(`${settings.noteFontSize}%`)
      .addSlider((slider) =>
        slider
          .setLimits(60, 110, 2)
          .setValue(settings.noteFontSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateSettings({ noteFontSize: value });
          })
      );

    new Setting(containerEl)
      .setName("媒体最大高度")
      .setDesc(`${settings.mediaMaxHeight}px`)
      .addSlider((slider) =>
        slider
          .setLimits(80, 420, 10)
          .setValue(settings.mediaMaxHeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateSettings({ mediaMaxHeight: value });
          })
      );

    new Setting(containerEl)
      .setName("媒体附件目录")
      .setDesc("在旁注输入框中添加或粘贴的媒体会保存到这个目录。")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.attachmentFolder)
          .setValue(settings.attachmentFolder)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ attachmentFolder: value });
          })
      );

    new Setting(containerEl)
      .setName("自动迁移旧版行内旁注")
      .setDesc("开启后，插件加载时会把旧的 %%ma:...%% 旁注迁移到插件数据中。")
      .addToggle((toggle) =>
        toggle.setValue(settings.autoMigrateLegacy).onChange(async (value) => {
          await this.plugin.updateSettings({ autoMigrateLegacy: value });
        })
      );
  }
}

class EditorMarginNoteWidget extends WidgetType {
  constructor(plugin, annotation) {
    super();
    this.plugin = plugin;
    this.annotation = annotation;
  }

  eq(other) {
      return (
      other instanceof EditorMarginNoteWidget &&
      other.annotation.id === this.annotation.id &&
      other.annotation.sourcePath === this.annotation.sourcePath &&
      other.annotation.side === this.annotation.side &&
      other.annotation.note === this.annotation.note &&
      other.annotation.color === this.annotation.color
    );
  }

  toDOM() {
    const side = normalizeSide(this.annotation.side);
    const noteEl = document.createElement("div");
    noteEl.className = `ma-editor-margin-note ma-editor-margin-note-${side}`;
    noteEl.dataset.maId = this.annotation.id;
    noteEl.contentEditable = "false";
    applyAnnotationColor(noteEl, this.annotation.color);
    noteEl.setAttribute("aria-label", "旁注。右键可编辑或删除。");

    const contentEl = document.createElement("div");
    contentEl.className = "ma-editor-note-content";
    noteEl.appendChild(contentEl);
    MarkdownRenderer.render(
      this.plugin.app,
      this.annotation.note.trim(),
      contentEl,
      this.annotation.sourcePath,
      this.plugin
    );

    noteEl.addEventListener("mousedown", (event) => event.stopPropagation());
    noteEl.addEventListener("click", (event) => event.stopPropagation());
    noteEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.plugin.showAnnotationMenu(event, this.annotation);
    });

    return noteEl;
  }

  ignoreEvent() {
    return true;
  }
}

function createEditorAnnotationExtension(plugin) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.seenRevision = plugin.revision;
      this.decorations = this.buildDecorations(view);
    }

    update(update) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        this.seenRevision !== plugin.revision
      ) {
        this.seenRevision = plugin.revision;
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view) {
      const builder = new RangeSetBuilder();
      const ranges = [];

      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        collectAnchorDecorations(text, from, plugin, ranges);
        collectLegacyHideRanges(text, from, ranges);
      }

      ranges.sort((a, b) => a.from - b.from || a.to - b.to || a.order - b.order);

      let lastHiddenTo = -1;
      for (const range of ranges) {
        if (range.kind === "hide") {
          if (range.from < lastHiddenTo) continue;
          builder.add(range.from, range.to, Decoration.replace({}));
          lastHiddenTo = range.to;
        } else if (range.kind === "mark") {
          builder.add(range.from, range.to, Decoration.mark({
            class: "ma-editor-highlight",
            attributes: {
              style: `background-color: ${colorToSoft(range.color)}; border-radius: 3px;`,
            },
          }));
        } else {
          builder.add(range.from, range.to, Decoration.widget({
            widget: new EditorMarginNoteWidget(plugin, range.annotation),
            side: 1,
          }));
        }
      }

      return builder.finish();
    }
  }, {
    decorations: (pluginView) => pluginView.decorations,
  });
}

function collectAnchorDecorations(text, offset, plugin, ranges) {
  ANCHOR_REGEX.lastIndex = 0;

  let match;
  while ((match = ANCHOR_REGEX.exec(text)) !== null) {
    const annotation = plugin.findAnnotationById(match[1]);
    const from = offset + match.index;
    const to = from + match[0].length;

    ranges.push({
      kind: "hide",
      order: 0,
      from,
      to,
    });

    if (plugin.data.settings.showEditorAnnotations && annotation?.note?.trim()) {
      const highlightRange = findLastMarkdownHighlightRange(text.slice(0, match.index));
      if (highlightRange) {
        ranges.push({
          kind: "mark",
          order: 0,
          from: offset + highlightRange.from,
          to: offset + highlightRange.to,
          color: annotation.color,
        });
      }
      ranges.push({
        kind: "widget",
        order: 1,
        from: to,
        to,
        annotation,
      });
    }
  }

  ANCHOR_REGEX.lastIndex = 0;
}

function collectLegacyHideRanges(text, offset, ranges) {
  LEGACY_MARKER_REGEX.lastIndex = 0;

  let match;
  while ((match = LEGACY_MARKER_REGEX.exec(text)) !== null) {
    ranges.push({
      kind: "hide",
      order: 0,
      from: offset + match.index,
      to: offset + match.index + match[0].length,
    });
  }

  LEGACY_MARKER_REGEX.lastIndex = 0;
}

function buildAnnotatedSelection(selection, annotationId) {
  const leading = selection.match(/^\s*/)?.[0] ?? "";
  const trailing = selection.match(/\s*$/)?.[0] ?? "";
  const core = selection.slice(leading.length, selection.length - trailing.length);
  if (!core.trim()) return null;

  const highlighted = isAlreadyHighlighted(core) ? core : `==${core}==`;
  const anchor = `<span class="ma-anchor" data-ma-id="${annotationId}"></span>`;

  return {
    markup: `${leading}${highlighted}${anchor}${trailing}`,
    quote: stripMarkdownHighlight(core).trim(),
  };
}

function deleteAnnotationMarkup(content, annotationId) {
  const anchor = `<span class="ma-anchor" data-ma-id="${annotationId}"></span>`;
  const legacyMarker = `\\s*%%\\s*ma:(?:left|right):${escapeRegExp(annotationId)}\\s*:\\s*[\\s\\S]*?%%`;
  const highlightedWithAnchor = new RegExp(
    `==([\\s\\S]*?)==${escapeRegExp(anchor)}(?:${legacyMarker})?`,
    "g"
  );
  const anchorWithLegacy = new RegExp(`${escapeRegExp(anchor)}(?:${legacyMarker})?`, "g");

  let nextContent = content.replace(highlightedWithAnchor, "$1");
  if (nextContent !== content) return nextContent;

  nextContent = content.replace(anchorWithLegacy, "");
  if (nextContent !== content) return nextContent;

  return content.replace(new RegExp(legacyMarker, "g"), "");
}

function normalizeData(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const files = data.files && typeof data.files === "object" ? data.files : {};

  return {
    version: 4,
    inlineMigrationComplete: Boolean(data.inlineMigrationComplete),
    settings: normalizeSettings(data.settings),
    files,
  };
}

function normalizeSettings(raw) {
  const settings = raw && typeof raw === "object" ? raw : {};
  return {
    showReadingAnnotations: settings.showReadingAnnotations !== false,
    showEditorAnnotations: settings.showEditorAnnotations !== false,
    defaultSide: normalizeSide(settings.defaultSide),
    defaultColor: normalizeColor(settings.defaultColor),
    marginWidth: clampNumber(settings.marginWidth, 140, 420, DEFAULT_SETTINGS.marginWidth),
    marginGap: clampNumber(settings.marginGap, 8, 96, DEFAULT_SETTINGS.marginGap),
    noteFontSize: clampNumber(settings.noteFontSize, 60, 110, DEFAULT_SETTINGS.noteFontSize),
    mediaMaxHeight: clampNumber(settings.mediaMaxHeight, 80, 420, DEFAULT_SETTINGS.mediaMaxHeight),
    attachmentFolder: String(settings.attachmentFolder || DEFAULT_SETTINGS.attachmentFolder).trim(),
    autoMigrateLegacy: settings.autoMigrateLegacy !== false,
  };
}

function normalizeSide(side) {
  return side === "left" ? "left" : "right";
}

function orderedSides(defaultSide) {
  return normalizeSide(defaultSide) === "left" ? ["left", "right"] : ["right", "left"];
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function hasLegacyAnnotation(content) {
  LEGACY_MARKER_REGEX.lastIndex = 0;
  const found = LEGACY_MARKER_REGEX.test(content);
  LEGACY_MARKER_REGEX.lastIndex = 0;
  return found;
}

function decodeLegacyNote(note) {
  return String(note)
    .trim()
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/% %/g, "%%");
}

function inferQuoteBefore(content, offset) {
  const before = content.slice(Math.max(0, offset - 2000), offset);
  const match = before.match(/==([\s\S]*?)==\s*$/);
  return match ? stripMarkdownHighlight(match[1]).trim() : "";
}

function isAlreadyHighlighted(text) {
  const trimmed = text.trim();
  return trimmed.startsWith("==") && trimmed.endsWith("==");
}

function stripMarkdownHighlight(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("==") && trimmed.endsWith("==")) {
    return trimmed.slice(2, -2);
  }
  return text;
}

function compactSelection(selection) {
  const compact = selection.replace(/\s+/g, " ").trim();
  if (compact.length <= 140) return compact;
  return `${compact.slice(0, 137)}...`;
}

function createAnnotationId() {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `ma-${time}-${random}`;
}

function createColorPickerRow(initialColor, onChange) {
  const row = document.createElement("div");
  row.className = "ma-color-row";

  const label = document.createElement("span");
  label.className = "ma-color-label";
  label.textContent = "标注颜色";
  row.appendChild(label);

  const swatches = document.createElement("div");
  swatches.className = "ma-color-swatches";
  row.appendChild(swatches);

  let selectedColor = normalizeColor(initialColor);
  const buttons = [];

  for (const option of COLOR_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ma-color-swatch";
    button.title = option.name;
    button.setAttribute("aria-label", option.name);
    button.style.setProperty("--ma-swatch-color", option.value);
    button.style.setProperty("background", option.value, "important");
    button.style.setProperty("background-color", option.value, "important");
    button.style.setProperty("border-color", colorToBorder(option.value), "important");

    if (normalizeColor(option.value) === selectedColor) {
      button.classList.add("is-active");
    }

    button.addEventListener("click", () => {
      selectedColor = normalizeColor(option.value);
      for (const other of buttons) {
        other.classList.toggle("is-active", other === button);
      }
      onChange(selectedColor);
    });

    buttons.push(button);
    swatches.appendChild(button);
  }

  return row;
}

function applyAnnotationColor(element, color) {
  const safeColor = normalizeColor(color);
  element.style.setProperty("--ma-color", safeColor);
  element.style.setProperty("--ma-color-soft", colorToSoft(safeColor));
}

function applyHighlightColor(anchor, color) {
  const highlight = getHighlightElement(anchor);
  if (!highlight) return;

  highlight.classList.add("ma-reading-highlight");
  highlight.style.backgroundColor = colorToSoft(color);
  highlight.style.borderRadius = "3px";
  highlight.style.boxDecorationBreak = "clone";
}

function getHighlightElement(anchor) {
  const previous = anchor.previousElementSibling;
  if (previous?.tagName?.toLowerCase() === "mark") return previous;

  const marks = Array.from(anchor.parentElement?.querySelectorAll("mark") ?? []);
  return marks.length > 0 ? marks[marks.length - 1] : null;
}

function findLastMarkdownHighlightRange(text) {
  const matches = Array.from(text.matchAll(/==([\s\S]*?)==/g));

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const end = match.index + match[0].length;
    if (!/^\s*$/.test(text.slice(end))) continue;

    return {
      from: match.index + 2,
      to: end - 2,
    };
  }

  return null;
}

function normalizeColor(value) {
  const color = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  return DEFAULT_SETTINGS.defaultColor;
}

function colorToSoft(value) {
  const color = normalizeColor(value);
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, 0.34)`;
}

function colorToBorder(value) {
  const color = normalizeColor(value);
  const red = Math.max(0, parseInt(color.slice(1, 3), 16) - 46);
  const green = Math.max(0, parseInt(color.slice(3, 5), 16) - 46);
  const blue = Math.max(0, parseInt(color.slice(5, 7), 16) - 46);
  return `rgb(${red}, ${green}, ${blue})`;
}

function getAttachmentFolder(value) {
  const raw = String(value || DEFAULT_SETTINGS.attachmentFolder)
    .trim()
    .replace(/\\/g, "/");
  return normalizePath(raw || DEFAULT_SETTINGS.attachmentFolder);
}

async function ensureFolder(app, folder) {
  const parts = normalizePath(folder).split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await app.vault.adapter.exists(current))) {
      await app.vault.createFolder(current);
    }
  }
}

function sanitizeFileBase(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|#^[\]]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function getFileExtension(file) {
  const nameMatch = String(file.name || "").match(/\.([a-zA-Z0-9]+)$/);
  if (nameMatch) return nameMatch[1].toLowerCase();

  const mime = String(file.type || "").toLowerCase();
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  if (mime === "audio/mpeg") return "mp3";
  if (mime === "audio/wav") return "wav";
  if (mime === "video/mp4") return "mp4";
  if (mime === "application/pdf") return "pdf";
  return "bin";
}

async function getUniqueVaultPath(app, targetPath) {
  if (!(await app.vault.adapter.exists(targetPath))) return targetPath;

  const extensionMatch = targetPath.match(/(\.[^./]+)$/);
  const extension = extensionMatch?.[1] ?? "";
  const stem = extension ? targetPath.slice(0, -extension.length) : targetPath;
  let index = 2;
  let candidate = `${stem}-${index}${extension}`;

  while (await app.vault.adapter.exists(candidate)) {
    index += 1;
    candidate = `${stem}-${index}${extension}`;
  }

  return candidate;
}

function getClipboardFiles(event) {
  const items = Array.from(event.clipboardData?.items ?? []);
  return items
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function insertTextAtTextarea(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  const suffix = after && !text.endsWith("\n") ? "\n" : "";
  const insert = `${prefix}${text}${suffix}`;

  textarea.setRangeText(insert, start, end, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function getAnchorContainer(anchor) {
  return anchor.closest("p, li, blockquote, h1, h2, h3, h4, h5, h6") || anchor.parentElement;
}

function getAnchorOffset(container, anchor) {
  const containerRect = container.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  return Math.max(0, Math.round(anchorRect.top - containerRect.top));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
