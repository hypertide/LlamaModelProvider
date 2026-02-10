export interface LlamaCppMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

export interface LlamaCppChatRequest {
    model: string;
    messages: LlamaCppMessage[];
    stream: boolean;
    tools?: Array<{
        type: 'function';
        function: {
            name: string;
            description?: string;
            parameters?: object;
        };
    }>;
    n_ctx?: number;
    n_predict?: number;
}

export interface LlamaCppStreamChunk {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        delta: {
            role?: string;
            content?: string;
            tool_calls?: Array<{
                index: number;
                id?: string;
                type?: 'function';
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
        finish_reason?: string | null;
    }>;
}
