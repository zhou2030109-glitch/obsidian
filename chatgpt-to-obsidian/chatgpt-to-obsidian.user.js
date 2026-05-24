// ==UserScript==
// @name         AI Chat → Obsidian 一键剪藏
// @namespace    ai-chat-to-obsidian
// @version      0.9.6
// @description  ChatGPT / Gemini 划词或单击工具栏按钮，存入 Obsidian；支持 AI 润色 + 表格/公式/代码块
// @author       you
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://gemini.google.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      127.0.0.1
// @connect      localhost
// @connect      api.deepseek.com
// @connect      api.openai.com
// @connect      api.moonshot.cn
// @connect      api.siliconflow.cn
// @connect      openrouter.ai
// @connect      api.together.xyz
// @require      https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js
// @require      https://cdn.jsdelivr.net/npm/@joplin/turndown-plugin-gfm@1.0.61/dist/turndown-plugin-gfm.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    (function setupTrustedTypes() {
        if (!window.trustedTypes || !window.trustedTypes.createPolicy) return;
        try {
            window.trustedTypes.createPolicy('default', {
                createHTML: s => s,
                createScript: s => s,
                createScriptURL: s => s,
            });
            return;
        } catch (e) {}
        let pol;
        try {
            pol = window.trustedTypes.createPolicy('o2o-' + Date.now(), { createHTML: s => s });
        } catch (e) { return; }
        const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        if (!desc || !desc.set) return;
        const origSet = desc.set;
        try {
            Object.defineProperty(Element.prototype, 'innerHTML', {
                configurable: true,
                enumerable: desc.enumerable,
                get: desc.get,
                set: function(val) {
                    if (typeof val === 'string') {
                        try { return origSet.call(this, pol.createHTML(val)); } catch (e) {}
                    }
                    return origSet.call(this, val);
                },
            });
        } catch (e) {}
    })();

    const SITE = (() => {
        const h = location.hostname;
        if (h.includes('gemini.google.com')) {
            return {
                name: 'gemini',
                label: 'Gemini',
                userSel: 'user-query, .user-query-bubble-with-background, [class*="user-query-container"]',
                asstSel: 'model-response, .model-response-text, [class*="model-response"]',
            };
        }
        return {
            name: 'chatgpt',
            label: 'ChatGPT',
            userSel: '[data-message-author-role="user"]',
            asstSel: '[data-message-author-role="assistant"]',
        };
    })();

    const CONFIG = {
        OBSIDIAN_HOST: 'http://127.0.0.1:27123',
        API_KEY: 'YOUR_OBSIDIAN_API_KEY_HERE',
        DEFAULT_FOLDER: 'AI对话/' + SITE.label,
        DEFAULT_USER_SELECTOR: SITE.userSel,
        DEFAULT_ASSISTANT_SELECTOR: SITE.asstSel,
        POLISH: {
            ENDPOINT: 'https://api.deepseek.com/v1/chat/completions',
            API_KEY: '',
            MODEL: 'deepseek-chat',
            TEMPERATURE: 0.3,
            SYSTEM_PROMPT: `你是 Markdown 排版专家。输入是从 AI 对话页面剪藏的内容（往往已经丢失了标题/加粗的标记，只是纯文本段落）。把它整理成一篇结构清晰、视觉漂亮、可直接放进 Obsidian 的 Markdown 笔记。

【硬性要求 - 必须用真正的 Markdown 语法】
1. 每个主题段落都要起一个 \`## 二级标题\`（优先用 ##，必须带 # 号；只有子主题才用 ### 三级标题，不要全篇都用 ###）
2. 关键术语 / 算法名 / 模型名 / 重要结论 用 \`**加粗**\`
3. 列举内容用 \`-\` 列表或 \`1.\` 编号列表
4. 重要洞察或核心结论可以用 \`> 引用块\` 突出
5. 行内代码用反引号包裹，代码段用三个反引号 + 语言名
6. 数学公式保留 \`$...$\` 行内 / \`$$...$$\` 块级
7. 表格保持 \`| 列1 | 列2 |\` 格式

【内容处理】
- 根据内容主线合理拆分多个 \`##\` 段落（一般 2-5 个二级标题）
- 删除"好的"、"以下是..."、"希望对你有帮助"等客套话
- 删除重复内容
- 保留所有事实、数字、人名、引用
- 保持原始语言（中文→中文，英文→英文）

【输出格式】
- 不要 frontmatter
- 不要用 \`\`\`markdown 包裹整体
- 开头直接进正文，不要"以下是整理后的内容"这种前言
- 第一行就是 \`## 第一个主题\`

【示例】
输入：
"REDIFFUSE 算法 为了解决这个问题，作者提出了 REDIFFUSE 算法。它的核心思想是利用 Variation API。论文实验结果显示，REDIFFUSE 在 DALL-E 2 上准确率超过 90%。"

输出：
## REDIFFUSE 算法

为了解决这个问题，作者提出了 **REDIFFUSE** 算法。它的核心思想是利用 **Variation API**。

## 实验结果

论文实验数据显示，**REDIFFUSE** 在 **DALL-E 2** 上准确率超过 **90%**。`,
        },
    };

    const turndown = new TurndownService({
        codeBlockStyle: 'fenced',
        headingStyle: 'atx',
        bulletListMarker: '-',
        emDelimiter: '*',
    });
    if (window.turndownPluginGfm) {
        turndown.use(window.turndownPluginGfm.gfm);
    }
    turndown.remove(['style', 'script']);

    turndown.addRule('chatgptCodeBlock', {
        filter: (node) => node.nodeName === 'PRE' && node.querySelector('code'),
        replacement: (content, node) => {
            const code = node.querySelector('code');
            const cls = code.className || '';
            const m = cls.match(/language-(\S+)/);
            const lang = m ? m[1] : '';
            const text = code.textContent.replace(/\n$/, '');
            return '\n\n```' + lang + '\n' + text + '\n```\n\n';
        },
    });

    turndown.addRule('katex', {
        filter: (node) => {
            if (!node.classList) return false;
            if (node.classList.contains('katex-display')) return true;
            if (node.classList.contains('katex') &&
                !node.parentElement?.classList?.contains('katex-display')) return true;
            return false;
        },
        replacement: (content, node) => {
            const anno = node.querySelector('annotation[encoding="application/x-tex"]');
            const latex = anno ? anno.textContent.trim() : node.textContent.trim();
            if (!latex) return '';
            return node.classList.contains('katex-display')
                ? `\n\n$$\n${latex}\n$$\n\n`
                : `$${latex}$`;
        },
    });

    turndown.addRule('chatgptTable', {
        filter: 'table',
        replacement: (content, node) => {
            const rows = [...node.querySelectorAll('tr')];
            if (rows.length === 0) return '';
            const lines = [];
            let headerInjected = false;
            rows.forEach((row) => {
                const cells = [...row.children].map(c =>
                    (c.textContent || '').trim()
                        .replace(/\|/g, '\\|')
                        .replace(/\n+/g, ' ')
                );
                if (cells.length === 0) return;
                lines.push('| ' + cells.join(' | ') + ' |');
                if (!headerInjected) {
                    lines.push('| ' + cells.map(() => '---').join(' | ') + ' |');
                    headerInjected = true;
                }
            });
            return '\n\n' + lines.join('\n') + '\n\n';
        },
    });

    turndown.addRule('chatgptGridTable', {
        filter: (node) => node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-o2o-grid-cols'),
        replacement: (content, node) => {
            const cols = parseInt(node.getAttribute('data-o2o-grid-cols'), 10);
            if (!cols || cols < 2) return content;
            const cells = [...node.children].map(c =>
                (c.textContent || '').trim()
                    .replace(/\|/g, '\\|')
                    .replace(/\n+/g, ' ')
            );
            if (cells.length < cols) return content;
            const lines = [];
            for (let i = 0; i < cells.length; i += cols) {
                const row = cells.slice(i, i + cols);
                while (row.length < cols) row.push('');
                lines.push('| ' + row.join(' | ') + ' |');
                if (i === 0) {
                    lines.push('| ' + row.map(() => '---').join(' | ') + ' |');
                }
            }
            return '\n\n' + lines.join('\n') + '\n\n';
        },
    });

    let learnedSelectors = GM_getValue('learned_selectors_' + SITE.name, null);
    let recentFolders = GM_getValue('recent_folders', []);

    const getUserSel = () => (learnedSelectors && learnedSelectors.user) || CONFIG.DEFAULT_USER_SELECTOR;
    const getAsstSel = () => (learnedSelectors && learnedSelectors.assistant) || CONFIG.DEFAULT_ASSISTANT_SELECTOR;

    function pushRecent(folder) {
        recentFolders = [folder, ...recentFolders.filter(f => f !== folder)].slice(0, 5);
        GM_setValue('recent_folders', recentFolders);
    }

    const ICON_SAVE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

    function setHTML(el, html) {
        try { el.innerHTML = html; return; } catch (e) {}
        while (el.firstChild) el.removeChild(el.firstChild);
        try {
            const doc = new DOMParser().parseFromString(String(html), 'text/html');
            while (doc.body.firstChild) el.appendChild(doc.body.firstChild);
        } catch (e) {
            el.textContent = String(html).replace(/<[^>]+>/g, '');
        }
    }

    GM_addStyle(`
        .o2o-tb-btn {
            background: transparent; border: none; padding: 0;
            width: 32px; height: 32px; border-radius: 8px;
            cursor: pointer; color: currentColor;
            display: inline-flex; align-items: center; justify-content: center;
            opacity: 0.75; transition: background .15s, opacity .15s;
            margin: 0 2px;
        }
        .o2o-tb-btn:hover { opacity: 1; background: rgba(0,0,0,0.06); }
        @media (prefers-color-scheme: dark) {
            .o2o-tb-btn:hover { background: rgba(255,255,255,0.08); }
        }
        html.dark .o2o-tb-btn:hover { background: rgba(255,255,255,0.08); }

        .o2o-menu-item {
            padding: 8px 12px !important; cursor: pointer !important;
            font-size: 14px !important; line-height: 1.4 !important;
            display: flex !important; align-items: center !important; gap: 10px !important;
            color: inherit !important; user-select: none !important;
            border-radius: 6px !important; margin: 2px 4px !important;
            box-sizing: border-box !important; outline: none !important;
        }
        .o2o-menu-item:hover { background: rgba(0,0,0,0.06) !important; }
        html.dark .o2o-menu-item:hover { background: rgba(255,255,255,0.08) !important; }
        @media (prefers-color-scheme: dark) {
            .o2o-menu-item:hover { background: rgba(255,255,255,0.08) !important; }
        }

        .o2o-sel-btn {
            position: absolute; z-index: 99999;
            padding: 7px 13px;
            background: rgba(32,32,34,0.82);
            backdrop-filter: blur(40px) saturate(200%);
            -webkit-backdrop-filter: blur(40px) saturate(200%);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px; font-weight: 500;
            box-shadow: 0 8px 24px rgba(0,0,0,.35);
            display: inline-flex; align-items: center; gap: 8px;
            font-family: "Segoe UI Variable", "Segoe UI", -apple-system, "Microsoft YaHei", sans-serif;
        }
        .o2o-sel-btn:hover { background: rgba(50,50,52,0.85); }

        .o2o-picker {
            position: fixed; bottom: 24px; right: 24px;
            width: 340px; max-height: 60vh;
            background: rgba(32,32,34,0.78);
            backdrop-filter: blur(40px) saturate(200%);
            -webkit-backdrop-filter: blur(40px) saturate(200%);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 16px 48px rgba(0,0,0,.35);
            z-index: 100000; display: flex; flex-direction: column;
            font-family: "Segoe UI Variable", "Segoe UI", -apple-system, "Microsoft YaHei", sans-serif;
            animation: o2o-slide-in .18s cubic-bezier(.2,.8,.3,1);
        }
        @keyframes o2o-slide-in {
            from { transform: translateY(12px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        .o2o-picker-head {
            padding: 12px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .o2o-picker-input {
            width: 100%; box-sizing: border-box;
            padding: 8px 12px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 6px;
            color: #fff; outline: none;
            font-size: 13px;
            font-family: inherit;
            transition: border-color .15s, background .15s;
        }
        .o2o-picker-input:focus {
            border-color: rgba(255,255,255,0.2);
            background: rgba(255,255,255,0.08);
        }
        .o2o-picker-input::placeholder { color: rgba(255,255,255,0.4); }
        .o2o-picker-list { flex: 1; overflow-y: auto; min-height: 0; padding: 6px; }
        .o2o-picker-list::-webkit-scrollbar { width: 8px; }
        .o2o-picker-list::-webkit-scrollbar-track { background: transparent; }
        .o2o-picker-list::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.1); border-radius: 4px;
        }
        .o2o-picker-list::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        .o2o-picker-item {
            padding: 0 12px; cursor: pointer; font-size: 13px;
            display: flex; align-items: center; gap: 12px;
            border-radius: 6px;
            height: 38px;
            color: #fff;
        }
        .o2o-picker-item:hover { background: rgba(255,255,255,0.06); }
        .o2o-picker-item.active { background: rgba(255,255,255,0.1); }
        .o2o-picker-item .o2o-icon { font-size: 15px; flex-shrink: 0; }
        .o2o-picker-item .o2o-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .o2o-tag {
            font-size: 10px;
            background: rgba(255,255,255,0.08);
            color: rgba(255,255,255,0.7);
            padding: 2px 8px; border-radius: 10px;
            flex-shrink: 0;
        }
        .o2o-picker-item.active .o2o-tag { background: rgba(255,255,255,0.18); color: #fff; }
        .o2o-picker-item .o2o-chev {
            color: rgba(255,255,255,0.4); font-size: 16px; flex-shrink: 0;
            margin-left: 2px;
        }
        .o2o-picker-item.active .o2o-chev { color: rgba(255,255,255,0.85); }
        .o2o-picker-empty { padding: 16px 12px; color: rgba(255,255,255,0.5); font-size: 12px; text-align: center; }
        .o2o-picker-empty kbd {
            background: rgba(255,255,255,0.1); padding: 1px 5px; border-radius: 3px;
            font-size: 10px; color: rgba(255,255,255,0.85);
            font-family: ui-monospace, "SF Mono", "Cascadia Mono", monospace;
        }
        .o2o-picker-crumb {
            padding: 8px 12px 4px;
            font-size: 12px;
            display: flex; align-items: center; flex-wrap: wrap;
            gap: 2px;
        }
        .o2o-crumb-seg {
            cursor: pointer;
            padding: 3px 8px;
            border-radius: 4px;
            color: rgba(255,255,255,0.75);
        }
        .o2o-crumb-seg:hover { background: rgba(255,255,255,0.08); color: #fff; }
        .o2o-crumb-seg.current { color: #fff; font-weight: 500; }
        .o2o-crumb-sep { color: rgba(255,255,255,0.3); padding: 0 1px; }

        .o2o-picker-actions {
            display: flex; gap: 8px;
            margin: 4px 12px 8px;
        }
        .o2o-picker-save {
            flex: 1;
            padding: 9px 12px;
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 6px;
            color: #fff;
            font-size: 13px;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center; gap: 8px;
            font-family: inherit;
            transition: background .15s, border-color .15s;
            min-width: 0;
        }
        .o2o-picker-save:hover { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.2); }
        .o2o-picker-save b { font-weight: 600; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .o2o-polish-toggle {
            padding: 0 12px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 6px;
            color: rgba(255,255,255,0.65);
            font-size: 12px;
            cursor: pointer;
            font-family: inherit;
            white-space: nowrap;
            display: flex; align-items: center; gap: 4px;
            transition: all .15s;
        }
        .o2o-polish-toggle:hover { background: rgba(255,255,255,0.12); color: #fff; }
        .o2o-polish-toggle.on {
            background: rgba(180,150,255,0.25);
            border-color: rgba(180,150,255,0.5);
            color: #fff;
        }
        .o2o-polish-toggle.on:hover { background: rgba(180,150,255,0.35); }

        .o2o-picker-foot {
            padding: 8px 12px;
            border-top: 1px solid rgba(255,255,255,0.05);
            font-size: 11px; color: rgba(255,255,255,0.5);
            display: flex; gap: 14px; flex-wrap: wrap;
        }
        .o2o-picker-foot kbd {
            background: rgba(255,255,255,0.08); padding: 1px 5px;
            border-radius: 3px; font-size: 10px;
            font-family: ui-monospace, "SF Mono", "Cascadia Mono", monospace;
            color: rgba(255,255,255,0.8);
        }

        .o2o-toast {
            position: fixed; bottom: 24px; right: 24px;
            background: rgba(32,32,34,0.85);
            backdrop-filter: blur(40px) saturate(200%);
            -webkit-backdrop-filter: blur(40px) saturate(200%);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.08);
            padding: 10px 16px; border-radius: 8px; font-size: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,.3);
            z-index: 100001; opacity: 0; transform: translateY(10px);
            transition: all .2s; max-width: 360px; word-break: break-all;
            font-family: "Segoe UI Variable", "Segoe UI", -apple-system, "Microsoft YaHei", sans-serif;
        }
        .o2o-toast.show { opacity: 1; transform: translateY(0); }
        .o2o-toast.error {
            background: rgba(80,30,30,0.85);
            border-color: rgba(255,100,100,0.2);
        }
        .o2o-toast.info {
            background: rgba(40,50,80,0.85);
            border-color: rgba(180,200,255,0.2);
        }

        .o2o-learn-cursor, .o2o-learn-cursor * { cursor: crosshair !important; }
        .o2o-learn-banner {
            position: fixed; top: 0; left: 0; right: 0;
            background: rgba(32,32,34,0.85);
            backdrop-filter: blur(40px) saturate(200%);
            -webkit-backdrop-filter: blur(40px) saturate(200%);
            color: #fff;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            text-align: center; padding: 10px;
            font-weight: 500; z-index: 100002; font-size: 13px;
            font-family: "Segoe UI Variable", "Segoe UI", -apple-system, "Microsoft YaHei", sans-serif;
        }
    `);

    function obsReq({ method, path, body }) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method, url: CONFIG.OBSIDIAN_HOST + path,
                headers: {
                    'Authorization': 'Bearer ' + CONFIG.API_KEY,
                    'Content-Type': 'text/markdown; charset=utf-8',
                },
                data: body,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        try { resolve(JSON.parse(res.responseText)); }
                        catch { resolve(res.responseText); }
                    } else reject(new Error(`HTTP ${res.status}: ${res.responseText || res.statusText}`));
                },
                onerror: (e) => reject(new Error('Network error: ' + (e.error || JSON.stringify(e)))),
                ontimeout: () => reject(new Error('Timeout')),
            });
        });
    }

    async function listAllFolders() {
        const folders = new Set();
        async function walk(prefix) {
            const res = await obsReq({ method: 'GET', path: '/vault/' + encodeURI(prefix) });
            const files = (res && res.files) || [];
            for (const f of files) {
                if (f.endsWith('/')) {
                    const sub = prefix + f;
                    folders.add(sub.replace(/\/$/, ''));
                    try { await walk(sub); } catch (e) {}
                }
            }
        }
        await walk('');
        return Array.from(folders);
    }

    async function writeNote(folderPath, filename, content) {
        const folder = folderPath ? folderPath.replace(/^\/|\/$/g, '') + '/' : '';
        const path = '/vault/' + encodeURI(folder + filename);
        await obsReq({ method: 'PUT', path, body: content });
        return folder + filename;
    }

    function polishWithAI(md) {
        return new Promise((resolve, reject) => {
            if (!CONFIG.POLISH.API_KEY) {
                reject(new Error('未配置 POLISH.API_KEY，请在脚本顶部填入'));
                return;
            }
            GM_xmlhttpRequest({
                method: 'POST',
                url: CONFIG.POLISH.ENDPOINT,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + CONFIG.POLISH.API_KEY,
                },
                data: JSON.stringify({
                    model: CONFIG.POLISH.MODEL,
                    temperature: CONFIG.POLISH.TEMPERATURE,
                    messages: [
                        { role: 'system', content: CONFIG.POLISH.SYSTEM_PROMPT },
                        { role: 'user', content: md },
                    ],
                }),
                timeout: 120000,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        try {
                            const json = JSON.parse(res.responseText);
                            const content = json.choices?.[0]?.message?.content;
                            if (content) resolve(content.trim());
                            else reject(new Error('AI 响应缺少 content'));
                        } catch (e) { reject(new Error('解析失败: ' + e.message)); }
                    } else {
                        reject(new Error(`HTTP ${res.status}: ${(res.responseText || '').slice(0, 200)}`));
                    }
                },
                onerror: () => reject(new Error('AI 网络错误')),
                ontimeout: () => reject(new Error('AI 超时（响应慢，换模型或减小内容）')),
            });
        });
    }

    function getRole(el) {
        if (SITE.name === 'chatgpt') {
            const r = el.getAttribute && el.getAttribute('data-message-author-role');
            if (r) return r;
        }
        if (SITE.name === 'gemini') {
            const tag = (el.tagName || '').toLowerCase();
            if (tag === 'user-query' || tag.includes('user-query')) return 'user';
            if (tag === 'model-response' || tag.includes('model-response')) return 'assistant';
            const cls = (el.className || '').toString();
            if (/user-query/i.test(cls)) return 'user';
            if (/model-response/i.test(cls)) return 'assistant';
        }
        if (el.matches && el.matches(getUserSel())) return 'user';
        if (el.matches && el.matches(getAsstSel())) return 'assistant';
        return 'unknown';
    }

    function markGridTables(rootEl) {
        try {
            const candidates = rootEl.querySelectorAll('div, section, article');
            candidates.forEach(el => {
                if (el.children.length < 4) return;
                const style = window.getComputedStyle(el);
                if (style.display !== 'grid') return;
                const tpl = style.gridTemplateColumns || '';
                const cols = tpl.split(' ').filter(s => s && s !== '0px' && s !== 'none').length;
                if (cols >= 2 && el.children.length >= cols) {
                    el.setAttribute('data-o2o-grid-cols', String(cols));
                }
            });
        } catch (e) {}
    }

    function cleanClone(node) {
        const clone = node.cloneNode(true);
        clone.querySelectorAll('.o2o-tb-btn, .o2o-sel-btn').forEach(n => n.remove());
        clone.querySelectorAll('button, [role="button"]').forEach(n => {
            if (!n.closest('pre, code, [data-o2o-grid-cols], table')) n.remove();
        });
        clone.querySelectorAll('[aria-label*="复制"], [aria-label*="Copy"]').forEach(n => {
            if (!n.closest('pre, code, [data-o2o-grid-cols], table')) n.remove();
        });
        clone.querySelectorAll('pre .sticky, pre [class*="sticky"]').forEach(n => n.remove());
        return clone;
    }

    function htmlToMd(rootEl) {
        markGridTables(rootEl);
        const cleaned = cleanClone(rootEl);
        return turndown.turndown(cleaned.innerHTML).trim();
    }

    function extractMessageMd(el) {
        let contentEl;
        if (SITE.name === 'gemini') {
            contentEl = el.querySelector('.markdown, message-content, .model-response-text, .query-text') ||
                        el.querySelector('[class*="response-content"], [class*="message-content"]') || el;
        } else {
            contentEl = el.querySelector('.markdown') ||
                        el.querySelector('[data-message-text]') ||
                        el.querySelector('.whitespace-pre-wrap') || el;
        }
        return htmlToMd(contentEl);
    }

    function buildNote({ md, role, sourceLabel, polished }) {
        const now = new Date();
        const iso = now.toISOString();
        const date = iso.slice(0, 10);
        const time = iso.slice(11, 16).replace(':', '');
        const firstLine = md.split('\n').find(l => l.trim().length > 0) || 'untitled';
        const title = firstLine.replace(/[#*`>\-\[\]()|]/g, '').slice(0, 24)
            .replace(/[\\/:*?"<>|]/g, '').trim() || 'untitled';
        const filename = `${SITE.label}-${date}-${time}-${title}.md`;
        const lines = [
            '---',
            'source: ' + SITE.name,
            'role: ' + role,
            'kind: ' + sourceLabel,
            polished ? 'polished: true' : null,
            'date: ' + iso,
            'url: ' + location.href,
            'tags: [' + SITE.name + ']',
            '---',
        ].filter(x => x !== null);
        return { filename, content: lines.join('\n') + '\n\n' + md + '\n' };
    }

    let currentPicker = null;
    let pickerKey, pickerOutside;
    function fuzzy(text, q) {
        let ti = 0, qi = 0, s = 0, run = 0;
        text = text.toLowerCase(); q = q.toLowerCase();
        while (ti < text.length && qi < q.length) {
            if (text[ti] === q[qi]) { s += 1 + run * 2; run++; qi++; }
            else run = 0;
            ti++;
        }
        return qi === q.length ? s : 0;
    }
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    function closePicker() {
        if (currentPicker) {
            currentPicker.remove();
            currentPicker = null;
            document.removeEventListener('keydown', pickerKey, true);
            document.removeEventListener('mousedown', pickerOutside, true);
        }
    }

    function showPicker({ folders, onPick }) {
        closePicker();
        const box = document.createElement('div');
        box.className = 'o2o-picker';
        setHTML(box, `
            <div class="o2o-picker-head">
                <input class="o2o-picker-input" placeholder="搜索全部 / 输入新名称…" />
            </div>
            <div class="o2o-picker-crumb"></div>
            <div class="o2o-picker-actions">
                <button class="o2o-picker-save"></button>
                <button class="o2o-polish-toggle" title="开启后，保存前先调 AI 润色排版"></button>
            </div>
            <div class="o2o-picker-list"></div>
            <div class="o2o-picker-foot">
                <span><kbd>↑↓</kbd> 选</span>
                <span><kbd>↵</kbd> 进入</span>
                <span><kbd>Ctrl+↵</kbd> 存这里</span>
                <span><kbd>←</kbd> 上层</span>
                <span><kbd>esc</kbd> 关</span>
            </div>
        `);
        document.body.appendChild(box);
        currentPicker = box;
        const input = box.querySelector('.o2o-picker-input');
        const crumbEl = box.querySelector('.o2o-picker-crumb');
        const saveBtn = box.querySelector('.o2o-picker-save');
        const polishBtn = box.querySelector('.o2o-polish-toggle');
        const list = box.querySelector('.o2o-picker-list');

        let currentPath = '';
        let filtered = [];
        let idx = 0;
        let searchMode = false;
        let polishOn = GM_getValue('polish_on', false);

        function syncPolishUI() {
            polishBtn.classList.toggle('on', polishOn);
            setHTML(polishBtn, polishOn ? '✨ 润色 <b style="margin-left:2px">ON</b>' : '✨ 润色');
        }
        syncPolishUI();
        polishBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            polishOn = !polishOn;
            syncPolishUI();
            GM_setValue('polish_on', polishOn);
        });

        function getChildren(path) {
            const prefix = path ? path + '/' : '';
            const set = new Set();
            folders.forEach(f => {
                if (path && !f.startsWith(prefix)) return;
                const rest = path ? f.slice(prefix.length) : f;
                if (!rest) return;
                const firstSeg = rest.split('/')[0];
                if (firstSeg) set.add(firstSeg);
            });
            return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh'));
        }
        function hasChildren(fullPath) {
            const prefix = fullPath + '/';
            return folders.some(f => f.startsWith(prefix));
        }
        const isRecent = (full) => recentFolders.includes(full);

        function renderCrumb() {
            const segs = currentPath ? currentPath.split('/') : [];
            const parts = [`<span class="o2o-crumb-seg ${!segs.length ? 'current' : ''}" data-path="">📂 根</span>`];
            let acc = '';
            segs.forEach((s, i) => {
                acc = acc ? acc + '/' + s : s;
                parts.push(`<span class="o2o-crumb-sep">/</span>`);
                parts.push(`<span class="o2o-crumb-seg ${i === segs.length - 1 ? 'current' : ''}" data-path="${esc(acc)}">${esc(s)}</span>`);
            });
            setHTML(crumbEl, parts.join(''));
        }
        function renderSaveBtn() {
            const target = currentPath || '(根目录)';
            setHTML(saveBtn, `<span>✓ 保存到</span><b>${esc(target)}</b>`);
        }

        function render() {
            const q = input.value.trim();
            searchMode = !!q;
            if (searchMode) {
                const all = folders.map(f => ({ name: f, full: f, recent: isRecent(f), search: true }));
                filtered = all.map(it => ({ it, s: fuzzy(it.name, q) }))
                    .filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.it);
            } else {
                const children = getChildren(currentPath);
                filtered = children.map(name => {
                    const full = currentPath ? currentPath + '/' + name : name;
                    return { name, full, recent: isRecent(full), hasChildren: hasChildren(full), search: false };
                });
                filtered.sort((a, b) => (b.recent ? 1 : 0) - (a.recent ? 1 : 0));
            }
            idx = 0;
            renderList();
        }
        function renderList() {
            if (filtered.length === 0) {
                const typed = input.value.trim().replace(/^\/|\/$/g, '');
                if (typed) {
                    const np = currentPath ? currentPath + '/' + typed : typed;
                    setHTML(list, `<div class="o2o-picker-empty">没找到 · 按 <kbd>Ctrl+↵</kbd> 保存到「${esc(np)}」</div>`);
                } else {
                    setHTML(list, `<div class="o2o-picker-empty">这个文件夹下没有子目录<br>按 <kbd>Ctrl+↵</kbd> 直接保存到「${esc(currentPath || '根')}」</div>`);
                }
                return;
            }
            setHTML(list, filtered.map((it, i) => {
                const showName = it.search ? it.full : it.name;
                const chev = (!it.search && it.hasChildren) ? '<span class="o2o-chev">›</span>' : '';
                return `
                    <div class="o2o-picker-item ${i === idx ? 'active' : ''}" data-i="${i}">
                        <span class="o2o-icon">📂</span>
                        <span class="o2o-text">${esc(showName)}</span>
                        ${it.recent ? '<span class="o2o-tag">最近</span>' : ''}
                        ${chev}
                    </div>
                `;
            }).join(''));
        }
        function update() {
            list.querySelectorAll('.o2o-picker-item').forEach((el, i) => {
                el.classList.toggle('active', i === idx);
                if (i === idx) el.scrollIntoView({ block: 'nearest' });
            });
        }
        function commit(f) { closePicker(); onPick(f, polishOn); }

        function enterItem(item) {
            if (!item) return;
            if (item.search) {
                commit(item.full);
                return;
            }
            if (item.hasChildren) {
                currentPath = item.full;
                input.value = '';
                renderCrumb();
                renderSaveBtn();
                render();
            } else {
                commit(item.full);
            }
        }
        function goUp() {
            if (!currentPath) return;
            const segs = currentPath.split('/');
            segs.pop();
            currentPath = segs.join('/');
            renderCrumb();
            renderSaveBtn();
            render();
        }

        pickerKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); closePicker(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, filtered.length - 1); update(); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); idx = Math.max(idx - 1, 0); update(); return; }
            if (e.key === 'ArrowLeft' && input.value === '' && !searchMode) {
                e.preventDefault(); goUp(); return;
            }
            if (e.key === 'Backspace' && input.value === '' && !searchMode) {
                e.preventDefault(); goUp(); return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const typed = input.value.trim().replace(/^\/|\/$/g, '');
                if (e.ctrlKey || e.metaKey) {
                    if (typed) {
                        const np = currentPath ? currentPath + '/' + typed : typed;
                        commit(np);
                    } else {
                        commit(currentPath);
                    }
                } else if (filtered.length > 0) {
                    enterItem(filtered[idx]);
                } else if (typed) {
                    const np = currentPath ? currentPath + '/' + typed : typed;
                    commit(np);
                }
            }
        };
        pickerOutside = (e) => {
            if (currentPicker && !currentPicker.contains(e.target)) closePicker();
        };
        input.addEventListener('input', render);
        document.addEventListener('keydown', pickerKey, true);
        setTimeout(() => document.addEventListener('mousedown', pickerOutside, true), 100);
        list.addEventListener('click', (e) => {
            const it = e.target.closest('.o2o-picker-item');
            if (it && it.dataset.i !== undefined) enterItem(filtered[+it.dataset.i]);
        });
        crumbEl.addEventListener('click', (e) => {
            const seg = e.target.closest('.o2o-crumb-seg');
            if (seg) {
                currentPath = seg.dataset.path || '';
                input.value = '';
                renderCrumb();
                renderSaveBtn();
                render();
            }
        });
        saveBtn.addEventListener('click', () => commit(currentPath));

        renderCrumb();
        renderSaveBtn();
        render();
        setTimeout(() => input.focus(), 30);
    }

    function toast(msg, type) {
        const t = document.createElement('div');
        t.className = 'o2o-toast' + (type ? ' ' + type : '');
        t.textContent = msg;
        document.body.appendChild(t);
        requestAnimationFrame(() => t.classList.add('show'));
        const hideAfter = type === 'info' ? 60000 : 2800;
        const timer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, hideAfter);
        return () => { clearTimeout(timer); t.classList.remove('show'); setTimeout(() => t.remove(), 250); };
    }

    async function clip({ md, role, sourceLabel, useDefault }) {
        if (!md || md.length === 0) { toast('内容为空', 'error'); return; }
        let folders;
        try { folders = await listAllFolders(); }
        catch (e) { toast('连不上 Obsidian：' + e.message, 'error'); return; }
        if (!folders.includes(CONFIG.DEFAULT_FOLDER)) folders.push(CONFIG.DEFAULT_FOLDER);

        const doWrite = async (folder, polishOn) => {
            let finalMd = md;
            if (polishOn) {
                const hideLoading = toast('AI 润色中…（最长 2 分钟）', 'info');
                try {
                    finalMd = await polishWithAI(md);
                    hideLoading();
                } catch (e) {
                    hideLoading();
                    toast('润色失败：' + e.message, 'error');
                    return;
                }
            }
            const { filename, content } = buildNote({ md: finalMd, role, sourceLabel, polished: polishOn });
            try {
                const path = await writeNote(folder, filename, content);
                pushRecent(folder);
                toast('✓ ' + path + (polishOn ? '  (已润色)' : ''));
            } catch (e) {
                toast('写入失败：' + e.message, 'error');
            }
        };
        if (useDefault) await doWrite(recentFolders[0] || CONFIG.DEFAULT_FOLDER, false);
        else showPicker({ folders, onPick: doWrite });
    }

    let selBtn = null;
    function hideSelBtn() { if (selBtn) { selBtn.remove(); selBtn = null; } }

    function selectionToMd(html) {
        const wrap = document.createElement('div');
        setHTML(wrap, html);
        return turndown.turndown(cleanClone(wrap).innerHTML).trim();
    }

    function showSelBtn(range, messageEl) {
        hideSelBtn();
        markGridTables(messageEl);
        const div = document.createElement('div');
        div.appendChild(range.cloneContents());
        const html = div.innerHTML;
        const role = getRole(messageEl);

        const rect = range.getBoundingClientRect();
        const btn = document.createElement('button');
        btn.className = 'o2o-sel-btn';
        setHTML(btn, ICON_SAVE + '<span>存到 Obsidian</span>');
        btn.title = '单击 = 选文件夹 · Shift+单击 = 直接存到上次的文件夹';
        btn.style.top = (window.scrollY + rect.top - 38) + 'px';
        btn.style.left = (window.scrollX + Math.max(rect.right - 130, rect.left)) + 'px';
        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            hideSelBtn();
            const md = selectionToMd(html);
            clip({ md, role, sourceLabel: 'selection', useDefault: e.shiftKey });
        });
        document.body.appendChild(btn);
        selBtn = btn;
    }

    document.addEventListener('mouseup', (e) => {
        if (e.target.closest('.o2o-sel-btn, .o2o-picker, .o2o-tb-btn')) return;
        setTimeout(() => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) { hideSelBtn(); return; }
            const text = sel.toString().trim();
            if (text.length < 2) { hideSelBtn(); return; }
            const range = sel.getRangeAt(0);
            const node = range.commonAncestorContainer;
            const startEl = node.nodeType === 1 ? node : node.parentElement;
            const messageEl = startEl && startEl.closest(`${getUserSel()}, ${getAsstSel()}`);
            if (!messageEl) { hideSelBtn(); return; }
            showSelBtn(range, messageEl);
        }, 10);
    });
    document.addEventListener('mousedown', (e) => {
        if (selBtn && !selBtn.contains(e.target)) hideSelBtn();
    });

    function findToolbar(msgEl) {
        let btn = msgEl.querySelector(
            '[data-testid*="copy" i], button[aria-label*="复制"], button[aria-label*="Copy" i], button[mattooltip*="复制"], button[mattooltip*="Copy" i]'
        );
        if (btn) return btn.parentElement;

        btn = msgEl.querySelector('[data-testid*="turn-action" i], [data-testid*="action-button" i]');
        if (btn) return btn.parentElement;

        const divs = msgEl.querySelectorAll('div');
        for (const d of divs) {
            const childBtns = [...d.children].filter(c =>
                c.tagName === 'BUTTON' ||
                (c.tagName === 'SPAN' && c.querySelector(':scope > button'))
            );
            if (childBtns.length < 2) continue;
            const withSvg = childBtns.filter(b => b.querySelector('svg, mat-icon'));
            if (withSvg.length >= 2) return d;
        }
        return null;
    }

    function attachToToolbar(msgEl) {
        const toolbar = findToolbar(msgEl);
        if (!toolbar) return false;
        if (toolbar.querySelector(':scope > .o2o-tb-btn')) return true;
        const btn = document.createElement('button');
        btn.className = 'o2o-tb-btn';
        setHTML(btn, ICON_SAVE);
        btn.title = '存到 Obsidian · Shift+单击 = 直接存到上次文件夹';
        btn.setAttribute('aria-label', '存到 Obsidian');
        btn.addEventListener('mousedown', e => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            const md = extractMessageMd(msgEl);
            clip({ md, role: getRole(msgEl), sourceLabel: 'message', useDefault: e.shiftKey });
        });
        toolbar.appendChild(btn);
        return true;
    }

    function mountButtons() {
        const sel = [getUserSel(), getAsstSel()].join(',');
        let els;
        try { els = document.querySelectorAll(sel); }
        catch (e) { return; }
        els.forEach(attachToToolbar);
    }

    let mountTimer = null;
    new MutationObserver(() => {
        clearTimeout(mountTimer);
        mountTimer = setTimeout(mountButtons, 250);
    }).observe(document.body, { childList: true, subtree: true });
    mountButtons();

    let activeMsg = null;
    function trackActive(e) {
        if (!e.target || !e.target.closest) return;
        const m = e.target.closest(`${getUserSel()}, ${getAsstSel()}`);
        if (m) activeMsg = m;
    }
    document.addEventListener('mouseover', trackActive, true);
    document.addEventListener('mousedown', trackActive, true);
    document.addEventListener('click', (e) => {
        if (!e.target || !e.target.closest) return;
        const trigger = e.target.closest(
            'button[aria-haspopup], button[aria-expanded], [data-state="closed"][aria-controls]'
        );
        if (trigger) {
            const m = trigger.closest(`${getUserSel()}, ${getAsstSel()}`);
            if (m) activeMsg = m;
        }
    }, true);

    function injectMenuItem(menu, msgEl) {
        if (!menu || !msgEl) return;
        if (menu.dataset.o2oInjected) return;
        const existing = menu.querySelectorAll('[role="menuitem"], button[mat-menu-item]').length;
        if (existing === 0) return;
        menu.dataset.o2oInjected = '1';
        const item = document.createElement('div');
        item.setAttribute('role', 'menuitem');
        item.setAttribute('tabindex', '-1');
        item.className = 'o2o-menu-item';
        setHTML(item, `${ICON_SAVE}<span>存到 Obsidian</span>`);
        item.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            const md = extractMessageMd(msgEl);
            clip({ md, role: getRole(msgEl), sourceLabel: 'message', useDefault: e.shiftKey });
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        menu.appendChild(item);
    }

    const MENU_SEL = '[role="menu"], [data-radix-menu-content], [data-headlessui-state], .mat-mdc-menu-content, .mat-menu-content';
    new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.matches?.(MENU_SEL)) injectMenuItem(n, activeMsg);
                n.querySelectorAll?.(MENU_SEL).forEach(menu => injectMenuItem(menu, activeMsg));
                n.querySelectorAll?.('[role="menuitem"], button[mat-menu-item]').forEach(mi => {
                    const parent = mi.parentElement;
                    if (parent && !parent.dataset.o2oInjected) {
                        injectMenuItem(parent, activeMsg);
                    }
                });
            }
        }
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('keydown', (e) => {
        if (!(e.altKey && (e.key === 's' || e.key === 'S'))) return;
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim().length >= 2) {
            const range = sel.getRangeAt(0);
            const node = range.commonAncestorContainer;
            const startEl = node.nodeType === 1 ? node : node.parentElement;
            const messageEl = startEl && startEl.closest(`${getUserSel()}, ${getAsstSel()}`);
            if (messageEl) {
                e.preventDefault();
                markGridTables(messageEl);
                const div = document.createElement('div');
                div.appendChild(range.cloneContents());
                const md = selectionToMd(div.innerHTML);
                clip({
                    md, role: getRole(messageEl), sourceLabel: 'selection',
                    useDefault: e.shiftKey,
                });
                hideSelBtn();
                return;
            }
        }
        const hovered = document.querySelectorAll(`${getUserSel()}:hover, ${getAsstSel()}:hover`);
        const msgEl = hovered[hovered.length - 1];
        if (msgEl) {
            e.preventDefault();
            const md = extractMessageMd(msgEl);
            clip({
                md, role: getRole(msgEl), sourceLabel: 'message',
                useDefault: e.shiftKey,
            });
        }
    });

    let learnState = null, learnBuf = {};
    function startLearn() {
        learnState = 'user'; learnBuf = {};
        document.body.classList.add('o2o-learn-cursor');
        const b = document.createElement('div');
        b.className = 'o2o-learn-banner'; b.id = 'o2o-learn-banner';
        b.textContent = '【学习模式】点击一条「你的消息」 · Esc/Alt+L 退出';
        document.body.appendChild(b);
    }
    function stopLearn() {
        learnState = null;
        document.body.classList.remove('o2o-learn-cursor');
        const b = document.getElementById('o2o-learn-banner'); if (b) b.remove();
    }
    function buildLearnSel(el) {
        let cur = el;
        for (let i = 0; i < 5 && cur && cur !== document.body; i++) {
            const attrs = [...cur.attributes].filter(a => a.name.startsWith('data-') && a.value);
            if (attrs.length) return `[${attrs[0].name}="${CSS.escape(attrs[0].value)}"]`;
            cur = cur.parentElement;
        }
        return el.tagName.toLowerCase();
    }
    document.addEventListener('click', (e) => {
        if (!learnState) return;
        if (e.target.closest('.o2o-tb-btn, .o2o-sel-btn, .o2o-picker, .o2o-learn-banner')) return;
        e.preventDefault(); e.stopPropagation();
        const s = buildLearnSel(e.target);
        if (learnState === 'user') {
            learnBuf.user = s; learnState = 'assistant';
            document.getElementById('o2o-learn-banner').textContent =
                `user 已记录: ${s} · 现在点一条「AI 回复」`;
        } else {
            learnBuf.assistant = s;
            learnedSelectors = learnBuf;
            GM_setValue('learned_selectors_' + SITE.name, learnedSelectors);
            stopLearn();
            toast('选择器已更新 (' + SITE.label + ')');
            document.querySelectorAll('.o2o-tb-btn').forEach(b => b.remove());
            mountButtons();
        }
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.altKey && (e.key === 'l' || e.key === 'L')) {
            e.preventDefault();
            learnState ? stopLearn() : startLearn();
        } else if (e.key === 'Escape' && learnState) {
            e.preventDefault(); stopLearn();
        }
    });
})();
