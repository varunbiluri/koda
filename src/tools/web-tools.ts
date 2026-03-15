import type { ToolResult } from './types.js';

const MAX_RESPONSE_CHARS = 10_000;

/**
 * Fetch the text content of a URL.
 * Strips HTML tags for readability; truncates at MAX_RESPONSE_CHARS.
 */
export async function fetchUrl(url: string): Promise<ToolResult<string>> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Koda/0.1 (AI software engineer)' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status} ${response.statusText} — ${url}`,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    let text = await response.text();

    // Strip HTML tags for plain-text representation
    if (contentType.includes('text/html')) {
      text = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }

    const truncated = text.length > MAX_RESPONSE_CHARS;
    const output = truncated
      ? text.slice(0, MAX_RESPONSE_CHARS) + `\n\n[...truncated — response exceeds ${MAX_RESPONSE_CHARS} characters]`
      : text;

    return { success: true, data: output };
  } catch (err) {
    return {
      success: false,
      error: `Failed to fetch ${url}: ${(err as Error).message}`,
    };
  }
}
