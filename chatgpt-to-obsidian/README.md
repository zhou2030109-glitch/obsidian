# ChatGPT → Obsidian 一键剪藏

一个 Tampermonkey 油猴脚本，在 ChatGPT 网页端**划词或单击工具栏按钮**，即可把对话内容存到本地 Obsidian vault，支持表格、公式、代码块。

## 功能

- **划词存** — 在 ChatGPT 任意位置选中文字，浮出"📥 存到 Obsidian"按钮，单击落地
- **整条存** — 鼠标悬停消息，ChatGPT 原生工具栏（复制/点赞旁边）会多出一个图标按钮
- **菜单存** — 点 ChatGPT 自带的 "..." 菜单也能看到"存到 Obsidian"项
- **Alt+S 快捷键** — 选中文字后按 `Alt+S` 直接走流程
- **分层选择器** — 像文件管理器一样按文件夹层级浏览，支持搜索与新建路径
- **Win11 Mica 风格** — 半透明深色 + 模糊
- **格式增强** — GFM 表格、KaTeX 公式 → LaTeX、ChatGPT 代码块装饰清理、CSS Grid 表格识别

## 安装

### 前置条件

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)
2. Chrome 用户须在 `chrome://extensions/` 打开 Tampermonkey 的"允许用户脚本"
3. Obsidian 安装并启用 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 社区插件
4. 在 Local REST API 设置中**启用 HTTP 服务**（端口 27123）

### 安装脚本

1. 把 `chatgpt-to-obsidian.user.js` 内容复制
2. 打开 Tampermonkey 管理面板 → 新建脚本 → 粘贴 → `Ctrl+S` 保存

### 配置 API Key

打开脚本，把第 26 行的 `YOUR_OBSIDIAN_API_KEY_HERE` 替换为你的 Obsidian Local REST API 的 API Key（在插件设置页面可以看到完整 key）：

```js
const CONFIG = {
    OBSIDIAN_HOST: 'http://127.0.0.1:27123',
    API_KEY: '在这里粘贴你的 API Key',
    DEFAULT_FOLDER: 'AI对话/ChatGPT',
    ...
};
```

保存后刷新 ChatGPT 页面即可。

## 使用

| 操作 | 效果 |
|---|---|
| 划选文字 → 单击浮层 | 弹分层选择器选文件夹 |
| 划选文字 → Shift+单击浮层 | 直接存到上次的文件夹 |
| 悬停消息 → 单击工具栏的 📥 | 整条消息走选择器 |
| 点 "..." → "存到 Obsidian" | 整条消息走选择器 |
| `Alt+S`（有选区时） | 选区走选择器 |
| `Alt+Shift+S` | 直接存到上次的文件夹 |
| `Alt+L` | 进入学习模式（重新识别消息选择器，DOM 改版时用） |

## 选择器操作

| 键 | 效果 |
|---|---|
| `↑↓` | 选择列表项 |
| `↵` | 进入子目录 / 选定无子目录的项 |
| `Ctrl+↵` | 保存到当前层级（输入框有内容则新建该子目录） |
| `←` 或 `Backspace`（输入框空时） | 回上一层 |
| `Esc` | 关闭 |

## 笔记格式

每条剪藏存为独立 `.md` 文件，文件名 `ChatGPT-YYYY-MM-DD-HHMM-标题前24字.md`，带 frontmatter：

```yaml
---
source: chatgpt
role: user | assistant
kind: message | selection
date: 2026-05-21T10:30:00.000Z
url: 当前对话链接
tags: [chatgpt]
---
```

## 安全说明

- 脚本**只读取**你浏览器里已渲染的对话内容（等价于复制粘贴），**不调用任何 OpenAI 内部接口**
- 所有网络请求**只发到 `127.0.0.1:27123`**（你本机的 Obsidian），数据不出本机
- 通过 `@connect 127.0.0.1` 白名单约束，理论上也无法误发到外网
- 不会触发 OpenAI 的封号规则

## 兼容性

- 已测试：Chrome / Edge + Tampermonkey
- ChatGPT DOM 改版时使用 `Alt+L` 学习模式重新识别即可，不需要改代码

## License

MIT
