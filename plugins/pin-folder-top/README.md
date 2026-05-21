# Pin Folder Top

Pin Folder Top 是一个轻量 Obsidian 插件，用来把指定文件夹分支移动到文件列表顶部。

## 功能

- 支持置顶一个或多个文件夹路径。
- 支持在设置页中按行配置路径。
- 文件列表刷新、布局变化、文件树重绘后会自动重新置顶。
- 提供命令面板命令：`立即刷新置顶分支`。

## 安装

手动安装：

1. 在 Obsidian vault 中打开 `.obsidian/plugins/`。
2. 新建目录 `pin-folder-top`。
3. 把本目录中的 `manifest.json`、`main.js`、`styles.css` 放进去。
4. 在 Obsidian 设置中启用第三方插件，然后启用 `Pin Folder Top`。

## 配置

进入 `设置 -> 第三方插件 -> Pin Folder Top`，在 `置顶分支` 中每行填写一个路径，例如：

```text
仓库
资料/仓库
```

路径从 vault 根目录开始，不需要写盘符。
