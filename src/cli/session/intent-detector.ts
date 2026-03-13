export type Intent =
  | 'explain'
  | 'build'
  | 'fix'
  | 'refactor'
  | 'search'
  | 'status'
  | 'help'
  | 'quit';

export interface DetectedIntent {
  intent: Intent;
  confidence: number;
  subject: string;
}

interface IntentPattern {
  intent: Intent;
  patterns: RegExp[];
  weight: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: 'quit',
    patterns: [/^(quit|exit|bye|goodbye|q)$/i, /^(ctrl.?c|:q)$/i],
    weight: 100,
  },
  {
    intent: 'help',
    patterns: [/\bhelp\b/i, /^(\?|h)$/i, /what can you do/i, /^commands?$/i],
    weight: 90,
  },
  {
    intent: 'status',
    patterns: [/\bstatus\b/i, /\bindex\b.*\bstatus\b/i, /how many files/i, /^status$/i],
    weight: 85,
  },
  {
    intent: 'fix',
    patterns: [
      /\bfix\b/i,
      /\bbug\b/i,
      /\berror\b/i,
      /\bissue\b/i,
      /\brepair\b/i,
      /\bdebug\b/i,
      /\bbroken\b/i,
      /\bcrash\b/i,
      /\bfailing\b/i,
      /\bfail(s|ed)?\b/i,
    ],
    weight: 75,
  },
  {
    intent: 'refactor',
    patterns: [
      /\brefactor\b/i,
      /\brewrite\b/i,
      /\bclean.?up\b/i,
      /\boptimize\b/i,
      /\brestructure\b/i,
      /\bimprove (the )?(code|architecture|structure|performance)/i,
      /\bsimplify\b/i,
    ],
    weight: 72,
  },
  {
    intent: 'build',
    patterns: [
      /\badd\b/i,
      /\bbuild\b/i,
      /\bcreate\b/i,
      /\bimplement\b/i,
      /\bgenerate\b/i,
      /\bwrite\b/i,
      /\bmake\b/i,
      /\bdevelop\b/i,
      /\bnew\b/i,
      /\bsetup\b/i,
      /\bscaffold\b/i,
    ],
    weight: 65,
  },
  {
    intent: 'search',
    patterns: [
      /\bfind\b/i,
      /\bsearch\b/i,
      /\blook.?for\b/i,
      /\bwhere (is|are|does)\b/i,
      /\blocate\b/i,
      /\bshow me\b/i,
    ],
    weight: 62,
  },
  {
    intent: 'explain',
    patterns: [
      /\bexplain\b/i,
      /\bwhat (is|are|does)\b/i,
      /\bhow does\b/i,
      /\bwhy\b/i,
      /\bdescribe\b/i,
      /\btell me about\b/i,
      /\bunderstand\b/i,
      /\bwalk me through\b/i,
    ],
    weight: 50,
  },
];

/**
 * Extract the "subject" — the meaningful part of the query after intent keywords.
 */
function extractSubject(input: string, intent: Intent): string {
  const noise: Record<Intent, RegExp[]> = {
    explain: [/^(explain|describe|tell me about|what (is|are|does)|how does|why|walk me through)\s*/i],
    build: [/^(add|build|create|implement|generate|write|make|develop|new|setup|scaffold)\s*/i],
    fix: [/^(fix|debug|repair)\s*/i],
    refactor: [/^(refactor|rewrite|clean up|optimize|restructure|simplify|improve)\s*/i],
    search: [/^(find|search|search for|look for|locate|show me)\s*/i],
    status: [],
    help: [],
    quit: [],
  };

  let subject = input;
  for (const re of noise[intent] ?? []) {
    subject = subject.replace(re, '').trim();
  }
  // Remove articles at the start
  subject = subject.replace(/^(the|a|an)\s+/i, '').trim();
  return subject || input;
}

/**
 * Detect the intent of a natural language input string.
 * Returns the highest-confidence match, defaulting to 'explain'.
 */
export function detectIntent(input: string): DetectedIntent {
  const normalized = input.trim();
  if (!normalized) {
    return { intent: 'help', confidence: 100, subject: '' };
  }

  let bestMatch: { intent: Intent; confidence: number } = { intent: 'explain', confidence: 30 };

  for (const { intent, patterns, weight } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        if (weight > bestMatch.confidence) {
          bestMatch = { intent, confidence: weight };
        }
        break;
      }
    }
  }

  return {
    intent: bestMatch.intent,
    confidence: bestMatch.confidence,
    subject: extractSubject(normalized, bestMatch.intent),
  };
}
