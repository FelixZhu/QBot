// packages/cli/src/commands/config.ts
import chalk from 'chalk';
import { VaultManager } from '@qbot/core';

export async function configCommand(action: string, args: string[]): Promise<void> {
  const vaultPath = process.env.QBOT_VAULT_PATH ?? '.qbot-vault';
  const vault = new VaultManager(vaultPath);

  switch (action) {
    case 'show':
      const prefs = await vault.reader.readConfig<any>('config/preferences.md');
      if (prefs) {
        console.log(JSON.stringify(prefs, null, 2));
      } else {
        console.log(chalk.yellow('No preferences found'));
      }
      break;

    case 'keys':
      const keys = await vault.reader.readConfig<any>('config/api-keys.md');
      if (keys) {
        // Mask API keys
        const masked = Object.fromEntries(
          Object.entries(keys).map(([k, v]) => {
            if (k === 'version' || k === 'updated') return [k, v];
            const cfg = v as any;
            return [k, { ...(cfg || {}), api_key: cfg?.api_key ? `${cfg.api_key.substring(0, 8)}...` : '(not set)' }];
          })
        );
        console.log(JSON.stringify(masked, null, 2));
      } else {
        console.log(chalk.yellow('No API keys found'));
      }
      break;

    default:
      console.log(chalk.gray('Usage: qbot config <show|keys>'));
  }
}
