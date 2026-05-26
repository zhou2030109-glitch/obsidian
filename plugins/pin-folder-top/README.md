# Pin Folder Top

把指定的顶级文件夹强制钉到 Obsidian 文件树最上方，并加紫色边框高亮。

> ⚠️ 如果想让"置顶组内部也能拖拽换顺序"，请改用同仓库的 [`file-shift-pin`](../file-shift-pin)，它把置顶 + 拖拽排序融合到了一起。Pin Folder Top 是更早的"纯置顶"实现，**只能通过文本列表调整顺序**。

## 功能

- 在文件树右键任意文件夹 → "置顶分支 / 取消置顶"。
- 置顶项强制排在最前，并带紫色左边框高亮。
- 支持多个置顶项，顺序由设置页里的文本列表决定（每行一个路径）。
- 提供命令面板命令：`刷新置顶分支样式`。
- 置顶规则通过注入 CSS 实现（`<style id="pin-folder-top-style">` + 同步写入 `.obsidian/snippets/pin-folder-top.css`），无 DOM 操作，无闪烁。

## 实现方式

核心思路：用 CSS flex `order` 属性控制顺序，给每个置顶项分配一个非常小的 order 值：

```css
.nav-folder:has(> .nav-folder-title[data-path="仓库"]) {
  order: -100000 !important;
}
```

> 注意：因为用了 `order: !important`，这意味着**其他插件（比如 FileShift）无法通过 DOM 顺序改写置顶项的位置**。如果你需要"置顶项也能拖拽排序"，要么改用 file-shift-pin，要么关掉这个插件的 snippet。

## 安装

1. 在 vault 中打开 `.obsidian/plugins/`。
2. 新建目录 `pin-folder-top`。
3. 把本目录的 `manifest.json` 和 `main.js` 放进去。
4. 启用第三方插件。

## 配置

`设置 → 第三方插件 → Pin Folder Top → 置顶列表`，每行一个路径（从 vault 根目录开始）：

```
仓库
知识库
某子文件夹/重要分支
```

## 数据

- 插件设置存在 `.obsidian/plugins/pin-folder-top/data.json`（不在仓库内，已 `.gitignore`）。
- CSS 自动生成到 `.obsidian/snippets/pin-folder-top.css`，需要在"外观 → CSS 代码片段"里启用一次。

## 版本历史

- **1.1.0** —— 改用紫色边框高亮（替代原本的下划线），写入 snippet 文件以便和其他主题协同。
- **1.0.0** —— 首版。
