# Obsidian

这个仓库用于收集和开发 Obsidian 插件、扩展、CSS 片段、自动化工具，以及配套的使用笔记。

## 插件

| 插件 | 说明 | 状态 |
| --- | --- | --- |
| [FileShift+Pin](plugins/file-shift-pin) | 文件树拖拽排序 + 顶级文件夹置顶，**置顶组内部也能拖拽换顺序**。基于 [Qctsu/obsidian-file-shift](https://github.com/qctsu/obsidian-file-shift) 扩展。 | 推荐使用 |
| [Margin Annotations](plugins/margin-annotations) | 选中文字右键添加可编辑的彩色旁注，显示在 Obsidian 笔记左右留白处，支持图片/音视频/PDF 媒体旁注。 | 使用中 |
| [Pin Folder Top](plugins/pin-folder-top) | 把指定文件夹分支强制置顶到文件列表顶部（用 CSS `order` 实现）。 | 已被 FileShift+Pin 取代，保留作历史参考 |

## 用户脚本（油猴）

| 脚本 | 说明 |
| --- | --- |
| [AI Chat → Obsidian](chatgpt-to-obsidian) | 在 ChatGPT / Gemini 网页端划词或单击工具栏按钮，一键把对话存进 Obsidian vault；可选 AI 润色排版（DeepSeek / OpenAI 兼容）；支持表格、公式、代码块。 |

## 笔记

`notes/` 目录是我使用 Obsidian 过程中的复盘、踩坑记录和插件开发文档：

| 笔记 | 主题 |
| --- | --- |
| [FileShift+Pin 插件开发复盘](notes/FileShift+Pin%20%E6%8F%92%E4%BB%B6%E5%BC%80%E5%8F%91%E5%A4%8D%E7%9B%98.md) | 从"想给文件夹拖拽换顺序"到自写插件的完整过程，包含设计思路、关键技术决策、踩坑总结。 |
| [Margin Annotations 插件开发复盘](notes/Margin%20Annotations%20%E6%8F%92%E4%BB%B6%E5%BC%80%E5%8F%91%E5%A4%8D%E7%9B%98.md) | 旁注插件的需求演化、与 Cornell Marginalia 的对比、设计取舍。 |
| [Zone Scroll Zoom](notes/Zone%20Scroll%20Zoom.md) | 局部滚动缩放插件的使用心得。 |
| [隐藏复制粘贴的图片等附件](notes/%E9%9A%90%E8%97%8F%E5%A4%8D%E5%88%B6%E7%B2%98%E8%B4%B4%E7%9A%84%E5%9B%BE%E7%89%87%E7%AD%89%E9%99%84%E4%BB%B6.md) | 让文件树不显示自动收集的附件文件的配置方案。 |
| [置顶分支](notes/%E7%BD%AE%E9%A1%B6%E5%88%86%E6%94%AF.md) | Pin Folder Top 的初版使用记录。 |
| [Smart Note Agent 与网页浏览器配置](notes/Smart%20Note%20Agent%20%E4%B8%8E%E7%BD%91%E9%A1%B5%E6%B5%8F%E8%A7%88%E5%99%A8%E9%85%8D%E7%BD%AE.md) | Smart Note Agent（DeepSeek）与内置网页浏览器（Web viewer）的配置步骤。 |

## 目录约定

- `plugins/`：Obsidian 插件源代码。
- `notes/`：使用心得、插件开发复盘、技术笔记。
- `chatgpt-to-obsidian/`：ChatGPT 网页剪藏油猴脚本。
- `snippets/`：（预留）CSS 代码片段。
- `tools/`：（预留）开发辅助脚本。

## 隐私 / 数据约定

仓库不收录任何运行时数据：

- 插件的 `data.json` 已加入 `.gitignore`（这些文件包含具体的置顶文件夹名、笔记顺序等用户配置）。
- `.obsidian/` 整个目录已忽略。
- 想体验插件时，按各插件 README 的"安装"步骤手动放进自己的 vault 即可。

## 致谢

- [FileShift](https://github.com/qctsu/obsidian-file-shift) by Qctsu —— FileShift+Pin 的拖拽机制基础。
- Cornell Marginalia —— Margin Annotations 的产品参照物。
