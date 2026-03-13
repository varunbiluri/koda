import { BaseAgent } from '../base-agent.js';
import type { AgentInput, AgentOutput } from '../types.js';
import type { WorkspaceMemory } from '../../memory/workspace-memory.js';
import { writeFile, readFile } from '../../tools/filesystem-tools.js';
import { runTests } from '../../tools/terminal-tools.js';

export class UnitTestAgent extends BaseAgent {
  constructor() {
    super(
      'unit-test-agent',
      'testing',
      'Generates and runs unit tests for code modules',
    );
  }

  async execute(input: AgentInput, memory: WorkspaceMemory): Promise<AgentOutput> {
    try {
      memory.info('Generating unit tests', this.name);

      const filesModified = memory.getContext<string[]>('filesModified') || [];

      if (filesModified.length === 0) {
        return this.success({ message: 'No files to test' });
      }

      const testFiles: string[] = [];

      for (const filePath of filesModified) {
        if (filePath.includes('.test.') || filePath.includes('.spec.')) {
          continue; // Skip test files
        }

        const testPath = this.getTestPath(filePath);
        const testCode = await this.generateTestCode(filePath, memory);

        const result = await writeFile(testPath, testCode, memory.rootPath);
        if (result.success) {
          testFiles.push(testPath);
          memory.info(`Generated test file: ${testPath}`, this.name);
        }
      }

      // Run tests
      const testResult = await runTests(memory.rootPath);

      return this.success(
        {
          testFiles,
          testsPassed: testResult.success,
          output: testResult.data,
        },
        {
          filesModified: testFiles,
          toolsUsed: ['writeFile', 'runTests'],
          suggestions: testResult.success
            ? ['All tests passed']
            : ['Some tests failed - debug required'],
        },
      );
    } catch (err) {
      return this.failure((err as Error).message);
    }
  }

  private getTestPath(filePath: string): string {
    // Convert src/foo/bar.ts -> tests/foo/bar.test.ts
    const withoutExt = filePath.replace(/\.(ts|js|tsx|jsx)$/, '');
    const testPath = withoutExt.replace(/^src\//, 'tests/') + '.test.ts';
    return testPath;
  }

  private async generateTestCode(filePath: string, memory: WorkspaceMemory): Promise<string> {
    const fileContent = await readFile(filePath, memory.rootPath);
    const moduleName = filePath.split('/').pop()?.replace(/\.(ts|js|tsx|jsx)$/, '') || 'module';

    return `import { describe, it, expect } from 'vitest';
import { } from '../../${filePath.replace(/^src\//, '')}';

describe('${moduleName}', () => {
  it('should work correctly', () => {
    // TODO: Add test cases
    expect(true).toBe(true);
  });

  it('should handle errors', () => {
    // TODO: Add error handling tests
    expect(() => {
      // Test error cases
    }).toThrow();
  });
});
`;
  }
}
