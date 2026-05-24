# AI Chat → Obsidian 一键剪藏

一个 Tampermonkey 油猴脚本。在 **ChatGPT** 和 **Gemini** 网页端**划词或单击工具栏按钮**，把对话内容（可选 AI 润色后）一键存入本地 Obsidian vault。

> **当前版本**：v0.9.6
> **支持站点**：ChatGPT (`chatgpt.com` / `chat.openai.com`) · Gemini (`gemini.google.com`)

---

## 功能一览

| 类别 | 功能 |
|---|---|
| **抓取入口** | ① 划词后弹浮层按钮 ② 消息工具栏（复制/点赞旁）的 📥 图标 ③ "..." 菜单项 ④ `Alt+S` 快捷键 |
| **选择器** | Win11 Mica 风格 · 分层文件夹浏览 · 支持搜索 · 支持新建路径 · 最近文件夹置顶 |
| **AI 润色** | 选择器右下角 **✨ 润色** 开关 · 默认 DeepSeek · OpenAI 兼容协议（可换 Kimi / SiliconFlow / 本地 ollama 等） |
| **格式还原** | GFM 表格 · KaTeX 公式 → LaTeX · 代码块装饰清理 · ChatGPT CSS Grid 表格识别 |
| **DOM 防改版** | `Alt+L` 学习模式（指认消息选择器；ChatGPT 和 Gemini 独立存储） |
| **兼容性** | Trusted Types 严格策略页面（Gemini）已兼容 |

---

## 安装步骤

### 1. 装 Tampermonkey

到 [tampermonkey.net](https://www.tampermonkey.net/) 下载浏览器扩展。

### 2. Chrome 用户必做：允许用户脚本

新版 Chrome 默认禁用用户脚本。需要：

1. 地址栏输入 `chrome://extensions/` 回车
2. **右上角"开发者模式"开关打开**
3. Tampermonkey 卡片 → "详情" → **打开"允许用户脚本"开关**

> Edge / Firefox 不需要这一步。

### 3. 装 Obsidian Local REST API

打开 Obsidian → 设置 → 社区插件 → 搜索 **Local REST API** → 安装 → 启用 → 进入插件设置：

- **必须打开** "Enable Non-encrypted (HTTP) Server"（紫色滑块，端口 27123）
- 复制 **API Key**（一长串），备用

### 4. 装脚本

1. 下载 [`chatgpt-to-obsidian.user.js`](chatgpt-to-obsidian.user.js)
2. 双击文件 → 浏览器自动弹 Tampermonkey 安装确认页 → 点 **"安装"**

### 5. 配置（必填）

打开 Tampermonkey 管理面板 → 点脚本进编辑器 → 找到顶部 `CONFIG`：

```js
const CONFIG = {
    OBSIDIAN_HOST: 'http://127.0.0.1:27123',
    API_KEY: 'YOUR_OBSIDIAN_API_KEY_HERE',  // ← 必填：粘贴步骤 3 复制的 Obsidian API Key
    DEFAULT_FOLDER: 'AI对话/' + SITE.label,
    ...
    POLISH: {
        ENDPOINT: 'https://api.deepseek.com/v1/chat/completions',
        API_KEY: '',                          // ← 想用 AI 润色就填，不填脚本仍能正常剪藏
        MODEL: 'deepseek-chat',
        ...
    },
};
```

保存（Ctrl+S），刷新 ChatGPT / Gemini 页面，即可使用。

---

## 使用方法

### 划词存（任意片段）

1. 在 ChatGPT / Gemini 页面上**选中你想要的文字**（可跨段落，但不要跨问答边界）
2. 选区附近浮出黑色 **"📥 存到 Obsidian"** 按钮
3. **单击** → 右下角弹文件夹选择器 → 选定 → 完成
4. **Shift+单击** → 直接存到上次的文件夹，跳过选择器

### 整条消息存

- 鼠标**悬停**任意消息 → 原生工具栏（复制/点赞旁）会出现一个 📥 图标 → 单击
- 或者点消息的 **"..."** 菜单，里面有 **"存到 Obsidian"** 一项

### 键盘快捷键

| 快捷键 | 功能 |
|---|---|
| `Alt+S` | 有选区时存选区；无选区时存当前悬停的消息 |
| `Alt+Shift+S` | 直接存到上次的文件夹（跳过选择器） |
| `Alt+L` | 进入/退出学习模式（DOM 改版后用） |

### 选择器内操作

| 键 | 效果 |
|---|---|
| `↑↓` | 选列表项 |
| `↵` | 进入子目录 / 选定无子目录的叶子 |
| `Ctrl+↵` | 保存到**当前所在层级**（输入框有内容时在该层级下新建子目录） |
| `←` 或 `Backspace` | 回上一层（输入框空时） |
| `Esc` | 关闭 |
| 单击右下角 **`✨ 润色`** | 切换 AI 润色（状态记忆，下次打开还在） |

### AI 润色流程

开 `✨ 润色 ON` 后保存，脚本会：

1. 把抓到的 Markdown 发给 DeepSeek（system prompt 让它结构化整理）
2. AI 返回整理后的内容：补全 `##` 标题、`**加粗**` 关键词、`-` 列表、保留代码/公式/表格
3. 写入 Obsidian，frontmatter 加 `polished: true` 标记便于筛选

prompt 在 `CONFIG.POLISH.SYSTEM_PROMPT` 里，可以自己改风格（保存即生效）。

---

## 换别家 AI

`POLISH` 用 OpenAI 兼容协议，把 endpoint / key / model 改成对应服务即可：

| 服务 | ENDPOINT | MODEL |
|---|---|---|
| **DeepSeek**（默认） | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |
| Kimi | `https://api.moonshot.cn/v1/chat/completions` | `moonshot-v1-8k` |
| SiliconFlow | `https://api.siliconflow.cn/v1/chat/completions` | `Qwen/Qwen2.5-7B-Instruct` |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `anthropic/claude-3.5-sonnet` |
| 本地 ollama | `http://localhost:11434/v1/chat/completions` | `qwen2.5:7b` |

> 用了未列出的 endpoint，记得在脚本头部 `// @connect` 那段加上对应域名，否则 Tampermonkey 会拒绝发请求。

---

## 笔记格式

每次剪藏生成一个独立 `.md` 文件，命名 `ChatGPT-YYYY-MM-DD-HHMM-标题前24字.md` 或 `Gemini-...`，自带 YAML frontmatter：

```yaml
---
source: chatgpt          # 或 gemini
role: user               # 或 assistant
kind: selection          # 或 message
polished: true           # 仅 AI 润色过才有
date: 2026-05-21T10:30:00.000Z
url: 当前对话链接
tags: [chatgpt]          # 或 [gemini]
---

## 内容主体...
```

可以用 Obsidian 的 Dataview / 文件管理插件按 tag 和 source 筛选。

---

## 常见问题

### Tampermonkey 图标上显示数字 "2"？

页面里有 iframe，脚本被算了两次。脚本已加 `@noframes` 应该是 1。如果还显示 2，是 Tampermonkey 计数偏差，不影响功能。

### 划词没出现浮层？

按 `Alt+L` 进学习模式 → 点一条用户消息 → 再点一条 AI 回复 → 自动校准选择器。Gemini 改版常需要这步。

### "连不上 Obsidian"？

1. Obsidian 必须在运行
2. Local REST API 插件已启用
3. **HTTP 端口 27123 已打开**（不是 HTTPS 27124）
4. 浏览器新标签页访问 `http://127.0.0.1:27123/` 能看到 JSON 表示通

### Gemini 上点存到 Obsidian 报 TrustedHTML 错？

v0.9.6 已修。如果还出现，**彻底重装脚本**（管理面板垃圾桶删 → 浏览器重启 → 重新装），让 Tampermonkey 重新拉取依赖。

### 导出的 markdown 没有标题/加粗？

ChatGPT/Gemini 有时不用 `<h2>`/`<strong>` 标签而用 CSS 模拟，turndown 抓不到。**开启 ✨ 润色** 让 AI 补回这些 markdown 标记。

### 选区跨问答抓不到？

按设计如此 —— 跨过 user 消息和 AI 回复时，浮层不显示。请在**同一条消息内**划选。

---

## 安全说明

- 脚本**只读取**已渲染的对话 DOM，等价于复制粘贴，**不调用任何 AI 网站的内部接口**
- 网络请求只发到三类地址：
  - `127.0.0.1:27123` — 你本机的 Obsidian
  - 你配置的 AI 润色 endpoint（仅在润色开启时才发）
  - `// @connect` 白名单内的域名
- 不会触发 ChatGPT / Gemini 的封号规则
- 类似的 userscript（ChatGPT Exporter、Superpower for ChatGPT 等）存在多年无封号案例

---

## License

MIT
