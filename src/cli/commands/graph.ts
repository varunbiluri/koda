import { Command } from 'commander';
import { WorkspaceMemory } from '../../memory/workspace-memory.js';
import { SupervisorAgent } from '../../hierarchy/supervisor-agent.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

export function createGraphCommand(): Command {
  const graph = new Command('graph');

  graph
    .description('Generate execution dependency graph for a task')
    .argument('<task>', 'Task description')
    .option('--format <format>', 'Output format: text, dot, json', 'text')
    .option('--output <file>', 'Save to file instead of displaying')
    .action(async (task: string, options) => {
      console.log(chalk.blue('\n📊 Koda Execution Graph\n'));

      try {
        // Create workspace memory
        const rootPath = process.cwd();
        const memory = new WorkspaceMemory(rootPath, task);

        // Run supervisor to create graph
        const supervisor = new SupervisorAgent();
        const result = await supervisor.execute({ task }, memory);

        if (!result.success) {
          console.error(chalk.red(`\n✗ Graph generation failed: ${result.error}\n`));
          process.exit(1);
        }

        const decision = result.result as any;
        const executionGraph = decision.executionGraph;

        // Generate output based on format
        let output: string;

        switch (options.format) {
          case 'dot':
            output = executionGraph.toDOT();
            break;

          case 'json':
            output = JSON.stringify(
              {
                nodes: executionGraph.getAllNodes(),
                edges: executionGraph.getAllEdges(),
                statistics: executionGraph.getStatistics(),
              },
              null,
              2,
            );
            break;

          case 'text':
          default:
            output = executionGraph.visualize();
            break;
        }

        // Output to file or console
        if (options.output) {
          const outputPath = join(process.cwd(), options.output);
          await writeFile(outputPath, output, 'utf-8');
          console.log(chalk.green(`✓ Graph saved to: ${outputPath}\n`));
        } else {
          console.log(output);
          console.log('');
        }

        // Display statistics
        const stats = executionGraph.getStatistics();
        console.log(chalk.bold('Graph Statistics:'));
        console.log(`  Total nodes: ${stats.nodeCount}`);
        console.log(`  Total edges: ${stats.edgeCount}`);
        console.log(`  Execution waves: ${stats.waveCount}`);
        console.log(`  Max depth: ${stats.maxDepth}`);
        console.log(`  Critical path length: ${stats.criticalPathLength}`);
        console.log('');

        if (options.format === 'dot') {
          console.log(chalk.yellow('💡 Tip: Visualize DOT format with Graphviz:'));
          console.log(chalk.gray(`   dot -Tpng ${options.output || 'graph.dot'} -o graph.png\n`));
        }

        console.log(chalk.green('✓ Graph generated successfully\n'));
      } catch (error) {
        console.error(chalk.red(`\n✗ Error: ${(error as Error).message}\n`));
        process.exit(1);
      }
    });

  return graph;
}
