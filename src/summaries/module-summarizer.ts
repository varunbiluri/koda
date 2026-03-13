import type { FileSummary, ModuleSummary } from './types.js';
import { basename, dirname, relative, join } from 'path';

/**
 * ModuleSummarizer - Creates summaries of code modules (directories)
 *
 * Groups files into logical modules and generates module-level summaries
 */
export class ModuleSummarizer {
  /**
   * Summarize a module (directory) and its contents
   */
  summarize(
    modulePath: string,
    files: FileSummary[],
    submodules: ModuleSummary[],
    rootPath: string,
  ): ModuleSummary {
    const name = basename(modulePath) || 'root';

    // Calculate totals
    const totalFiles = files.length + submodules.reduce((sum, m) => sum + m.totalFiles, 0);
    const totalLines =
      files.reduce((sum, f) => sum + f.lineCount, 0) +
      submodules.reduce((sum, m) => sum + m.totalLines, 0);

    // Extract main components
    const mainComponents = this.extractMainComponents(files, submodules);

    // Extract dependencies
    const dependencies = this.extractDependencies(files, rootPath);

    // Generate purpose
    const purpose = this.generateModulePurpose(name, files, submodules, mainComponents);

    return {
      modulePath,
      name,
      purpose,
      files,
      submodules,
      totalFiles,
      totalLines,
      mainComponents,
      dependencies,
    };
  }

  /**
   * Build module hierarchy from flat file list
   */
  buildHierarchy(
    fileSummaries: FileSummary[],
    rootPath: string,
  ): ModuleSummary {
    // Group files by directory
    const filesByDir = new Map<string, FileSummary[]>();

    for (const file of fileSummaries) {
      const dir = dirname(file.filePath);
      if (!filesByDir.has(dir)) {
        filesByDir.set(dir, []);
      }
      filesByDir.get(dir)!.push(file);
    }

    // Build tree structure
    const moduleTree = this.buildModuleTree(filesByDir, rootPath);

    return moduleTree;
  }

  /**
   * Build module tree recursively
   */
  private buildModuleTree(
    filesByDir: Map<string, FileSummary[]>,
    currentPath: string,
    rootPath: string = currentPath,
  ): ModuleSummary {
    // Get direct files in this directory
    const directFiles = filesByDir.get(currentPath) || [];

    // Find subdirectories
    const subdirs = new Set<string>();
    for (const dir of filesByDir.keys()) {
      if (dir !== currentPath && dir.startsWith(currentPath + '/')) {
        const relativePath = relative(currentPath, dir);
        const firstSegment = relativePath.split('/')[0];
        subdirs.add(join(currentPath, firstSegment));
      }
    }

    // Recursively build submodules
    const submodules: ModuleSummary[] = [];
    for (const subdir of subdirs) {
      const submodule = this.buildModuleTree(filesByDir, subdir, rootPath);
      submodules.push(submodule);
    }

    // Create module summary
    return this.summarize(currentPath, directFiles, submodules, rootPath);
  }

  /**
   * Extract main components from module
   */
  private extractMainComponents(
    files: FileSummary[],
    submodules: ModuleSummary[],
  ): string[] {
    const components = new Set<string>();

    // Add main exports from files
    for (const file of files) {
      // Prioritize exports from index files
      if (file.filePath.endsWith('index.ts') || file.filePath.endsWith('index.js')) {
        file.mainExports.forEach((exp) => components.add(exp));
      } else {
        // Add first few exports from other files
        file.mainExports.slice(0, 2).forEach((exp) => components.add(exp));
      }
    }

    // Add main components from submodules
    for (const submodule of submodules) {
      submodule.mainComponents.slice(0, 2).forEach((comp) => components.add(comp));
    }

    // Return top components (limit to 10)
    return Array.from(components).slice(0, 10);
  }

  /**
   * Extract external dependencies
   */
  private extractDependencies(files: FileSummary[], rootPath: string): string[] {
    const deps = new Set<string>();

    for (const file of files) {
      for (const dep of file.dependencies) {
        // Only include dependencies outside current module
        const isExternal = !dep.startsWith('.') && !dep.startsWith(rootPath);
        if (isExternal) {
          // Extract package name
          const pkgMatch = dep.match(/^(@[^/]+\/[^/]+|[^/]+)/);
          if (pkgMatch) {
            deps.add(pkgMatch[1]);
          }
        }
      }
    }

    return Array.from(deps).sort();
  }

  /**
   * Generate module purpose description
   */
  private generateModulePurpose(
    name: string,
    files: FileSummary[],
    submodules: ModuleSummary[],
    mainComponents: string[],
  ): string {
    // Check for common module patterns
    const nameLower = name.toLowerCase();

    if (nameLower === 'agents') {
      return 'Agent implementations for task execution';
    }

    if (nameLower === 'cli') {
      return 'Command-line interface and commands';
    }

    if (nameLower === 'engine') {
      return 'Core indexing and processing engine';
    }

    if (nameLower === 'types') {
      return 'TypeScript type definitions and interfaces';
    }

    if (nameLower === 'utils' || nameLower === 'helpers') {
      return 'Utility functions and helpers';
    }

    if (nameLower === 'api' || nameLower === 'routes') {
      return 'API routes and endpoints';
    }

    if (nameLower === 'services') {
      return 'Business logic and services';
    }

    if (nameLower === 'models') {
      return 'Data models and schemas';
    }

    if (nameLower === 'tests' || nameLower === 'test') {
      return 'Test files and test utilities';
    }

    if (nameLower === 'orchestrator') {
      return 'Agent orchestration and coordination';
    }

    if (nameLower === 'memory') {
      return 'Workspace memory and context management';
    }

    if (nameLower === 'hierarchy') {
      return 'Hierarchical agent coordination system';
    }

    if (nameLower === 'skills') {
      return 'Reusable skill library and patterns';
    }

    // Generic purpose based on content
    if (submodules.length > 0) {
      const submoduleNames = submodules.map((m) => m.name).slice(0, 3).join(', ');
      return `Module containing ${submoduleNames}${submodules.length > 3 ? ', and more' : ''}`;
    }

    if (mainComponents.length > 0) {
      const components = mainComponents.slice(0, 3).join(', ');
      return `Implements ${components}${mainComponents.length > 3 ? ', and more' : ''}`;
    }

    if (files.length === 1) {
      return files[0].purpose;
    }

    return `${name} module with ${files.length} files`;
  }

  /**
   * Get module statistics
   */
  getStatistics(module: ModuleSummary): {
    totalFiles: number;
    totalLines: number;
    totalSubmodules: number;
    avgComplexity: number;
    topLanguages: Record<string, number>;
  } {
    const languages: Record<string, number> = {};
    let totalComplexity = 0;

    // Count languages in direct files
    for (const file of module.files) {
      languages[file.language] = (languages[file.language] || 0) + 1;
      totalComplexity += file.complexity;
    }

    // Add submodule stats
    for (const submodule of module.submodules) {
      const substats = this.getStatistics(submodule);
      for (const [lang, count] of Object.entries(substats.topLanguages)) {
        languages[lang] = (languages[lang] || 0) + count;
      }
    }

    const avgComplexity = module.files.length > 0 ? totalComplexity / module.files.length : 0;

    return {
      totalFiles: module.totalFiles,
      totalLines: module.totalLines,
      totalSubmodules: module.submodules.length,
      avgComplexity: Math.round(avgComplexity * 10) / 10,
      topLanguages: languages,
    };
  }
}
