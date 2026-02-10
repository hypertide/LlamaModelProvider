import * as vscode from 'vscode';
import { LlamaCppMessage, LlamaCppChatRequest, LlamaCppStreamChunk } from './defs';

export class LlamaCppChatProvider implements vscode.LanguageModelChatProvider {
    private port: number = 8080;
    private readonly defaultServerUrl = `http://localhost:${this.port}`;
    private readonly modelUrlMap = new Map<string, string>();
    
    async provideLanguageModelChatInformation(
        options: { silent: boolean },
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelChatInformation[]> {
        // Load model definitions from the global configuration `llmcppprov.models`
        const config = vscode.workspace.getConfiguration('llmcppprov');
        const modelsConfig = config.get<Record<string, any>>('models', {});

        // If no model definitions were provided, fall back to the original single model.
        if (!modelsConfig || Object.keys(modelsConfig).length === 0) {
            return [{
                id: 'current-model',
                name: 'Current Llama.CPP Model',
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

        // Map the configuration entries into LanguageModelChatInformation objects.
        const chatInfoList: vscode.LanguageModelChatInformation[] = [];
        this.modelUrlMap.clear();
        for (const [name, def] of Object.entries(modelsConfig)) {
            if (typeof def.url !== 'string' || !/^https?:\/\//i.test(def.url)) {
                continue;
            }
            const id = typeof def.id === 'string' ? def.id : name;
            const family = typeof def.family === 'string' ? def.family : 'llama';
            const version = typeof def.version === 'string' ? def.version : '1.0.0';
            const maxInputTokens = typeof def.maxInputTokens === 'number' ? def.maxInputTokens : 32768;
            const maxOutputTokens = typeof def.maxOutputTokens === 'number' ? def.maxOutputTokens : 8192;
            const capabilitiesObj = typeof def.capabilities === 'object' && def.capabilities !== null
                ? { ...def.capabilities, imageInput: false }
                : { imageInput: false };

            chatInfoList.push({
                id,
                name: `${name} (Llama.CPP)`,
                family,
                version,
                maxInputTokens,
                maxOutputTokens,
                capabilities: capabilitiesObj as any
            });
            
            // Clean the URL: strip any trailing slashes, then strip a trailing '/v1' if present
            const cleanedUrl = def.url
                .replace(/\/+$/, '')          // remove trailing '/'
                .replace(/\/v1\/?$/, '');     // remove trailing '/v1'
            this.modelUrlMap.set(id, cleanedUrl);
        }

        return chatInfoList;
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
            model: model.id,
            messages: llamaMessages,
            stream: true
        };

        // Conditionally add context and predict limits if available on the model.
        if ('maxInputTokens' in model) {
            (requestBody as any).n_ctx = (model as any).maxInputTokens;
        }
        if ('maxOutputTokens' in model) {
            (requestBody as any).n_predict = (model as any).maxOutputTokens;
        }

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
            const baseUrl = this.modelUrlMap.get(model.id) ?? this.defaultServerUrl;
            const response = await fetch(`${baseUrl}/v1/chat/completions`, {
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
        // Conversion because of missing roles in vscode.LanguageModelChatMessageRole, but actually sent by VSCode (eg. 'system').
        const id = role as number;
        switch (id) {
            case 1:
                return 'user';
            case 2:
                return 'assistant';
            case 3:
                return 'system';
            case 4:
                return 'tool';
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
