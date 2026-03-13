import type { Task } from '../agents/types.js';

export interface GraphNode extends Task {
  children: string[]; // IDs of dependent tasks
  parents: string[]; // IDs of tasks this depends on
  depth: number; // Level in the graph (0 = no dependencies)
}

export interface GraphEdge {
  from: string; // Parent task ID
  to: string; // Child task ID
  type: 'dependency' | 'sequence' | 'optional';
}

/**
 * ExecutionGraph - Represents tasks as a dependency graph with topological ordering
 *
 * Features:
 * - DAG (Directed Acyclic Graph) structure
 * - Topological sorting for execution order
 * - Parallel execution wave detection
 * - Cycle detection
 * - Graph visualization
 */
export class ExecutionGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];

  /**
   * Add a node to the graph
   */
  addNode(task: Task): string {
    const node: GraphNode = {
      ...task,
      children: [],
      parents: [],
      depth: 0,
    };

    this.nodes.set(task.id, node);

    // Add edges for dependencies
    for (const depId of task.dependencies) {
      this.addEdge(depId, task.id, 'dependency');
    }

    // Recalculate depths
    this.calculateDepths();

    return task.id;
  }

  /**
   * Add an edge between two nodes
   */
  addEdge(fromId: string, toId: string, type: GraphEdge['type'] = 'dependency'): void {
    // Validate nodes exist
    if (!this.nodes.has(fromId)) {
      throw new Error(`Cannot add edge: node ${fromId} does not exist`);
    }
    if (!this.nodes.has(toId)) {
      throw new Error(`Cannot add edge: node ${toId} does not exist`);
    }

    // Check for cycles
    if (this.wouldCreateCycle(fromId, toId)) {
      throw new Error(`Cannot add edge ${fromId} -> ${toId}: would create a cycle`);
    }

    // Add edge
    this.edges.push({ from: fromId, to: toId, type });

    // Update node relationships
    const fromNode = this.nodes.get(fromId)!;
    const toNode = this.nodes.get(toId)!;

    if (!fromNode.children.includes(toId)) {
      fromNode.children.push(toId);
    }

    if (!toNode.parents.includes(fromId)) {
      toNode.parents.push(fromId);
    }

    // Update dependencies array for consistency
    if (!toNode.dependencies.includes(fromId)) {
      toNode.dependencies.push(fromId);
    }
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get all nodes
   */
  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all edges
   */
  getAllEdges(): GraphEdge[] {
    return this.edges;
  }

  /**
   * Get execution waves (parallel execution groups)
   */
  getExecutionWaves(): Task[][] {
    const waves: Task[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(this.nodes.keys());

    while (remaining.size > 0) {
      // Find nodes with all dependencies completed
      const ready: Task[] = [];

      for (const id of remaining) {
        const node = this.nodes.get(id)!;
        const allDepsCompleted = node.dependencies.every((dep) => completed.has(dep));

        if (allDepsCompleted) {
          ready.push(node);
        }
      }

      if (ready.length === 0) {
        // No progress - there must be a cycle or missing dependency
        throw new Error('Cannot create execution waves: circular dependency or missing node');
      }

      waves.push(ready);

      // Mark as completed
      for (const task of ready) {
        completed.add(task.id);
        remaining.delete(task.id);
      }
    }

    return waves;
  }

  /**
   * Get topologically sorted tasks
   */
  getTopologicalOrder(): Task[] {
    const waves = this.getExecutionWaves();
    return waves.flat();
  }

  /**
   * Get root nodes (no dependencies)
   */
  getRootNodes(): GraphNode[] {
    return Array.from(this.nodes.values()).filter((node) => node.dependencies.length === 0);
  }

  /**
   * Get leaf nodes (no children)
   */
  getLeafNodes(): GraphNode[] {
    return Array.from(this.nodes.values()).filter((node) => node.children.length === 0);
  }

  /**
   * Get nodes at a specific depth
   */
  getNodesAtDepth(depth: number): GraphNode[] {
    return Array.from(this.nodes.values()).filter((node) => node.depth === depth);
  }

  /**
   * Get maximum depth of the graph
   */
  getMaxDepth(): number {
    let max = 0;
    for (const node of this.nodes.values()) {
      max = Math.max(max, node.depth);
    }
    return max;
  }

  /**
   * Check if adding an edge would create a cycle
   */
  private wouldCreateCycle(fromId: string, toId: string): boolean {
    // Check if there's already a path from toId to fromId
    return this.hasPath(toId, fromId);
  }

  /**
   * Check if there's a path from start to end
   */
  private hasPath(startId: string, endId: string): boolean {
    const visited = new Set<string>();
    const queue = [startId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      if (currentId === endId) {
        return true;
      }

      if (visited.has(currentId)) {
        continue;
      }

      visited.add(currentId);

      const current = this.nodes.get(currentId);
      if (current) {
        queue.push(...current.children);
      }
    }

    return false;
  }

  /**
   * Calculate depth for all nodes
   */
  private calculateDepths(): void {
    // Reset depths
    for (const node of this.nodes.values()) {
      node.depth = 0;
    }

    // Calculate depths using topological sort
    const waves = this.getExecutionWaves();

    for (let i = 0; i < waves.length; i++) {
      for (const task of waves[i]) {
        const node = this.nodes.get(task.id)!;
        node.depth = i;
      }
    }
  }

  /**
   * Get critical path (longest path through the graph)
   */
  getCriticalPath(): GraphNode[] {
    const leafNodes = this.getLeafNodes();
    let longestPath: GraphNode[] = [];

    for (const leaf of leafNodes) {
      const path = this.getLongestPathTo(leaf.id);
      if (path.length > longestPath.length) {
        longestPath = path;
      }
    }

    return longestPath;
  }

  /**
   * Get longest path to a node
   */
  private getLongestPathTo(nodeId: string): GraphNode[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];

    if (node.parents.length === 0) {
      return [node];
    }

    let longestPath: GraphNode[] = [];

    for (const parentId of node.parents) {
      const pathToParent = this.getLongestPathTo(parentId);
      if (pathToParent.length > longestPath.length) {
        longestPath = pathToParent;
      }
    }

    return [...longestPath, node];
  }

  /**
   * Generate a text visualization of the graph
   */
  visualize(): string {
    const lines: string[] = [];
    lines.push('Execution Graph:');
    lines.push('');

    const waves = this.getExecutionWaves();

    for (let i = 0; i < waves.length; i++) {
      lines.push(`Wave ${i + 1}:`);

      for (const task of waves[i]) {
        const node = this.nodes.get(task.id)!;
        const deps = node.dependencies.length > 0 ? ` (depends on: ${node.dependencies.join(', ')})` : '';
        lines.push(`  - ${task.id}: ${task.description}${deps}`);
      }

      lines.push('');
    }

    // Critical path
    const criticalPath = this.getCriticalPath();
    lines.push('Critical Path:');
    lines.push(criticalPath.map((n) => n.id).join(' → '));
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Export graph to DOT format (for Graphviz)
   */
  toDOT(): string {
    const lines: string[] = [];
    lines.push('digraph ExecutionGraph {');
    lines.push('  rankdir=TB;');
    lines.push('  node [shape=box];');
    lines.push('');

    // Add nodes
    for (const node of this.nodes.values()) {
      const label = `${node.id}\\n${node.type}\\n${node.description}`;
      lines.push(`  "${node.id}" [label="${label}"];`);
    }

    lines.push('');

    // Add edges
    for (const edge of this.edges) {
      const style = edge.type === 'optional' ? 'dashed' : 'solid';
      lines.push(`  "${edge.from}" -> "${edge.to}" [style=${style}];`);
    }

    lines.push('}');

    return lines.join('\n');
  }

  /**
   * Get graph statistics
   */
  getStatistics(): {
    nodeCount: number;
    edgeCount: number;
    maxDepth: number;
    waveCount: number;
    criticalPathLength: number;
  } {
    const waves = this.getExecutionWaves();
    const criticalPath = this.getCriticalPath();

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      maxDepth: this.getMaxDepth(),
      waveCount: waves.length,
      criticalPathLength: criticalPath.length,
    };
  }

  /**
   * Convert to ExecutionPlan format (for backward compatibility)
   */
  toExecutionPlan(): { tasks: Task[]; waves: Task[][] } {
    const tasks = Array.from(this.nodes.values());
    const waves = this.getExecutionWaves();

    return { tasks, waves };
  }
}
