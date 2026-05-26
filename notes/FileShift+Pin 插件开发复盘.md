---
title: FileShift+Pin 插件开发复盘
date: 2026-05-26
tags:
  - obsidian
  - 插件开发
  - 使用心得
  - file-shift-pin
  - 拖拽排序
  - 置顶
status: 已完成
---

# FileShift+Pin 插件开发复盘

这篇笔记记录从一个看似很小的需求——"我想给 Obsidian 文件夹拖拽换顺序"——是怎么一路升级、最终演变成一个自定义插件 `file-shift-pin` 的。

起点是抱怨："我的 obsidian 只能把一个文件夹移动到另一个文件夹里面，不能调整顺序，你能增加拖拽可以换顺序的功能么"。终点是手写了一个把 FileShift 的拖拽机制和 pin-folder-top 的置顶概念融合到一起、并解决了二者根本性冲突的新插件。

整个过程其实是一个典型的渐进式排查 + 设计 + 实现流程，值得记录下来当做以后的参照。

## 0. 背景：Obsidian 文件树为什么不能拖拽排序

Obsidian 的原生文件树（File Explorer）只支持几种内置排序方式：

- 按名称 A→Z / Z→A
- 按修改时间新→旧 / 旧→新
- 按创建时间新→旧 / 旧→新

**它根本没有"自定义顺序"这个概念。** 拖拽文件夹的唯一原生行为是"把 A 移到 B 里面"（即把 A 变成 B 的子文件夹），不是同级重排。

这是软件设计层面的取舍。Obsidian 把"顺序"完全交给排序算法，因为用户的 vault 里可能有上千上万个文件，手工维护顺序成本太高。但对于结构化使用 Obsidian 的场景（比如把它当二级目录的知识库），用户就是希望按"重要程度 / 工作流"自己排，而不是字母序。

这个需求只能通过插件解决。

## 1. 第一次尝试：Bartender（失败）

Bartender 是社区里历史最悠久的"拖拽排序"插件。它的能力非常全面：

- 文件树拖拽排序
- 左侧 Ribbon 图标拖拽排序
- 状态栏图标拖拽排序

我第一反应是装它。从 GitHub release 直接下载三件套：

```
main.js
manifest.json
styles.css
```

放到 `.obsidian/plugins/obsidian-bartender/`，再把 `obsidian-bartender` 加进 `community-plugins.json`。

但用户反馈"不行"。

### 1.1 失败原因诊断

排查发现 Obsidian 版本是 **1.12.7**，而 Bartender 的最后一次 release 是 **0.5.5（2022 年 6 月）**。

Bartender 的实现依赖一种叫 `monkey-around` 的技术——在运行时给 Obsidian 内部的私有 API 打补丁。这种技术的脆弱性在于：**Obsidian 每次更新都可能改内部 API**，而 Bartender 已经 3 年没适配新版了。

结论：**老插件 + 新宿主 = 加载失败或部分失效**。这是不可修复的，除非自己 fork 升级。

## 2. 第二次尝试：File Shift（成功，但出现冲突）

继续搜，找到了一个 2024-2025 年还在维护的新插件 `Qctsu/obsidian-file-shift`（仓库名 `obsidian-file-shift`，插件 id `file-shift`）。

它的核心卖点是：

- **纯 DOM 拖拽**，不依赖 monkey-around
- **不修改文件名**（不像 `lukasbach/obsidian-file-order` 那样靠 `01_` `02_` 前缀）
- 顺序保存在插件自己的 `data.json` 里

按相同方式安装、修改 `community-plugins.json`、目录名改成和 manifest id 一致的 `file-shift`，启动。

第一次用户反馈"根本不行"，原因是 File Shift **默认是 OFF 状态**，需要：

- 点左侧 Ribbon 上下双箭头图标手动开启，或
- 命令面板 `Toggle custom ordering on/off`

开启后大部分文件夹能拖了，但**有 3 个文件夹拖不动**——正是被 `pin-folder-top` 插件置顶的那 3 个：仓库 / 知识库 / 使用obsidian心得。

### 2.1 真正的麻烦：两个插件的实现机制冲突

这是整个事件最关键的发现。

**`pin-folder-top` 的实现方式（读源码确认）：**

它不动 DOM，而是**生成一段 CSS snippet 注入页面**，用 CSS `order` 属性强行控制视觉顺序：

```css
.nav-folder:has(...[data-path="仓库"])        { order: -100000 !important; }
.nav-folder:has(...[data-path="知识库"])      { order:  -99999 !important; }
.nav-folder:has(...[data-path="使用obsidian心得"]) { order: -99998 !important; }
```

并把生成的 CSS 写入 `.obsidian/snippets/pin-folder-top.css`。这个 snippet 同时被加入 `appearance.json` 的 `enabledCssSnippets` 列表里，所以每次 Obsidian 启动都会自动加载。

**`File Shift` 的实现方式（读源码确认）：**

它走的是另一条完全不同的路：**直接控制 DOM 元素的顺序**。它通过两条途径生效：

1. 拿到 Obsidian 内部的 `fileExplorer.fileItems[parentPath]` 对象，调用其 `vChildren.setChildren(sortedItems)` 重新排列虚拟子元素，然后强制 `infinityScroll.invalidateAll() + compute()` 让虚拟滚动器重新渲染。
2. 如果上面那条私有 API 通道失败，就退化成 DOM fallback——直接对父元素的 children 做 `appendChild` 重新排列。

**冲突的本质：**

- File Shift 改的是 DOM 树里子节点的**位置**
- pin-folder-top 用 CSS `order: !important` 控制的是 flex 容器里子元素的**视觉顺序**

在 CSS 规则里，**`order` 是 flex item 的视觉排序属性**，它**完全覆盖 DOM 顺序**。也就是说：

> File Shift 在 DOM 里把 "仓库" 放到第 5 位，CSS `order: -100000 !important` 还是会把它拉回第 1 位渲染。

而且 `!important` 等级很高，几乎没法用普通方式压过去。

这就是为什么用户拖不动那 3 个文件夹——不是插件不响应拖拽，而是拖完之后 CSS 又把它们瞬间拉回去。

## 3. 决策：自己写一个新插件

到这一步，有几个可选路线：

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 关掉 pin-folder-top，只用 File Shift | 最简单 | 失去置顶概念和紫色高亮 |
| B. 修改 pin-folder-top 源码，让它支持调整顺序 | 改动小 | 它没有拖拽 UI，只能手工编辑文本列表 |
| C. 写新插件，融合 File Shift 的拖拽 + pin-folder-top 的置顶视觉 | 一劳永逸 | 工作量最大 |

用户明确选了 C：「在 fileshift 的基础上既能把下面拖拽换顺序又能把置顶也可以拖拽换顺序」。

这个需求其实意味着：**置顶不再是"位置锁死"，而是"分区 + 高亮"**。置顶组在前、非置顶组在后，每组内部独立排序。

## 4. 设计

### 4.1 数据模型

参考 File Shift 原有的 `data.json` 结构，扩展一个 `pinned` 数组：

```json
{
  "version": 2,
  "active": true,
  "pinned": ["仓库", "知识库", "使用obsidian心得"],
  "order": {
    "/": ["计算机系统", "论文积累", "附件", "数据结构"],
    "subfolder/path": ["a.md", "b.md"]
  }
}
```

关键约束：

- `pinned` 数组只对**根目录的直接子项**有效（顶级文件夹才能被置顶）。
- `pinned` 数组里的项**会从 `order["/"]` 中移除**。两者互斥，永不重复。
- 渲染时，根目录的最终顺序 = `pinned` 数组顺序 + `order["/"]` 数组顺序。
- 子目录完全沿用 File Shift 原有的 `order` 逻辑。

### 4.2 拖拽行为设计

把"置顶区"和"非置顶区"看作两个独立的可排序区段。用户的拖拽落点决定结果：

| 源 | 目标 | 结果 |
|---|---|---|
| pinned 项 | pinned 项 | 调整 `pinned` 数组顺序 |
| pinned 项 | 非 pinned 项 | 从 `pinned` 移除，插入 `order["/"]` → **自动取消置顶** |
| 非 pinned 项 | pinned 项 | 从 `order["/"]` 移除，插入 `pinned` → **自动置顶** |
| 非 pinned 项 | 非 pinned 项 | 调整 `order["/"]` 顺序 |

这套规则的优势：

- **拖拽即操作**。不需要用户去理解"pin 是一个状态"。视觉上"拖到上面那一块"="变成置顶"，"拖到下面那一块"="取消置顶"。
- **保留显式入口**。右键菜单也提供"置顶分支 / 取消置顶"项，方便不爱拖拽的用户。
- **不打架**。原 File Shift 在子目录里的拖拽行为完全不变。

### 4.3 视觉表达

继承 pin-folder-top 的紫色边框样式（用户已经习惯了），但**完全用 CSS 类**实现，不用 `order: !important`：

```css
.nav-folder.fsp-pinned > .nav-folder-title {
  background: var(--background-primary) !important;
  border-left: 3px solid var(--interactive-accent) !important;
  border-radius: 6px !important;
  box-shadow: inset 0 0 0 1px var(--background-modifier-border) !important;
}
```

注意这里的 `!important` 只是为了对抗主题样式，不涉及 `order`，所以不会和 DOM 顺序冲突。

另外给最后一个置顶项加一条**虚线分隔**，让置顶区和非置顶区在视觉上有明显分界：

```css
.nav-folder.fsp-pinned-last {
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px dashed var(--background-modifier-border);
}
```

## 5. 实现：基于 File Shift 的扩展

整个 `main.js` 的骨架完全继承自 File Shift（约 720 行），但加了 6 个关键改动点。

### 5.1 改动点 1：`onload()` 注册右键菜单

```js
this.registerEvent(
  this.app.workspace.on('file-menu', (menu, file) => this.addFolderMenu(menu, file))
);
```

`addFolderMenu` 里判断：

- 必须是 `TFolder`
- 必须是顶级（`getParentPath(file.path) === '/'`）
- 加一个菜单项："置顶分支" / "取消置顶"，点击调用 `togglePin(name)`

### 5.2 改动点 2：`togglePin()` 状态切换

```js
togglePin(name) {
  if (this.data.pinned.includes(name)) {
    this.data.pinned = this.data.pinned.filter(n => n !== name);
  } else {
    this.data.pinned.push(name);
    // 同时从 order["/"] 移除，保持互斥
    if (Array.isArray(this.data.order['/'])) {
      this.data.order['/'] = this.data.order['/'].filter(n => n !== name);
    }
  }
  this.save();
  this.refreshPinClasses();
  if (this.isActive) this.applyAllOrders();
}
```

切换后立刻刷新 CSS 类和顺序。

### 5.3 改动点 3：`reorderRoot()` —— 区分目标是否 pinned

原 `reorderItem` 对所有父目录一视同仁。新版本对根目录单独走 `reorderRoot`：

```js
reorderRoot(sourceName, targetName, position) {
  const tgtInPinned = this.data.pinned.includes(targetName);

  // 先从两个列表里都移除 source
  this.data.pinned = this.data.pinned.filter(n => n !== sourceName);
  this.data.order['/'] = (this.data.order['/'] || []).filter(n => n !== sourceName);

  if (tgtInPinned) {
    // 目标在 pinned 区 → 插入到 pinned
    const idx = this.data.pinned.indexOf(targetName);
    this.data.pinned.splice(
      position === 'before' ? idx : idx + 1,
      0,
      sourceName
    );
  } else {
    // 目标在普通区 → 插入到 order["/"]
    const idx = this.data.order['/'].indexOf(targetName);
    this.data.order['/'].splice(
      idx === -1 ? this.data.order['/'].length
                 : (position === 'before' ? idx : idx + 1),
      0,
      sourceName
    );
  }

  this.save();
}
```

这是整个新插件的**逻辑核心**。"拖到哪一边就自动归到哪一边"的语义就靠这一段实现。

### 5.4 改动点 4：`applyAllOrders()` —— 合并 pinned + order

```js
const rootOrder = [
  ...this.data.pinned,
  ...((this.data.order['/'] || []).filter(n => !this.data.pinned.includes(n)))
];
if (rootOrder.length > 0) {
  this.applyFolderOrder(explorer, container, '/', rootOrder);
}
```

注意去重那一行：即使数据写坏了（pinned 和 order 里有同名项），渲染时也保证不会重复。

### 5.5 改动点 5：`refreshPinClasses()` —— 应用紫色高亮

```js
refreshPinClasses() {
  const container = this.getNavContainer();
  if (!container) return;

  // 先清空所有标记
  container.querySelectorAll('.fsp-pinned, .fsp-pinned-last').forEach(el => {
    el.classList.remove('fsp-pinned', 'fsp-pinned-last');
  });

  // 给每个 pinned 顶级文件夹打类
  let lastPinnedEl = null;
  for (const name of this.data.pinned) {
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
```

关键设计：**插件 OFF 时仍然显示高亮**。所以这个方法在 `deactivate()` 之后也会被调用，pin 类被保留。Ribbon 图标控制的只是"拖拽 + 排序"，不影响"哪些是置顶"这个数据。

### 5.6 改动点 6：vault 事件的 pin-aware 处理

文件被删除 / 重命名时，要同步维护 `pinned` 数组：

```js
this.registerEvent(
  this.app.vault.on('delete', (file) => {
    this.removeFromOrder(file.path);
    const name = this.getFileName(file.path);
    if (this.getParentPath(file.path) === '/' && this.data.pinned.includes(name)) {
      this.data.pinned = this.data.pinned.filter(n => n !== name);
      this.save();
    }
  })
);
```

重命名同理。如果一个置顶文件夹被改名，`pinned` 数组里的名字也要跟着更新；如果被移到子目录里，则要从 `pinned` 移除。

## 6. 迁移：从旧插件无痛切换

### 6.1 数据迁移

为了让用户重启后**直接看到**置顶仍然生效，我预先把 `data.json` 写好：

```json
{
  "version": 2,
  "active": true,
  "pinned": ["仓库", "知识库", "使用obsidian心得"],
  "order": {}
}
```

数据来自原 `pin-folder-top/data.json` 的 `pinnedPaths` 字段。

另外还提供了一个命令：`Import pinned list from pin-folder-top`，主动从旧插件的 data 文件读取，方便以后想重新导入。

### 6.2 禁用冲突源

必须同时禁用三样东西，否则会冲突：

1. `community-plugins.json` 里删掉 `pin-folder-top` 和 `file-shift`，加上 `file-shift-pin`
2. `appearance.json` 的 `enabledCssSnippets` 里删掉 `pin-folder-top`
3. （可选）把 `snippets/pin-folder-top.css` 删掉。我没删，因为既然 snippet 已经被禁用，留着不影响

第 2 步是关键。我在第一次切换时只改了第 1 步，结果 pin-folder-top 的 CSS snippet 依然在被 Obsidian 加载（因为 `appearance.json` 还启用着它），CSS `order: !important` 继续生效，新插件的 DOM 顺序还是被覆盖。**插件被禁用，不等于 snippet 被禁用。**

## 7. 经验沉淀

### 7.1 排查类经验

- **老插件不工作不一定是"安装错了"**。先看 `minAppVersion` 和最后更新时间。Bartender 案例就是这样。
- **插件 ID 和目录名要一致**。Obsidian 通过目录名匹配 manifest 里的 id。FileShift 的 release 包叫 `obsidian-file-shift` 但 manifest id 是 `file-shift`，必须把目录改成 `file-shift` 才能被加载。这个坑在两次切换里都遇到了。
- **加进 `community-plugins.json` 还不够**，受限模式（Restricted Mode）必须先关。如果用户已经能装其他社区插件，则受限模式已经关了，不用管。
- **多个插件解决同一问题时，先读完所有相关插件的源码再下结论**。CSS order vs DOM order 这种冲突，光看现象（"拖不动")是猜不出来的。

### 7.2 Obsidian 插件 API 经验

- `fileExplorer.fileItems[parentPath]` 是 Obsidian 内部 API，能拿到文件树的虚拟节点。私有 API 不稳定但功能强。
- `vChildren.setChildren(items)` + `infinityScroll.invalidateAll() + compute()` 是控制文件树渲染顺序的"内部最佳路径"。比直接操作 DOM 更可靠（不会被 Obsidian 内部 re-render 覆盖）。
- DOM fallback 必须保留，因为 Obsidian 内部 API 可能在新版改名。File Shift 的代码里两条路径都实现了，是值得借鉴的健壮设计。
- 拖拽事件的 `capture: true` 监听是关键。Obsidian 自己也监听了 `dragstart/dragover/drop`，要在它之前拦截、阻止默认行为，才能用自己的逻辑。

### 7.3 CSS / 视觉经验

- `flex order` 属性是 CSS 视觉排序的"暗箭"，会绕开 DOM 顺序。看 DevTools 里 DOM 顺序对的但渲染顺序不对，第一反应应该查这个。
- 主题样式经常用 `!important`，自己的样式如果要稳定生效，必要时也得用 `!important`，但**只在 background / border / color 这种纯装饰属性上用**，不要碰布局属性（display / order / flex-direction）。
- 给最后一个置顶项加个 `.fsp-pinned-last` 类做分隔条，是个比把整组装进 `<div>` 更轻量的方案——不用动 DOM 结构，只加一个 class。

### 7.4 数据设计经验

- 数据结构里两个互斥的列表（`pinned` 和 `order["/"]`）必须**强制保证互斥**：写入一边时同时从另一边移除。否则迟早会出现"既在置顶又在普通区"的脏数据，渲染时去重逻辑得兜底。
- 默认值要写在常量 `DEFAULT_DATA` 里，加载时 `Object.assign({}, DEFAULT_DATA, savedData)`。即使老数据少字段也能向前兼容。
- 版本号 `version: 2` 写进去，以后再升级数据格式时可以做 migration。

## 8. 最终交付物清单

`.obsidian/plugins/file-shift-pin/`
├── `main.js` (~720 行) —— 插件主体
├── `manifest.json` —— 插件元数据
├── `styles.css` —— 拖拽指示 + 置顶高亮
└── `data.json` —— 已迁移的置顶列表 + active=true

`.obsidian/community-plugins.json` —— 删 `pin-folder-top` / `file-shift`，加 `file-shift-pin`

`.obsidian/appearance.json` —— 从 `enabledCssSnippets` 删 `pin-folder-top`

最终能力：

- 顶级文件夹支持拖拽换顺序
- 子文件夹 / 文件支持拖拽换顺序
- 置顶组单独成一个区，紫色高亮 + 虚线分隔
- 置顶组内部也能拖拽换顺序
- 拖入 / 拖出置顶区自动 pin / unpin
- 右键菜单 "置顶分支 / 取消置顶"
- Ribbon 图标切换"拖拽排序"开关（关闭后顺序回归 Obsidian 默认，但置顶高亮保留）
- 提供命令：重置顺序、清空置顶、从 pin-folder-top 导入

## 9. 反思：什么时候应该自己写插件

这次的判断标准：

1. **现有插件不能解决 = 一定**。本质冲突无法通过配置解决（CSS order vs DOM order），只能写新的。
2. **能合并能力 = 优先**。FileShift 的拖拽 + pin-folder-top 的高亮，本来就是两个独立功能，融合是顺理成章的事。
3. **代码量可控 = 可做**。在 File Shift 720 行源码基础上扩展，实际增量也就 100~150 行。从零写一个文件树插件是另一个量级。
4. **数据不丢 = 必须保证**。整个迁移过程必须做到"用户重启后看到的和重启前一样"。这是迁移类工作的红线。

如果这次需求只是"想给文件夹排序"，那直接装 File Shift 就够了。是"既要 + 又要"的组合需求把这件事推到了自定义插件的领域。

下一步可能的改进：

- 拖到屏幕底部自动滚动
- 支持多选拖拽
- 顶级文件夹之外的置顶（比如二级目录下也有"重要子文件夹"）
- 把数据格式版本化，做未来 migration 的脚手架

但这些都是锦上添花，**当前版本已经能 100% 满足"两个区域都能拖"的核心需求。**
