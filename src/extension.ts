import * as vscode from 'vscode';
import { LlamaCppChatProvider } from './provider';

export function activate(context: vscode.ExtensionContext) {
	console.log(`LlamaCPPModelProvider extension (${context.extension.id}) loaded.`);
    const provider = new LlamaCppChatProvider();
    
    const registration = vscode.lm.registerLanguageModelChatProvider(
        'llamacpp-model-provider',
        provider
    );

    context.subscriptions.push(registration);
}

export function deactivate() {}
