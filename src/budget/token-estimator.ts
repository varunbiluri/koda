export class TokenEstimator {
  // Conservative estimate: ~4 characters per token (for English text)
  private readonly CHARS_PER_TOKEN = 4;

  estimateTokens(text: string): number {
    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }

  estimateTokensFromMessages(messages: Array<{ role: string; content: string }>): number {
    let totalChars = 0;

    for (const message of messages) {
      // Count content
      totalChars += message.content.length;
      // Add overhead for message structure
      totalChars += message.role.length + 10; // Approximate overhead
    }

    return Math.ceil(totalChars / this.CHARS_PER_TOKEN);
  }

  wouldExceedLimit(text: string, currentUsage: number, limit: number): boolean {
    const estimatedTokens = this.estimateTokens(text);
    return currentUsage + estimatedTokens > limit;
  }

  truncateToFit(text: string, maxTokens: number): string {
    const estimatedTokens = this.estimateTokens(text);

    if (estimatedTokens <= maxTokens) {
      return text;
    }

    // Calculate target character count
    const targetChars = maxTokens * this.CHARS_PER_TOKEN;

    // Truncate with ellipsis
    return text.slice(0, targetChars - 3) + '...';
  }

  getRemainingTokens(currentUsage: number, limit: number): number {
    return Math.max(0, limit - currentUsage);
  }
}

export const tokenEstimator = new TokenEstimator();
