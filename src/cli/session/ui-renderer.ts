import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type { FilePatch } from '../../patch/types.js';

export interface HeaderContext {
  repoName: string;
  branch: string;
  indexStatus: 'ready' | 'missing' | 'stale';
  model: string;
}

export interface ProgressStage {
  icon: string;
  label: string;
}

const STAGES: Record<string, ProgressStage> = {
  analyzing: { icon: '🔍', label: 'analyzing repository' },
  planning: { icon: '🧠', label: 'planning execution' },
  running: { icon: '🤖', label: 'running agents' },
  testing: { icon: '🧪', label: 'running tests' },
  applying: { icon: '📝', label: 'applying changes' },
  done: { icon: '✔', label: 'completed' },
};

/**
 * UIRenderer — all terminal output for the conversational session.
 */
export class UIRenderer {
  private spinner: Ora | null = null;

  renderHeader(ctx: HeaderContext): void {
    console.log();
    console.log(chalk.bold.cyan('  Koda') + chalk.bold(' — AI Software Engineer'));
    console.log();
    console.log(
      chalk.gray('  Repository: ') + chalk.white(ctx.repoName) +
      chalk.gray('   Branch: ') + chalk.white(ctx.branch),
    );
    console.log(
      chalk.gray('  Index: ') + formatIndexStatus(ctx.indexStatus) +
      chalk.gray('   Model: ') + chalk.white(ctx.model),
    );
    console.log();
  }

  renderWelcome(question: string = 'What would you like to build?'): void {
    console.log(chalk.bold.white(`  ${question}`));
    console.log();
  }

  renderPrompt(): void {
    process.stdout.write(chalk.cyan('  > '));
  }

  renderThinking(): Ora {
    this.spinner = ora({ text: 'Thinking…', prefixText: '  ', color: 'cyan' }).start();
    return this.spinner;
  }

  renderStage(stageKey: string): void {
    const stage = STAGES[stageKey] ?? { icon: '•', label: stageKey };
    if (this.spinner?.isSpinning) {
      this.spinner.text = `${stage.icon}  ${stage.label}`;
    } else {
      console.log(`  ${stage.icon}  ${chalk.gray(stage.label)}`);
    }
  }

  stopSpinner(success = true, message?: string): void {
    if (!this.spinner) return;
    if (success) {
      this.spinner.succeed(message ? chalk.green(message) : chalk.green('done'));
    } else {
      this.spinner.fail(message ? chalk.red(message) : chalk.red('failed'));
    }
    this.spinner = null;
  }

  renderResponse(text: string): void {
    const lines = text.split('\n');
    for (const line of lines) {
      console.log('  ' + line);
    }
    console.log();
  }

  renderStreamChunk(chunk: string): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop();
      this.spinner = null;
      console.log();
    }
    process.stdout.write(chunk);
  }

  renderStreamEnd(): void {
    console.log('\n');
  }

  renderPlan(steps: string[]): void {
    console.log();
    console.log('  ' + chalk.bold('Plan:'));
    console.log();
    steps.forEach((step, i) => {
      console.log(`  ${chalk.cyan(String(i + 1) + '.')} ${step}`);
    });
    console.log();
  }

  renderPatchPreview(patches: FilePatch[]): void {
    console.log();
    console.log('  ' + chalk.bold('Proposed changes:'));
    console.log();

    for (const patch of patches) {
      console.log('  ' + chalk.cyan(patch.filePath));

      let added = 0;
      let removed = 0;
      for (const hunk of patch.hunks) {
        for (const line of hunk.lines) {
          if (line.startsWith('+')) added++;
          else if (line.startsWith('-')) removed++;
        }
      }

      if (added > 0) console.log('    ' + chalk.green(`+ ${added} line${added !== 1 ? 's' : ''} added`));
      if (removed > 0) console.log('    ' + chalk.red(`- ${removed} line${removed !== 1 ? 's' : ''} removed`));

      // Show diff preview (first hunk)
      const firstHunk = patch.hunks[0];
      if (firstHunk) {
        console.log();
        for (const line of firstHunk.lines.slice(0, 12)) {
          if (line.startsWith('+')) {
            console.log('    ' + chalk.green(line));
          } else if (line.startsWith('-')) {
            console.log('    ' + chalk.red(line));
          } else {
            console.log('    ' + chalk.gray(line));
          }
        }
        if (firstHunk.lines.length > 12) {
          console.log('    ' + chalk.gray(`... ${firstHunk.lines.length - 12} more lines`));
        }
      }
      console.log();
    }
  }

  renderError(message: string, suggestion?: string): void {
    if (this.spinner?.isSpinning) {
      this.spinner.stop();
      this.spinner = null;
    }
    console.log();
    console.log('  ' + chalk.red('✖  ') + message);
    if (suggestion) {
      console.log('  ' + chalk.gray(suggestion));
    }
    console.log();
  }

  renderInfo(message: string): void {
    console.log('  ' + chalk.gray(message));
  }

  renderSuccess(message: string): void {
    console.log('  ' + chalk.green('✔  ') + message);
    console.log();
  }

  renderHelp(): void {
    console.log();
    console.log('  ' + chalk.bold('What you can ask:'));
    console.log();
    const examples = [
      ['explain <symbol/concept>', 'Understand code in your repository'],
      ['add <feature>', 'Build new functionality'],
      ['fix <bug/issue>', 'Debug and fix problems'],
      ['refactor <target>', 'Improve code quality'],
      ['find <something>', 'Search the codebase'],
      ['status', 'Show repository and index status'],
      ['help', 'Show this message'],
      ['quit', 'Exit Koda'],
    ];
    for (const [cmd, desc] of examples) {
      console.log(`  ${chalk.cyan(cmd.padEnd(30))} ${chalk.gray(desc)}`);
    }
    console.log();
  }

  renderSetupHeader(): void {
    console.log();
    console.log(chalk.bold.cyan('  Koda Setup Wizard'));
    console.log(chalk.gray('  Configure your Azure AI Foundry connection'));
    console.log();
  }

  renderDivider(): void {
    console.log('  ' + chalk.gray('─'.repeat(60)));
  }

  renderMeta(filesAnalyzed: string[], chunksUsed: number, truncated: boolean): void {
    console.log('  ' + chalk.gray('─'.repeat(60)));
    console.log(
      chalk.gray(`  Files analyzed: ${filesAnalyzed.length}`) +
      chalk.gray(`   Code chunks: ${chunksUsed}`) +
      (truncated ? '  ' + chalk.yellow('⚠ context truncated') : ''),
    );
    console.log();
  }
}

function formatIndexStatus(status: HeaderContext['indexStatus']): string {
  switch (status) {
    case 'ready': return chalk.green('ready');
    case 'missing': return chalk.red('not indexed');
    case 'stale': return chalk.yellow('stale');
  }
}
