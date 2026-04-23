# QBot Assistant

Super Personal Assistant - A multi-platform AI assistant with local-first Markdown storage.

## Quick Start

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Initialize a vault
cd packages/cli
node dist/index.js init

# Add your API key to .qbot-vault/config/api-keys.md

# Start chatting
node dist/index.js chat
```

## Commands

- `qbot init [path]` - Initialize a new vault
- `qbot chat [--model M] [--provider P]` - Start chat session
- `qbot config <show|keys>` - View configuration

## Architecture

- `packages/core` - Shared business logic
  - AI Providers (OpenRouter, OpenAI, Anthropic, DeepSeek)
  - Vault Manager (Markdown file I/O)
  - Conversation Manager
- `packages/cli` - Command line interface

## Vault Structure

```
.qbot-vault/
├── config/
│   ├── api-keys.md      # API keys
│   └── preferences.md   # User preferences
├── conversations/       # Chat history
├── knowledge/           # Knowledge base
└── research/            # Deep research results
```

## License

MIT
