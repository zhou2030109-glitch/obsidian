# AI Chat → Obsidian 一键剪藏

一个 Tampermonkey 油猴脚本。在 **ChatGPT** 和 **Gemini** 网页端**划词或单击工具栏按钮**，把对话内容（可选 AI 润色后）存入本地 Obsidian vault。

## 功能

- **支持站点**：ChatGPT (`chatgpt.com` / `chat.openai.com`) + Gemini (`gemini.google.com`)
- **划词存** — 在页面任意位置选中文字，浮出"📥 存到 Obsidian"按钮
- **整条存** — 鼠标悬停消息，原生工具栏（复制/点赞旁边）会多出一个图标按钮
- **菜单存** — 点页面自带的 "..." 菜单也能看到"存到 Obsidian"项
- **Alt+S 快捷键** — 选中文字后按 `Alt+S` 直接走流程
- **分层文件夹选择器** — 像文件管理器一样按层级浏览，搜索模式跨层级模糊匹配
- **✨ AI 润色** — 选择器里加了 toggle 按钮，开启后保存前先调 AI 把内容整理成结构化 Markdown（默认 DeepSeek，OpenAI 兼容协议）
- **Win11 Mica 风格** — 半透明深色 + 模糊
- **格式增强** — GFM 表格、KaTeX 公式 → LaTeX、代码块装饰清理、CSS Grid 表格识别

## 安装

### 前置条件

1. 浏览器装 [Tampermonkey](https://www.tampermonkey.net/)
2. Chrome 用户在 `chrome://extensions/` 打开 Tampermonkey 的"允许用户脚本"开关
3. Obsidian 装 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 社区插件，启用 HTTP 服务（端口 27123）

### 安装脚本

1. 复制 `chatgpt-to-obsidian.user.js` 全部内容
2. 打开 Tampermonkey 管理面板 → 左上角 `+` 新建脚本 → 粘贴 → `Ctrl+S` 保存

### 配置（必填）

打开脚本顶部 `CONFIG`：

```js
const CONFIG = {
    OBSIDIAN_HOST: 'http://127.0.0.1:27123',
    API_KEY: 'YOUR_OBSIDIAN_API_KEY_HERE',       // ← 替换成你的 Obsidian Local REST API key
    DEFAULT_FOLDER: 'AI对话/' + SITE.label,
    DEFAULT_USER_SELECTOR: SITE.userSel,
    DEFAULT_ASSISTANT_SELECTOR: SITE.asstSel,
    POLISH: {
        ENDPOINT: 'https://api.deepseek.com/v1/chat/completions',
        API_KEY: '',                              // ← 想用 AI 润色就填，不用就留空
        MODEL: 'deepseek-chat',
        TEMPERATURE: 0.3,
        SYSTEM_PROMPT: `...`,
    },
};
```

- `API_KEY` 从 Obsidian 的 Local REST API 设置页复制
- `POLISH.API_KEY` 是 AI 服务的 key（DeepSeek 在 [platform.deepseek.com](https://platform.deepseek.com) 申请）

### 换别家 AI

`POLISH` 用 OpenAI 兼容协议，把 endpoint / key / model 改成对应服务即可：

| 服务 | ENDPOINT | MODEL |
|---|---|---|
| DeepSeek（默认） | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |
| Kimi | `https://api.moonshot.cn/v1/chat/completions` | `moonshot-v1-8k` |
| SiliconFlow | `https://api.siliconflow.cn/v1/chat/completions` | `Qwen/Qwen2.5-7B-Instruct` |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `anthropic/claude-3.5-sonnet` |
| 本地 ollama | `http://localhost:11434/v1/chat/completions` | `qwen2.5:7b` |

> 用了其他 endpoint 后，记得在脚本头部 `// @connect` 那段加上对应域名。

## 使用

| 操作 | 效果 |
|---|---|
| 划选文字 → 单击浮层 | 弹分层选择器 |
| 划选文字 → Shift+单击浮层 | 直接存到上次的文件夹（不润色） |
| 悬停消息 → 单击工具栏 📥 | 整条消息走选择器 |
| 点 "..." → "存到 Obsidian" | 整条消息走选择器 |
| `Alt+S`（有选区时） | 选区走选择器 |
| `Alt+Shift+S` | 直接存到上次的文件夹 |
| `Alt+L` | 学习模式（DOM 改版后重新指认消息选择器） |

## 选择器操作

| 键 | 效果 |
|---|---|
| `↑↓` | 选列表项 |
| `↵` | 进入子目录 / 选定无子目录的项 |
| `Ctrl+↵` | 保存到当前层级（输入框有内容时新建子目录） |
| `←` 或 `Backspace`（输入框空时） | 回上一层 |
| `Esc` | 关闭 |
| 单击 `✨ 润色` | 切换 AI 润色开关（状态记忆，下次打开保持） |

## AI 润色流程

开启 `✨ 润色 ON` 后选择保存，脚本会：

1. 把原始 Markdown 发给 AI（system prompt 让 AI 按结构化 Markdown 整理）
2. AI 返回整理后的内容（拆分标题、列表化、删冗余、保留代码/公式/表格）
3. 整理后的内容写入 Obsidian，frontmatter 加 `polished: true` 标记

如果想改润色风格，修改 `CONFIG.POLISH.SYSTEM_PROMPT`。

## 笔记格式

每条剪藏存为独立 `.md` 文件，文件名 `ChatGPT-YYYY-MM-DD-HHMM-标题前24字.md` 或 `Gemini-...`，带 frontmatter：

```yaml
---
source: chatgpt | gemini
role: user | assistant
kind: message | selection
polished: true   # 仅润色后才有
date: 2026-05-21T10:30:00.000Z
url: 当前对话链接
tags: [chatgpt]   # 或 [gemini]
---
```

## 安全说明

- 脚本**只读取**已渲染的对话 DOM，等价于复制粘贴，**不调用任何 AI 网站的内部接口**
- 网络请求只发到三类地址：
  - `127.0.0.1:27123` — 你本机的 Obsidian
  - AI 服务 endpoint（润色开启时才发，默认 `api.deepseek.com`）
  - 在 `// @connect` 白名单内
- 不会触发 ChatGPT / Gemini 的封号规则

## DOM 改版怎么办

按 `Alt+L` 进学习模式 → 点一条 user 消息 → 再点一条 AI 回复 → 自动记住新选择器，不用改代码。学习状态对每个站点单独存储（ChatGPT 和 Gemini 互不影响）。

## License

MIT
