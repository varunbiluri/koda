import { Command } from 'commander';
import { WorkspaceMemory } from '../../memory/workspace-memory.js';
import { SupervisorAgent } from '../../hierarchy/supervisor-agent.js';
import chalk from 'chalk';

export function createPlanCommand(): Command {
  const plan = new Command('plan');

  plan
    .description('Analyze task and display execution plan')
    .argument('<task>', 'Task description to plan')
    .option('--detailed', 'Show detailed execution plan')
    .action(async (task: string, options) => {
      console.log(chalk.blue('\n📋 Koda Execution Planner\n'));

      try {
        // Create workspace memory
        const rootPath = process.cwd();
        const memory = new WorkspaceMemory(rootPath, task);

        // Run supervisor to create plan
        const supervisor = new SupervisorAgent();
        const result = await supervisor.execute({ task }, memory);

        if (!result.success) {
          console.error(chalk.red(`\n✗ Planning failed: ${result.error}\n`));
          process.exit(1);
        }

        const decision = result.result as any;

        // Display plan
        console.log(chalk.bold('Task Analysis:'));
        console.log(`  Complexity: ${decision.estimatedComplexity}/10`);
        console.log(`  Strategy: ${chalk.cyan(decision.strategy)}`);
        console.log(`  Reasoning: ${decision.reasoning}`);
        console.log('');

        console.log(chalk.bold('Coordinators to Activate:'));
        for (const coordinator of decision.coordinators) {
          console.log(`  ${chalk.green('✓')} ${coordinator}`);
        }
        console.log('');

        if (options.detailed) {
          // Display execution graph
          console.log(chalk.bold('Execution Graph:'));
          console.log(decision.executionGraph.visualize());
          console.log('');

          // Display statistics
          const stats = decision.executionGraph.getStatistics();
          console.log(chalk.bold('Graph Statistics:'));
          console.log(`  Nodes: ${stats.nodeCount}`);
          console.log(`  Edges: ${stats.edgeCount}`);
          console.log(`  Waves: ${stats.waveCount}`);
          console.log(`  Max Depth: ${stats.maxDepth}`);
          console.log(`  Critical Path: ${stats.criticalPathLength} nodes`);
          console.log('');
        }

        // Display suggestions
        if (result.suggestions && result.suggestions.length > 0) {
          console.log(chalk.bold('Suggestions:'));
          for (const suggestion of result.suggestions) {
            console.log(`  • ${suggestion}`);
          }
          console.log('');
        }

        console.log(chalk.green('✓ Plan generated successfully\n'));
      } catch (error) {
        console.error(chalk.red(`\n✗ Error: ${(error as Error).message}\n`));
        process.exit(1);
      }
    });

  return plan;
}
