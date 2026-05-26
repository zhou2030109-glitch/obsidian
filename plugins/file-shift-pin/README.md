# FileShift+Pin

把 Obsidian 文件树的"拖拽排序"和"分支置顶"融合在一起，**两个区段都能拖**。

基于 [Qctsu/obsidian-file-shift](https://github.com/qctsu/obsidian-file-shift) 扩展，吸收 `pin-folder-top` 的置顶视觉概念，但用 DOM 顺序而非 CSS `order: !important` 实现，因此置顶组内部仍然可以自由拖拽。

完整的设计与实现过程见 [../notes/FileShift+Pin 插件开发复盘.md](../../notes/FileShift+Pin%20%E6%8F%92%E4%BB%B6%E5%BC%80%E5%8F%91%E5%A4%8D%E7%9B%98.md)。

## 功能一览

- 顶级文件夹 / 子文件夹 / 文件全部支持拖拽换顺序。
- 顶级文件夹可"置顶"，置顶组带紫色左边框高亮 + 下方虚线分隔。
- **置顶组内部也能拖拽换顺序**（这正是和 pin-folder-top 的根本区别）。
- 拖拽即操作：
  - 把非置顶项拖到置顶区 → 自动置顶。
  - 把置顶项拖到非置顶区 → 自动取消置顶。
- 右键文件夹（顶级）→ "置顶分支 / 取消置顶"，等同效果。
- Ribbon 上下双箭头图标控制"拖拽排序"总开关。关闭后顺序回归 Obsidian 默认，但置顶高亮仍保留。

## 安装

1. 在 vault 中打开 `.obsidian/plugins/`。
2. 新建目录 `file-shift-pin`。
3. 把本目录的 `main.js`、`manifest.json`、`styles.css` 放进去。
4. 启用第三方插件 `FileShift+Pin`。
5. 点左侧 Ribbon 的上下双箭头图标开启。

## 数据模型

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

- `pinned`：根目录下置顶的顶级文件夹名，**有序**。
- `order`：每个父目录下的"非置顶"子项顺序。`/` 是根目录。
- `pinned` 和 `order["/"]` 互斥：写入一边时同时从另一边移除。
- 数据保存在 `data.json`（不在仓库内，已 `.gitignore`）。

## 拖拽规则总表

| 源 | 目标 | 结果 |
|---|---|---|
| 置顶项 | 置顶项 | 调整 `pinned` 数组顺序 |
| 置顶项 | 非置顶项 | 从 `pinned` 移除，插入 `order["/"]`（自动取消置顶） |
| 非置顶项 | 置顶项 | 从 `order["/"]` 移除，插入 `pinned`（自动置顶） |
| 非置顶项 | 非置顶项 | 调整 `order["/"]` 顺序 |

落点位置由鼠标 Y 坐标决定：

- 文件夹标题上半 25% → 在它**之前**插入
- 文件夹标题下半 25% → 在它**之后**插入
- 文件夹标题中间 50% → 走 Obsidian 原生行为，**移入这个文件夹**

## 命令

`Ctrl+P` 命令面板可用：

- `Toggle custom ordering on/off` —— 切换拖拽排序总开关。
- `Reset all custom ordering (keeps pins)` —— 清空所有自定义顺序，置顶保留。
- `Clear all pinned folders` —— 清空所有置顶，顺序保留。
- `Import pinned list from pin-folder-top` —— 从同仓库 pin-folder-top 的 data.json 导入置顶列表。

## 和 pin-folder-top 的关系

| 维度 | pin-folder-top | file-shift-pin |
|---|---|---|
| 控制顺序的机制 | CSS `order: !important` | DOM 顺序（`vChildren.setChildren` + DOM fallback） |
| 置顶项之间能否拖拽 | 不能 | **能** |
| 普通项能否拖拽 | 不能 | 能 |
| 置顶视觉 | 紫色边框 | 紫色边框 + 虚线分隔 |
| 配置方式 | 文本列表 / 右键 | 拖拽 / 右键 |

**两个插件不能同时启用**，CSS order 会覆盖 DOM 顺序，导致 file-shift-pin 拖完又被拉回去。如果要切换，请：

1. 禁用 `pin-folder-top`。
2. 禁用 `.obsidian/snippets/pin-folder-top.css`（在外观设置里）。
3. 启用 `file-shift-pin`。
4. 命令面板运行 `Import pinned list from pin-folder-top` 把旧置顶列表迁移过来。
