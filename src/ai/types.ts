export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionStreamChunk {
  id: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

export interface ModelInfo {
  id: string;
  name: string;
  capabilities: string[];
}

export interface AIProvider {
  sendChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  streamChatCompletion(
    request: ChatCompletionRequest,
    onChunk: (chunk: string) => void,
  ): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
}

export interface AIConfig {
  provider: 'azure';
  endpoint: string;
  apiKey: string;
  model: string;
  apiVersion?: string;
}
