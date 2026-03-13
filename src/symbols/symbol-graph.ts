import type { SymbolRecord } from './types.js';
import type { SymbolIndex } from './symbol-index.js';

export interface GraphEdge {
  from: string; // Symbol ID
  to: string; // Symbol ID
  type: 'calls' | 'inherits' | 'imports' | 'references';
}

export interface GraphNode {
  id: string;
  symbol: SymbolRecord;
  inDegree: number;
  outDegree: number;
}

/**
 * SymbolGraph - Relationship graph for symbols
 *
 * Tracks: function calls, class inheritance, module dependencies
 */
export class SymbolGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private adjacencyList: Map<string, Set<string>> = new Map();
  private reverseAdjacencyList: Map<string, Set<string>> = new Map();

  constructor(private symbolIndex: SymbolIndex) {
    this.buildGraph();
  }

  /**
   * Build graph from symbol index
   */
  private buildGraph(): void {
    // Create nodes
    const stats = this.symbolIndex.getStatistics();
    const allSymbols = this.symbolIndex.query({});

    for (const symbol of allSymbols) {
      this.nodes.set(symbol.id, {
        id: symbol.id,
        symbol,
        inDegree: 0,
        outDegree: 0,
      });

      this.adjacencyList.set(symbol.id, new Set());
      this.reverseAdjacencyList.set(symbol.id, new Set());
    }

    // Create edges
    for (const symbol of allSymbols) {
      // Reference edges
      const references = this.symbolIndex.getReferences(symbol.id);
      for (const ref of references) {
        this.addEdge(symbol.id, ref.id, 'references');
      }

      // Call edges (from callers)
      for (const callerId of symbol.callers) {
        this.addEdge(callerId, symbol.id, 'calls');
      }
    }

    // Update degrees
    this.updateDegrees();
  }

  /**
   * Add edge to graph
   */
  private addEdge(from: string, to: string, type: GraphEdge['type']): void {
    this.edges.push({ from, to, type });

    // Update adjacency lists
    const outgoing = this.adjacencyList.get(from) || new Set();
    outgoing.add(to);
    this.adjacencyList.set(from, outgoing);

    const incoming = this.reverseAdjacencyList.get(to) || new Set();
    incoming.add(from);
    this.reverseAdjacencyList.set(to, incoming);
  }

  /**
   * Update node degrees
   */
  private updateDegrees(): void {
    for (const [id, node] of this.nodes) {
      node.outDegree = this.adjacencyList.get(id)?.size || 0;
      node.inDegree = this.reverseAdjacencyList.get(id)?.size || 0;
    }
  }

  /**
   * Get outgoing edges (who does this symbol reference/call?)
   */
  getOutgoingEdges(symbolId: string): GraphEdge[] {
    return this.edges.filter((e) => e.from === symbolId);
  }

  /**
   * Get incoming edges (who references/calls this symbol?)
   */
  getIncomingEdges(symbolId: string): GraphEdge[] {
    return this.edges.filter((e) => e.to === symbolId);
  }

  /**
   * Get dependencies (all symbols this symbol depends on)
   */
  getDependencies(symbolId: string, maxDepth: number = 5): SymbolRecord[] {
    const visited = new Set<string>();
    const dependencies: SymbolRecord[] = [];

    const traverse = (id: string, depth: number) => {
      if (depth > maxDepth || visited.has(id)) return;

      visited.add(id);
      const outgoing = this.adjacencyList.get(id) || new Set();

      for (const targetId of outgoing) {
        const node = this.nodes.get(targetId);
        if (node) {
          dependencies.push(node.symbol);
          traverse(targetId, depth + 1);
        }
      }
    };

    traverse(symbolId, 0);

    return dependencies;
  }

  /**
   * Get dependents (all symbols that depend on this symbol)
   */
  getDependents(symbolId: string, maxDepth: number = 5): SymbolRecord[] {
    const visited = new Set<string>();
    const dependents: SymbolRecord[] = [];

    const traverse = (id: string, depth: number) => {
      if (depth > maxDepth || visited.has(id)) return;

      visited.add(id);
      const incoming = this.reverseAdjacencyList.get(id) || new Set();

      for (const sourceId of incoming) {
        const node = this.nodes.get(sourceId);
        if (node) {
          dependents.push(node.symbol);
          traverse(sourceId, depth + 1);
        }
      }
    };

    traverse(symbolId, 0);

    return dependents;
  }

  /**
   * Find shortest path between two symbols
   */
  findPath(fromId: string, toId: string): string[] | null {
    const queue: string[][] = [[fromId]];
    const visited = new Set<string>([fromId]);

    while (queue.length > 0) {
      const path = queue.shift()!;
      const current = path[path.length - 1];

      if (current === toId) {
        return path;
      }

      const neighbors = this.adjacencyList.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }

    return null; // No path found
  }

  /**
   * Get highly connected symbols (hubs)
   */
  getHubs(limit: number = 10): GraphNode[] {
    return Array.from(this.nodes.values())
      .sort((a, b) => (b.inDegree + b.outDegree) - (a.inDegree + a.outDegree))
      .slice(0, limit);
  }

  /**
   * Detect circular dependencies
   */
  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();
    const path: string[] = [];

    const dfs = (id: string): boolean => {
      visited.add(id);
      stack.add(id);
      path.push(id);

      const neighbors = this.adjacencyList.get(id) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (stack.has(neighbor)) {
          // Found cycle
          const cycleStart = path.indexOf(neighbor);
          cycles.push(path.slice(cycleStart));
          return true;
        }
      }

      stack.delete(id);
      path.pop();
      return false;
    };

    for (const id of this.nodes.keys()) {
      if (!visited.has(id)) {
        dfs(id);
      }
    }

    return cycles;
  }

  /**
   * Get graph statistics
   */
  getStatistics(): {
    nodeCount: number;
    edgeCount: number;
    avgDegree: number;
    maxInDegree: number;
    maxOutDegree: number;
  } {
    let totalInDegree = 0;
    let totalOutDegree = 0;
    let maxInDegree = 0;
    let maxOutDegree = 0;

    for (const node of this.nodes.values()) {
      totalInDegree += node.inDegree;
      totalOutDegree += node.outDegree;
      maxInDegree = Math.max(maxInDegree, node.inDegree);
      maxOutDegree = Math.max(maxOutDegree, node.outDegree);
    }

    const nodeCount = this.nodes.size;
    const avgDegree = nodeCount > 0 ? (totalInDegree + totalOutDegree) / (2 * nodeCount) : 0;

    return {
      nodeCount,
      edgeCount: this.edges.length,
      avgDegree,
      maxInDegree,
      maxOutDegree,
    };
  }
}
