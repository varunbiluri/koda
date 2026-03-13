import { Command } from 'commander';
import { skillRegistry } from '../../skills/skill-registry.js';
import { SkillStore } from '../../skills/skill-store.js';
import { join } from 'path';
import chalk from 'chalk';

export function createSkillsCommand(): Command {
  const skills = new Command('skills');

  skills
    .description('Manage and view available skills')
    .option('--list', 'List all available skills')
    .option('--search <query>', 'Search for skills matching query')
    .option('--show <id>', 'Show detailed information about a skill')
    .option('--stats', 'Show skill usage statistics')
    .action(async (options) => {
      console.log(chalk.blue('\n🎯 Koda Skills Library\n'));

      try {
        // List all skills
        if (options.list || (!options.search && !options.show && !options.stats)) {
          const allSkills = skillRegistry.getAll();

          console.log(chalk.bold(`Available Skills (${allSkills.length}):\n`));

          // Group by category
          const byCategory = new Map<string, typeof allSkills>();

          for (const skill of allSkills) {
            if (!byCategory.has(skill.category)) {
              byCategory.set(skill.category, []);
            }
            byCategory.get(skill.category)!.push(skill);
          }

          for (const [category, categorySkills] of byCategory) {
            console.log(chalk.cyan(`\n${category}:`));

            for (const skill of categorySkills) {
              const success = skill.successRate > 0 ? `${Math.round(skill.successRate * 100)}%` : 'N/A';
              console.log(`  ${chalk.green(skill.id)} - ${skill.name}`);
              console.log(`    ${chalk.gray(skill.description)}`);
              console.log(`    ${chalk.gray(`Uses: ${skill.useCount} | Success: ${success}`)}`);
            }
          }

          console.log('');
        }

        // Search for skills
        if (options.search) {
          const matches = skillRegistry.findMatches(options.search, 10);

          console.log(chalk.bold(`Search Results for "${options.search}":\n`));

          if (matches.length === 0) {
            console.log(chalk.yellow('  No matching skills found'));
          } else {
            for (const match of matches) {
              const { skill, score, reasoning } = match;
              console.log(`  ${chalk.green(skill.id)} - ${skill.name}`);
              console.log(`    ${chalk.gray(skill.description)}`);
              console.log(`    ${chalk.gray(`Match: ${Math.round(score * 100)}% (${reasoning})`)}`);
              console.log('');
            }
          }
        }

        // Show detailed skill info
        if (options.show) {
          const skill = skillRegistry.get(options.show);

          if (!skill) {
            console.error(chalk.red(`✗ Skill not found: ${options.show}\n`));
            process.exit(1);
          }

          console.log(chalk.bold(`Skill: ${skill.name}`));
          console.log(chalk.gray(`ID: ${skill.id}`));
          console.log(chalk.gray(`Category: ${skill.category}`));
          console.log('');

          console.log(chalk.bold('Description:'));
          console.log(`  ${skill.description}`);
          console.log('');

          console.log(chalk.bold('Variables:'));
          for (const variable of skill.pattern.variables) {
            const required = variable.required ? chalk.red('required') : chalk.gray('optional');
            console.log(`  ${chalk.cyan(variable.name)} (${variable.type}) - ${required}`);
            console.log(`    ${variable.description}`);
            if (variable.default !== undefined) {
              console.log(`    Default: ${variable.default}`);
            }
          }
          console.log('');

          console.log(chalk.bold('Steps:'));
          skill.pattern.steps.forEach((step, i) => {
            console.log(`  ${i + 1}. ${step}`);
          });
          console.log('');

          console.log(chalk.bold('Tags:'));
          console.log(`  ${skill.tags.join(', ')}`);
          console.log('');

          console.log(chalk.bold('Statistics:'));
          console.log(`  Times used: ${skill.useCount}`);
          console.log(`  Success rate: ${Math.round(skill.successRate * 100)}%`);
          console.log(`  Created: ${new Date(skill.createdAt).toLocaleDateString()}`);
          if (skill.lastUsed) {
            console.log(`  Last used: ${new Date(skill.lastUsed).toLocaleDateString()}`);
          }
          console.log('');

          // Show example if available
          if (skill.examples.length > 0) {
            console.log(chalk.bold('Example:'));
            const example = skill.examples[0];
            console.log(`  Task: ${example.task}`);
            console.log(`  Result: ${example.result}`);
            console.log('');
          }
        }

        // Show statistics
        if (options.stats) {
          const kodaDir = join(process.cwd(), '.koda');
          const store = new SkillStore(kodaDir);

          const allSkills = skillRegistry.getAll();

          console.log(chalk.bold('Skill Usage Statistics:\n'));

          // Sort by usage
          const sorted = allSkills.sort((a, b) => b.useCount - a.useCount);

          console.log(chalk.bold('Most Used:'));
          for (const skill of sorted.slice(0, 5)) {
            if (skill.useCount > 0) {
              console.log(`  ${skill.name}: ${skill.useCount} uses (${Math.round(skill.successRate * 100)}% success)`);
            }
          }
          console.log('');

          // Show by category
          const byCategory = new Map<string, number>();
          for (const skill of allSkills) {
            byCategory.set(skill.category, (byCategory.get(skill.category) || 0) + skill.useCount);
          }

          console.log(chalk.bold('By Category:'));
          for (const [category, count] of Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1])) {
            if (count > 0) {
              console.log(`  ${category}: ${count} uses`);
            }
          }
          console.log('');
        }

        console.log(chalk.green('✓ Done\n'));
      } catch (error) {
        console.error(chalk.red(`\n✗ Error: ${(error as Error).message}\n`));
        process.exit(1);
      }
    });

  return skills;
}
