// packages/cli/src/commands/init.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { VaultManager } from '@qbot/core';

const DEFAULT_API_KEYS = `---
version: "1.0"
updated: "${new Date().toISOString()}"

openrouter:
  api_key: ""
  base_url: https://openrouter.ai/api/v1
  models:
    - anthropic/claude-3.5-sonnet
    - anthropic/claude-3-opus
    - openai/gpt-4
    - google/gemini-pro-1.5

openai:
  api_key: ""
  base_url: https://api.openai.com/v1

anthropic:
  api_key: ""

deepseek:
  api_key: ""
  base_url: https://api.deepseek.com/v1
`;

const DEFAULT_PREFERENCES = `---
version: "1.0"
updated: "${new Date().toISOString()}"

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

theme: dark
language: zh-CN

sync_enabled: false
auto_sync: false

stt_provider: openai-whisper
tts_provider: openai-tts
voice: alloy

research_max_sources: 10
`;

export async function initCommand(vaultPath?: string): Promise<void> {
  const resolvedPath = vaultPath ?? path.join(process.cwd(), '.qbot-vault');
  const vault = new VaultManager(resolvedPath);

  console.log(`Initializing QBot vault at: ${resolvedPath}`);

  await vault.init();

  // Write default config files
  await vault.writer.writeFile('config/api-keys.md', DEFAULT_API_KEYS);
  await vault.writer.writeFile('config/preferences.md', DEFAULT_PREFERENCES);

  console.log('Vault initialized!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Edit config/api-keys.md to add your API keys');
  console.log('  2. Run: qbot chat');
}
