import * as vscode from 'vscode';
import { LlamaCppMessage, LlamaCppChatRequest, LlamaCppStreamChunk } from './defs';

export class LlamaCppChatProvider implements vscode.LanguageModelChatProvider {
    private readonly serverUrl = 'http://localhost:8011';
    
    async provideLanguageModelChatInformation(
        options: { silent: boolean },
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelChatInformation[]> {
        return [{
            id: 'current-model',
            name: 'Current model',
            family: 'llama',
            version: '1.0.0',
            maxInputTokens: 131072,
            maxOutputTokens: 16384,
            capabilities: {
                toolCalling: true,
                imageInput: false
            }
        }];
    }
    
    async provideLanguageModelChatResponse(
        model: vscode.LanguageModelChatInformation,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken
    ): Promise<void> {
        const llamaMessages = this.convertMessages(messages);
        
        const requestBody: LlamaCppChatRequest = {
            messages: llamaMessages,
            stream: true
        };

        if (options.tools && options.tools.length > 0) {
            requestBody.tools = options.tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema
                }
            }));
        }

        const abortController = new AbortController();
        const cancellationListener = token.onCancellationRequested(() => {
            abortController.abort();
        });

        try {
            const response = await fetch(`${this.serverUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody),
                signal: abortController.signal
            });

            if (!response.ok) {
                throw new Error(`Llama.CPP server error: ${response.status} ${response.statusText}`);
            }

            if (!response.body) {
                throw new Error('No response body from Llama.CPP server');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let toolCallBuffer: Map<number, { id?: string; name?: string; arguments: string }> = new Map();

            try {
                while (true) {
                    if (token.isCancellationRequested) {
                        reader.cancel();
                        break;
                    }

                    const { done, value } = await reader.read();
                    
                    if (done) {
                        break;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim() || line.trim() === 'data: [DONE]') {
                            continue;
                        }

                        if (line.startsWith('data: ')) {
                            try {
                                const chunk: LlamaCppStreamChunk = JSON.parse(line.substring(6));
                                
                                for (const choice of chunk.choices) {
                                    if (choice.delta.content) {
                                        progress.report(new vscode.LanguageModelTextPart(choice.delta.content));
                                    }

                                    if (choice.delta.tool_calls) {
                                        for (const toolCall of choice.delta.tool_calls) {
                                            const idx = toolCall.index;
                                            
                                            if (!toolCallBuffer.has(idx)) {
                                                toolCallBuffer.set(idx, { arguments: '' });
                                            }
                                            
                                            const buffered = toolCallBuffer.get(idx)!;
                                            
                                            if (toolCall.id) {
                                                buffered.id = toolCall.id;
                                            }
                                            if (toolCall.function?.name) {
                                                buffered.name = toolCall.function.name;
                                            }
                                            if (toolCall.function?.arguments) {
                                                buffered.arguments += toolCall.function.arguments;
                                            }
                                        }
                                    }

                                    if (choice.finish_reason === 'tool_calls') {
                                        for (const [, toolCall] of toolCallBuffer) {
                                            if (toolCall.id && toolCall.name) {
                                                progress.report(new vscode.LanguageModelToolCallPart(
                                                    toolCall.id,
                                                    toolCall.name,
                                                    JSON.parse(toolCall.arguments || '{}')
                                                ));
                                            }
                                        }
                                        toolCallBuffer.clear();
                                    }
                                }
                            } catch (parseError) {
                                console.error('Error parsing SSE chunk:', parseError);
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }
        } finally {
            cancellationListener.dispose();
        }
    }

    private convertMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): LlamaCppMessage[] {
        return messages.map(msg => {
            const llamaMsg: LlamaCppMessage = {
                role: this.mapRole(msg.role),
                content: ''
            };

            for (const part of msg.content) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    llamaMsg.content += part.value;
                } else if (part instanceof vscode.LanguageModelToolResultPart) {
                    llamaMsg.role = 'tool';
                    llamaMsg.tool_call_id = part.callId;
                    llamaMsg.content = JSON.stringify(part.content);
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                    if (!llamaMsg.tool_calls) {
                        llamaMsg.tool_calls = [];
                    }
                    llamaMsg.tool_calls.push({
                        id: part.callId,
                        type: 'function',
                        function: {
                            name: part.name,
                            arguments: JSON.stringify(part.input)
                        }
                    });
                }
            }

            return llamaMsg;
        });
    }

    private mapRole(role: vscode.LanguageModelChatMessageRole): 'system' | 'user' | 'assistant' | 'tool' {
        switch (role) {
            case vscode.LanguageModelChatMessageRole.User:
                return 'user';
            case vscode.LanguageModelChatMessageRole.Assistant:
                return 'assistant';
            default:
                return 'user';
        }
    }

    async provideTokenCount(
        model: vscode.LanguageModelChatInformation,
        text: string | vscode.LanguageModelChatRequestMessage,
        token: vscode.CancellationToken
    ): Promise<number> {
        if (typeof text === 'string') {
            return Math.ceil(text.length / 4);
        }
        
        let totalLength = 0;
        for (const part of text.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
                totalLength += part.value.length;
            }
        }
        return Math.ceil(totalLength / 4);
    }
}
