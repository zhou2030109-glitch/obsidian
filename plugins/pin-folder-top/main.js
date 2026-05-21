const { Plugin, PluginSettingTab, Setting, normalizePath } = require("obsidian");

const DEFAULT_SETTINGS = {
  enabled: true,
  pinnedPaths: ["仓库"],
  refreshDelayMs: 120,
};

module.exports = class PinFolderTopPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.applyTimer = null;
    this.isApplying = false;

    this.addSettingTab(new PinFolderTopSettingTab(this.app, this));
    this.addCommand({
      id: "apply-pinned-folders",
      name: "立即刷新置顶分支",
      callback: () => this.scheduleApply(true),
    });

    this.observer = new MutationObserver(() => this.scheduleApply());
    this.observer.observe(document.body, { childList: true, subtree: true });

    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleApply()));
    this.app.workspace.onLayoutReady(() => this.scheduleApply(true));
  }

  onunload() {
    if (this.observer) this.observer.disconnect();
    if (this.applyTimer) window.clearTimeout(this.applyTimer);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  scheduleApply(force = false) {
    if (!this.settings?.enabled && !force) return;
    if (this.isApplying) return;

    if (this.applyTimer) window.clearTimeout(this.applyTimer);
    this.applyTimer = window.setTimeout(() => {
      this.applyTimer = null;
      this.applyPinnedFolders();
    }, force ? 0 : this.settings.refreshDelayMs);
  }

  applyPinnedFolders() {
    if (!this.settings?.enabled) return;
    if (this.isApplying) return;

    const paths = this.getPinnedPaths();
    if (!paths.length) return;

    this.isApplying = true;
    try {
      const leaves = this.app.workspace.getLeavesOfType("file-explorer");
      for (const leaf of leaves) {
        const root = leaf?.view?.containerEl;
        if (!root) continue;

        for (const path of paths) {
          this.pinBranch(root, path);
        }
      }
    } finally {
      this.isApplying = false;
    }
  }

  getPinnedPaths() {
    const raw = Array.isArray(this.settings?.pinnedPaths) ? this.settings.pinnedPaths : [];
    const unique = [];
    const seen = new Set();

    for (const entry of raw) {
      const value = normalizePath(String(entry || "").trim());
      if (!value || seen.has(value)) continue;
      seen.add(value);
      unique.push(value);
    }

    return unique;
  }

  pinBranch(container, targetPath) {
    const selector = `.nav-folder-title[data-path="${cssEscape(targetPath)}"]`;
    const titleEl = container.querySelector(selector);
    if (!titleEl) return;

    const folderEl = titleEl.closest(".nav-folder");
    const siblings = folderEl?.parentElement;
    if (!folderEl || !siblings) return;
    if (siblings.firstElementChild === folderEl) return;

    folderEl.addClass("pin-folder-top-pinned");
    siblings.prepend(folderEl);
  }
};

class PinFolderTopSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Pin Folder Top" });

    new Setting(containerEl)
      .setName("启用")
      .setDesc("自动把指定分支移动到文件列表最前面。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enabled).onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
          this.plugin.scheduleApply(true);
        })
      );

    new Setting(containerEl)
      .setName("置顶分支")
      .setDesc("每行一个路径，从 vault 根目录开始，例如：仓库 或 资料/仓库。")
      .addTextArea((text) => {
        text.inputEl.rows = 4;
        text
          .setPlaceholder("仓库")
          .setValue((this.plugin.settings.pinnedPaths || []).join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.pinnedPaths = value
              .split(/[\n,]+/)
              .map((item) => item.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
            this.plugin.scheduleApply(true);
          });
      });

    new Setting(containerEl)
      .setName("立即刷新")
      .setDesc("保存设置后手动刷新一次。")
      .addButton((button) =>
        button.setButtonText("刷新").onClick(() => this.plugin.scheduleApply(true))
      );
  }
}

function cssEscape(value) {
  if (globalThis.CSS && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
