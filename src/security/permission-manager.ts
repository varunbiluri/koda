import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import chalk from 'chalk';
import prompts from 'prompts';

export type RiskLevel = 'safe' | 'medium' | 'high';

interface PermissionsFile {
  approvedCommands: string[];
}

const PERMISSIONS_PATH = path.join(os.homedir(), '.koda', 'permissions.json');

// Commands that never need approval
const SAFE_PATTERNS: RegExp[] = [
  /^ls(\s|$)/,
  /^cat\s/,
  /^head\s/,
  /^tail\s/,
  /^find\s/,
  /^echo(\s|$)/,
  /^grep\s/,
  /^rg\s/,
  /^which\s/,
  /^pwd$/,
  /^env$/,
  /^git\s+(status|diff|log|branch|show|remote\s+-v|describe)(\s|$)/,
];

// Commands that are destructive or affect shared state
const HIGH_RISK_PATTERNS: RegExp[] = [
  /^rm(\s|$)/,
  /^rmdir\s/,
  /^mv\s/,
  /^git\s+(push|reset|rebase|clean)(\s|$)/,
  /^docker\s/,
  /^chmod\s/,
  /^chown\s/,
  /^sudo\s/,
  /^dd\s/,
  /^mkfs\s/,
];

/**
 * PermissionManager — classifies command risk and gates execution behind user approval.
 *
 * Risk levels:
 *   safe   — read-only operations, never prompts
 *   medium — build/test/install commands, prompts once (or is remembered)
 *   high   — destructive/irreversible commands, always prompts unless remembered
 *
 * Set KODA_SKIP_PERMISSIONS=true to bypass all prompts (useful in CI / tests).
 */
export class PermissionManager {
  static classifyRisk(command: string): RiskLevel {
    const cmd = command.trim();

    for (const pattern of SAFE_PATTERNS) {
      if (pattern.test(cmd)) return 'safe';
    }
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(cmd)) return 'high';
    }
    return 'medium';
  }

  static async loadApproved(): Promise<string[]> {
    try {
      const content = await fs.readFile(PERMISSIONS_PATH, 'utf-8');
      const data = JSON.parse(content) as PermissionsFile;
      return Array.isArray(data.approvedCommands) ? data.approvedCommands : [];
    } catch {
      return [];
    }
  }

  static async persistApproval(command: string): Promise<void> {
    const approved = await this.loadApproved();
    if (!approved.includes(command)) {
      approved.push(command);
      await fs.mkdir(path.dirname(PERMISSIONS_PATH), { recursive: true });
      await fs.writeFile(
        PERMISSIONS_PATH,
        JSON.stringify({ approvedCommands: approved }, null, 2),
        'utf-8',
      );
    }
  }

  /**
   * Ask the user to approve a command before it runs.
   * Returns true if the command should proceed, false to cancel.
   *
   * Skip conditions (no prompt shown):
   *  - KODA_SKIP_PERMISSIONS=true env var
   *  - risk level is 'safe'
   *  - command was previously remembered
   */
  static async check(command: string): Promise<boolean> {
    if (process.env.KODA_SKIP_PERMISSIONS === 'true') return true;

    const risk = this.classifyRisk(command);
    if (risk === 'safe') return true;

    const approved = await this.loadApproved();
    if (approved.includes(command.trim())) return true;

    console.log();
    console.log(
      '  ' + chalk.yellow('⚠') + '  ' + chalk.bold('Command requires approval'),
    );
    console.log();
    console.log('  ' + chalk.white(command.trim()));
    console.log();

    const { choice } = await prompts({
      type: 'select',
      name: 'choice',
      message: 'Do you want to proceed?',
      choices: [
        { title: 'Yes', value: 'yes' },
        { title: 'Yes, and remember this command', value: 'remember' },
        { title: 'No', value: 'no' },
      ],
    });

    if (!choice || choice === 'no') return false;

    if (choice === 'remember') {
      await this.persistApproval(command.trim());
    }

    return true;
  }
}
