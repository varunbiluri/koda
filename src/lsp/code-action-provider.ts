export interface Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface CodeAction {
  title: string;
  kind: string;
  command: {
    title: string;
    command: string;
    arguments?: unknown[];
  };
}

/**
 * CodeActionProvider - Returns Koda code actions for a given range.
 */
export class CodeActionProvider {
  getCodeActions(uri: string, range: Range): CodeAction[] {
    return [
      {
        title: 'Koda: Explain Code',
        kind: 'refactor',
        command: {
          title: 'Koda: Explain Code',
          command: 'koda.explainCode',
          arguments: [uri, range],
        },
      },
      {
        title: 'Koda: Refactor Function',
        kind: 'refactor',
        command: {
          title: 'Koda: Refactor Function',
          command: 'koda.refactorCode',
          arguments: [uri, range],
        },
      },
      {
        title: 'Koda: Generate Tests',
        kind: 'refactor',
        command: {
          title: 'Koda: Generate Tests',
          command: 'koda.generateTests',
          arguments: [uri, range],
        },
      },
      {
        title: 'Koda: Optimize Function',
        kind: 'refactor',
        command: {
          title: 'Koda: Optimize Function',
          command: 'koda.optimizeFile',
          arguments: [uri, range],
        },
      },
    ];
  }
}
