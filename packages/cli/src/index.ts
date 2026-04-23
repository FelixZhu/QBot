import { initCommand } from './commands/init.js';
import { chatCommand } from './commands/chat.js';
import { configCommand } from './commands/config.js';

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'init':
    await initCommand(args[1]);
    break;

  case 'chat':
    await chatCommand({
      model: extractArg(args, '--model'),
      provider: extractArg(args, '--provider'),
      newChat: args.includes('--new')
    });
    break;

  case 'config':
    await configCommand(args[1] || 'show', args.slice(2));
    break;

  default:
    if (!command || command === 'help' || command === '--help') {
      showHelp();
    } else {
      console.log(`Unknown command: ${command}`);
      showHelp();
    }
}

function showHelp() {
  console.log(`
QBot Assistant - Super Personal Assistant

Commands:
  init [path]              Initialize a new vault
  chat [--model M] [--provider P] [--new]  Start chat session
  config <show|keys>       View configuration

Examples:
  qbot init                Initialize vault in current directory
  qbot chat                Start chatting
  qbot chat --model gpt-4  Use specific model
  qbot config keys         Show configured API keys (masked)
`);
}

function extractArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx < args.length - 1 ? args[idx + 1] : undefined;
}
