// packages/cli/src/commands/chat.ts
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import { VaultManager, AIClient, ConversationManager } from '@qbot/core';
import type { ChatMessage } from '@qbot/core';

interface ChatOptions {
  vaultPath?: string;
  model?: string;
  provider?: string;
  newChat?: boolean;
}

export async function chatCommand(options: ChatOptions = {}): Promise<void> {
  const vaultPath = options.vaultPath ?? findVaultPath();
  if (!vaultPath) {
    console.error(chalk.red('No vault found. Run "qbot init" first.'));
    process.exit(1);
  }

  const vault = new VaultManager(vaultPath);
  const aiClient = new AIClient(vault);
  const convManager = new ConversationManager(vault);

  // Initialize AI client from vault config
  await aiClient.initFromVault();

  console.log(chalk.cyan.bold('  QBot Assistant  ') + chalk.gray('(type /quit to exit)\n'));

  // Start or resume conversation
  let conv;
  const existingConvs = await convManager.listAll();

  if (options.newChat || existingConvs.length === 0) {
    conv = await convManager.create('New Chat', options.model ?? 'gpt-4', options.provider ?? 'openai');
    console.log(chalk.gray('Started new conversation'));
  } else {
    conv = await convManager.load(existingConvs[0].id.replace('conv-', '').split('-').slice(0, 3).join('-') + '.md');
    if (!conv) {
      conv = await convManager.create('New Chat', options.model ?? 'gpt-4', options.provider ?? 'openai');
    } else {
      console.log(chalk.gray(`Resumed: ${conv.meta.title}`));
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('You: ')
  });

  const messages: ChatMessage[] = [...conv.messages];

  rl.prompt();

  rl.on('line', async (input) => {
    const trimmed = input.trim();

    if (trimmed === '/quit') {
      console.log(chalk.gray('Goodbye!'));
      rl.close();
      return;
    }

    if (trimmed === '/clear') {
      messages.length = 0;
      console.log(chalk.gray('Context cleared'));
      rl.prompt();
      return;
    }

    if (!trimmed) {
      rl.prompt();
      return;
    }

    // Add user message
    messages.push({ role: 'user', content: trimmed });

    try {
      // Show typing indicator
      process.stdout.write(chalk.cyan('Assistant: '));

      const result = await aiClient.chat({
        provider: options.provider as any,
        model: options.model,
        messages,
        stream: true,
        onChunk: (chunk) => {
          process.stdout.write(chunk);
        }
      });

      process.stdout.write('\n\n');

      // Add assistant response
      messages.push({ role: 'assistant', content: result.content });

      // Save to vault
      const files = await vault.reader.listFiles('conversations');
      const latestFile = files.find(f => f.includes(conv!.meta.id)) ||
                           files[files.length - 1];
      if (latestFile) {
        await convManager.addMessage(latestFile, { role: 'user', content: trimmed });
        await convManager.addMessage(latestFile, { role: 'assistant', content: result.content });
      }
    } catch (error) {
      console.log(chalk.red(`\nError: ${(error as Error).message}`));
    }

    rl.prompt();
  });
}

function findVaultPath(): string | null {
  // Search upward from cwd for .qbot-vault directory
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, '.qbot-vault');
    try {
      const stats = fs.statSync(candidate);
      if (stats.isDirectory()) return candidate;
    } catch {}
    dir = path.dirname(dir);
  }
  return null;
}
