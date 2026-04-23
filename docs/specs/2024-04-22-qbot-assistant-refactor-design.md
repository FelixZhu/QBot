# QBot Assistant - 项目重构设计文档

## 项目概述

将现有的 QBot 浏览器插件项目重构为一个**超级个人助理**项目，支持多平台运行，以 Markdown Vault 作为统一数据存储层。

---

## 核心理念

```
┌─────────────────────────────────────────────────────────────┐
│                      QBot Assistant                          │
│                    超级个人助理项目                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │   Web    │  │ Desktop  │  │   CLI    │  │ Android  │    │
│  │ Next.js  │  │ Electron │  │ Terminal │  │  (未来)   │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       │             │             │             │           │
│       │    ┌────────┴────────┐    │             │           │
│       │    │  API 调用方式   │    │             │           │
│       │    ├─────────────────┤    │             │           │
│       │    │ Web: CORS 代理   │    │             │           │
│       │    │ Desktop: 直连   │    │             │           │
│       │    │ CLI: 直连       │    │             │           │
│       │    └────────┬────────┘    │             │           │
│       │             │             │             │           │
│       └─────────────┴──────┬──────┴─────────────┘           │
│                            ▼                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              @qbot/core (共享核心)                    │   │
│  │  • AI Providers (OpenAI, Claude, DeepSeek...)       │   │
│  │  • Deep Research                                     │   │
│  │  • Speech (STT/TTS)                                  │   │
│  │  • Vault Manager (MD 文件读写)                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              QBot Vault (Markdown 存储)              │   │
│  │                                                      │   │
│  │  config/          conversations/      knowledge/     │   │
│  │  ├── api-keys.md  ├── 2024-01-*.md    ├── notes/    │   │
│  │  └── settings.md  └── ...             └── ...       │   │
│  │                                                      │   │
│  │  research/         templates/         sync/          │   │
│  │  ├── reports/      └── prompts.md     └── .state    │   │
│  │  └── ...                                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              云同步服务 (阿里云 OSS)                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 设计决策

### 1. 多平台支持

| 平台 | 技术方案 | 优先级 | API 调用方式 |
|------|---------|--------|-------------|
| 网页版 | Next.js + React | P0 | CORS 代理 |
| 桌面应用 | Electron + React | P0 | 主进程直连 |
| 命令行工具 | Node.js + TypeScript | P1 | 直连 |
| 浏览器插件 | WXT + React | P2 (延后) | 待定 |
| Android | 待定 | P3 | 待定 |

### 2. API 调用架构

**核心问题：CORS 跨域限制**

| 环境 | 运行时 | CORS 限制 | 能否直连 AI API |
|------|--------|----------|----------------|
| **Electron 主进程** | Node.js | 无限制 | 可以直接调用 |
| **Electron 渲染进程** | Chromium | 有 CORS | 通过主进程 IPC 代理 |
| **网页版 (浏览器)** | 浏览器 | 有 CORS | 需要代理服务 |
| **CLI** | Node.js | 无限制 | 可以直接调用 |

**解决方案：**

```
┌─────────────────────────────────────────────────────────────┐
│                      API 调用架构                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Electron 应用                                               │
│  ┌─────────────────┐    IPC     ┌────────────┐             │
│  │   渲染进程       │ ────────→ │   主进程    │ ──→ AI API  │
│  │   (React UI)    │           │  (Node.js)  │             │
│  └─────────────────┘           └────────────┘             │
│                                                             │
│  网页版 (Next.js)                                            │
│  ┌─────────────────┐  HTTP   ┌────────────┐               │
│  │   浏览器前端     │ ──────→ │ API Routes │ ──→ AI API    │
│  │   (React)       │         │ (代理层)    │               │
│  └─────────────────┘         └────────────┘               │
│                                                             │
│  CLI 工具                                                    │
│  ┌─────────────────┐                                       │
│  │   Node.js 运行时 │ ──────────────────────→ AI API        │
│  └─────────────────┘                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. 代码共享架构

**方案：Monorepo + 共享核心包**

```
packages/
├── core/        # 共享业务逻辑 (Node.js 环境)
├── ui/          # 共享 React 组件
├── web/         # 网页版 (Next.js)
├── desktop/     # Electron 应用
├── cli/         # 命令行工具
└── browser-ext/ # 浏览器插件 (P2 延后)
```

### 4. 构建系统

| 工具 | 用途 |
|------|------|
| pnpm workspaces | Monorepo 包管理 |
| Next.js | 网页版 (前端 + API Routes 代理) |
| electron-vite | Electron 应用构建 |
| tsup | 核心库/CLI 打包 |
| WXT | 浏览器插件 (后续) |

### 5. UI 框架

**选择：React 18 + TypeScript**

### 6. 数据存储

**方案：Markdown Vault (类似 Obsidian)**

所有数据以 Markdown 文件形式存储在本地 Vault 目录：

```
qbot-vault/
├── config/
│   ├── api-keys.md        # API 密钥配置 (机器优先)
│   └── preferences.md     # 用户偏好配置 (机器优先)
├── conversations/
│   ├── index.md           # 对话索引
│   └── 2024-01-15-*.md    # 对话记录
├── knowledge/
│   └── ...                # 用户笔记/知识库
├── research/
│   └── ...                # Deep Research 结果
└── templates/
    └── prompts.md         # 提示词模板
```

**设计原则：**
- 配置文件**机器优先**，用户通过对话让 AI 帮忙修改
- 用户不需要人工查看或编辑这些文件
- 文件格式使用 YAML 代码块，便于机器解析

### 7. 同步方案

**方案：独立账号体系 + 云端镜像 + 本地 Vault**

```
┌─────────────────────────────────────────────────────────────┐
│                      数据同步架构                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   用户账号系统                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  注册/登录 → 获得云端存储空间                           │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                 │
│                           ▼                                 │
│  ┌──────────────────┐              ┌──────────────────┐    │
│  │ 本地 Vault (主)   │              │ 云端 Vault (镜像) │    │
│  │ config/          │   双向同步    │ config/          │    │
│  │  ├── api-keys.md │ ←─────────→ │  ├── api-keys.md │    │
│  │  └── preferences │              │  └── preferences │    │
│  │ conversations/   │              │ conversations/   │    │
│  │ knowledge/       │              │ knowledge/       │    │
│  └────────┬─────────┘              └────────┬─────────┘    │
│           │                                 │              │
│           ▼                                 ▼              │
│    ┌──────────────┐                  ┌──────────────┐      │
│    │Desktop / CLI │                  │    Web 版    │      │
│    │  (直连本地)   │                  │  (登录访问)  │      │
│    └──────────────┘                  └──────────────┘      │
│                                              │              │
│                                              ▼              │
│                                    ┌──────────────────┐    │
│                                    │   按需加载策略    │    │
│                                    │                  │    │
│                                    │  启动时加载:      │    │
│                                    │  - config/*.md   │    │
│                                    │                  │    │
│                                    │  按需加载:        │    │
│                                    │  - conversations │    │
│                                    │  - research      │    │
│                                    │  - knowledge     │    │
│                                    └──────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**核心原则：**
- Vault 绑定本地，用户拥有完全控制权
- 云端作为镜像，支持 Web 端访问和多设备同步
- 独立账号体系，支持注册/登录
- 后续复杂后端可用 Python 重写

**Web 版按需加载策略：**

| 数据类型 | 加载时机 | 原因 |
|---------|---------|------|
| `config/api-keys.md` | 启动时 | 需要知道用户的 API 配置 |
| `config/preferences.md` | 启动时 | 需要知道用户偏好 |
| `conversations/index.md` | 启动时 | 对话列表（仅索引） |
| `conversations/*.md` | 打开对话时 | 按需加载内容 |
| `research/*.md` | 打开研究时 | 按需加载 |
| `knowledge/*` | 搜索/浏览时 | 按需加载 |

### 8. AI Provider 支持

| Provider | 特点 | 模型格式示例 |
|----------|------|-------------|
| **openrouter** | 聚合平台，一个 key 访问多模型 | `anthropic/claude-3.5-sonnet` |
| openai | 官方 API | `gpt-4` |
| anthropic | 官方 API | `claude-3-sonnet` |
| deepseek | 官方 API，便宜 | `deepseek-chat` |

**推荐默认使用 OpenRouter**，一个 API Key 即可访问多个模型。

---

## 项目目录结构

```
qbot-assistant/
├── packages/
│   ├── core/                          # 共享核心逻辑
│   │   ├── src/
│   │   │   ├── ai/                    # AI 提供者
│   │   │   │   ├── providers/
│   │   │   │   │   ├── openai.ts
│   │   │   │   │   ├── anthropic.ts
│   │   │   │   │   ├── deepseek.ts
│   │   │   │   │   └── index.ts
│   │   │   │   ├── types.ts           # 统一接口定义
│   │   │   │   └── client.ts          # API 调用封装
│   │   │   │
│   │   │   ├── vault/                 # Vault 管理 (核心!)
│   │   │   │   ├── manager.ts         # Vault 路径管理
│   │   │   │   ├── reader.ts          # MD 文件解析
│   │   │   │   ├── writer.ts          # MD 文件写入
│   │   │   │   ├── watcher.ts         # 文件变更监听
│   │   │   │   └── schema/            # MD 文件格式定义
│   │   │   │       ├── conversation.ts
│   │   │   │       ├── config.ts
│   │   │   │       └── research.ts
│   │   │   │
│   │   │   ├── research/              # Deep Research
│   │   │   │   ├── engine.ts
│   │   │   │   ├── search.ts
│   │   │   │   └── report.ts
│   │   │   │
│   │   │   ├── speech/                # 语音处理
│   │   │   │   ├── stt.ts             # Speech-to-Text
│   │   │   │   └── tts.ts             # Text-to-Speech
│   │   │   │
│   │   │   └── utils/                 # 工具函数
│   │   │       ├── markdown.ts
│   │   │       └── crypto.ts
│   │   │
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── ui/                            # 共享 React 组件
│   │   ├── src/
│   │   │   ├── chat/                  # 对话界面
│   │   │   │   ├── ChatView.tsx
│   │   │   │   ├── MessageList.tsx
│   │   │   │   └── InputArea.tsx
│   │   │   │
│   │   │   ├── settings/              # 设置界面
│   │   │   │   ├── BYOKConfig.tsx     # API Key 配置
│   │   │   │   ├── VaultSettings.tsx  # Vault 路径设置
│   │   │   │   └── ModelSelector.tsx
│   │   │   │
│   │   │   ├── research/              # Deep Research UI
│   │   │   │   └── ResearchView.tsx
│   │   │   │
│   │   │   └── common/                # 通用组件
│   │   │       ├── Button.tsx
│   │   │       ├── Input.tsx
│   │   │       └── Layout.tsx
│   │   │
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                           # 网页版 (Next.js)
│   │   ├── app/
│   │   │   ├── page.tsx               # 首页
│   │   │   ├── chat/                  # 对话页面
│   │   │   │   └── page.tsx
│   │   │   ├── settings/              # 设置页面
│   │   │   │   └── page.tsx
│   │   │   ├── research/              # Deep Research 页面
│   │   │   │   └── page.tsx
│   │   │   └── api/                   # API Routes (CORS 代理)
│   │   │       ├── chat/
│   │   │       │   └── route.ts       # 对话 API 代理
│   │   │       ├── research/
│   │   │       │   └── route.ts       # Research API 代理
│   │   │       └── providers/
│   │   │           └── route.ts       # 获取可用模型列表
│   │   │
│   │   ├── components/                # Web 专用组件
│   │   │   └── ...
│   │   │
│   │   ├── lib/                       # Web 专用工具
│   │   │   └── vault-client.ts        # Vault API 客户端
│   │   │
│   │   ├── public/
│   │   │   └── ...
│   │   │
│   │   ├── next.config.js
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── desktop/                       # Electron 桌面应用
│   │   ├── src/
│   │   │   ├── main/                  # 主进程 (Node.js, 无 CORS)
│   │   │   │   ├── index.ts
│   │   │   │   ├── vault.ts           # Vault 文件系统访问
│   │   │   │   ├── ipc.ts             # IPC 通信
│   │   │   │   └── ai-proxy.ts        # AI API 代理 (供渲染进程调用)
│   │   │   │
│   │   │   ├── preload/               # 预加载脚本
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   └── renderer/              # 渲染进程 (UI)
│   │   │       ├── index.html
│   │   │       └── main.tsx
│   │   │
│   │   ├── resources/                 # 应用资源
│   │   │   └── icon.icns
│   │   │
│   │   ├── electron.vite.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/                           # 命令行工具
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── chat.ts            # qbot chat
│   │   │   │   ├── research.ts        # qbot research
│   │   │   │   └── config.ts          # qbot config
│   │   │   │
│   │   │   ├── tui/                   # 终端 UI (可选, 使用 Ink)
│   │   │   │   └── ChatUI.tsx
│   │   │   │
│   │   │   └── index.ts
│   │   │
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── browser-ext/                   # 浏览器插件 (P2 延后)
│       └── ...                        # 后续设计
│
├── vault-template/                    # Vault 模板
│   ├── config/
│   │   ├── api-keys.md.template
│   │   └── settings.md.template
│   ├── conversations/
│   │   └── .gitkeep
│   ├── knowledge/
│   │   └── .gitkeep
│   └── research/
│       └── .gitkeep
│
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── README.md
```

---

## 各平台特点对比

| 特性 | Web (Next.js) | Desktop (Electron) | CLI |
|------|--------------|-------------------|-----|
| **部署** | Vercel/静态托管 | 安装包分发 | npm/binary |
| **离线使用** | 需要网络 | 可离线 | 可离线 |
| **API 调用** | 需 CORS 代理 | 主进程直连 | 直连 |
| **Vault 访问** | 通过 API/云同步 | 本地文件系统 | 本地文件系统 |
| **用户系统** | 可选 | 可选 | 本地配置 |
| **分发渠道** | URL 访问 | 应用商店/官网 | npm/包管理器 |

---

## Vault 文件格式规范

### config/api-keys.md

API 密钥配置，**机器优先设计**，用户通过对话让 AI 帮忙修改。

```markdown
```yaml
version: "1.0"
updated: "2024-04-22T10:30:00Z"

openrouter:
  api_key: sk-or-xxx
  base_url: https://openrouter.ai/api/v1
  models:
    - anthropic/claude-3.5-sonnet
    - anthropic/claude-3-opus
    - openai/gpt-4
    - openai/gpt-4-turbo
    - google/gemini-pro-1.5
    - meta-llama/llama-3.1-405b-instruct

openai:
  api_key: sk-xxx
  base_url: https://api.openai.com/v1

anthropic:
  api_key: sk-ant-xxx

deepseek:
  api_key: sk-xxx
  base_url: https://api.deepseek.com/v1
```
```

### config/preferences.md

用户偏好配置，**机器优先设计**，用户通过对话修改，不需要人工查看。

```markdown
```yaml
version: "1.0"
updated: "2024-04-22T10:30:00Z"

# AI 模型
default_provider: openrouter
default_model: anthropic/claude-3.5-sonnet
streaming: true

providers:
  openrouter:
    enabled: true
    default: anthropic/claude-3.5-sonnet
  openai:
    enabled: true
    default: gpt-4
  anthropic:
    enabled: true
    default: claude-3-sonnet
  deepseek:
    enabled: true
    default: deepseek-chat

# 界面
theme: dark
language: zh-CN

# 同步
sync_enabled: true
auto_sync: true

# 语音
stt_provider: openai-whisper
tts_provider: openai-tts
voice: alloy

# Research
research_max_sources: 10
```

---

## 用户自定义规则

- 回复简洁
- 优先中文
```

### conversations/YYYY-MM-DD-title.md

```markdown
# Conversation Title

## Metadata
- id: conv-abc123
- created: 2024-01-15T09:00:00Z
- model: gpt-4
- provider: openai

## Messages

### user
用户消息内容...

### assistant
助手回复内容...

### user
继续对话...

### assistant
继续回复...

---
## Summary
对话摘要...
```

---

## 技术栈总结

| 层级 | 技术选型 |
|------|---------|
| **Monorepo** | pnpm workspaces |
| **UI 框架** | React 18 + TypeScript |
| **网页版** | Next.js (前端 + API Routes 代理) |
| **桌面应用** | Electron + electron-vite |
| **CLI 工具** | Node.js + tsup (可选 Ink) |
| **浏览器插件** | WXT (后续) |
| **数据存储** | Markdown 文件 |
| **同步方案** | 阿里云 OSS (后续开发) |
| **AI 调用** | Web 通过代理, Desktop/CLI 直连 |

---

## 核心功能

### Phase 1: 基础架构
- [ ] Monorepo 项目初始化
- [ ] 共享核心包 (@qbot/core)
- [ ] 共享 UI 组件库 (@qbot/ui)
- [ ] Vault Manager 实现

### Phase 2: AI 对话
- [ ] BYOK 配置管理
- [ ] 多 AI 提供者支持 (OpenAI, Claude, DeepSeek)
- [ ] 对话界面实现
- [ ] 对话历史存储 (MD 文件)

### Phase 3: 多平台
- [ ] 网页版 (Next.js + API Routes 代理)
- [ ] Electron 桌面应用
- [ ] CLI 工具

### Phase 4: 高级功能
- [ ] Deep Research
- [ ] 语音对话 (STT/TTS)
- [ ] 云同步 (阿里云 OSS)

### Phase 5: 浏览器插件 (后续)
- [ ] 浏览器插件 (WXT)

---

## 迁移计划

现有 `browser_plugin/` 目录下的功能将逐步迁移：

1. **保留**：视频/音频下载功能（可选保留或移除）
2. **保留**：PDF 截图功能（可选保留或移除）
3. **移除/重构**：重写为新的 monorepo 结构

---

*Created: 2024-04-22*
*Updated: 2024-04-22 - 添加网页版 (Next.js)，调整优先级*
