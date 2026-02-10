# Copilot Instructions for LlamaModelProvider

## 1. Big‑Picture Overview
- **Extension point** – Registers a **LanguageModelChatProvider** (`llamacpp-model-provider`).
- **Core component** – `src/provider.ts` implements the interface, converts VS Code chat messages to the Llama.CPP format, streams back SSE chunks, and emits `vscode.LanguageModelTextPart` and `LanguageModelToolCallPart`.
- **Server dependency** – The provider talks to a locally running Llama.CPP server at **http://localhost:8011**. The extension does not bundle the model.

## 2. Project Layout & Key Files
* `src/extension.ts` – activation and registration of the provider.
* `src/provider.ts` – main logic, message conversion, streaming, and token counting.
* `esbuild.js` – builds the extension; watch mode is used during dev.
* `tsconfig.json` – strict TypeScript, Node16 modules.
* `package.json` – scripts:
  * `npm run compile` – lint → type‑check → build.
  * `npm run watch` – run `watch:esbuild` + `watch:tsc` in parallel.
  * `npm test` – runs the unit tests via `@vscode/test-cli`.

## 3. Adding a New Tool
1. Add a tool definition to `options.tools` when calling the provider (done automatically by the VS Code API).
2. In `provideLanguageModelChatResponse`, the code maps each tool to the JSON body expected by Llama.CPP:
   ```ts
   requestBody.tools = options.tools.map(tool => ({
       type: 'function',
       function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
   }));
   ```
3. The provider will stream back tool calls via `progress.report(new vscode.LanguageModelToolCallPart(...))` once the SSE chunk has `finish_reason === 'tool_calls'`.

## 4. Streaming & SSE Parsing Pattern
* Each SSE line starting with `data: ` is parsed into `LlamaCppStreamChunk`.
* Text fragments are reported immediately.
* A local buffer (`toolCallBuffer`) collects partial `tool_calls` across chunks until a complete call is received.
* When `choice.finish_reason === 'tool_calls'`, report the aggregated `LanguageModelToolCallPart`.

## 5. Token Counting Strategy
The extension uses a *very rough* estimator based on character count (≈1 token per 4 chars). It is only used for reporting constraints.

## 6. Build & Test Workflow (non‑obvious commands)
- **Watch** – `npm run watch` starts both TypeScript type‑checking (`watch:tsc`) and esbuild (`watch:esbuild`). Keep this terminal open while developing.
- **Test** – `npm test` runs the unit tests located in `src/test/`. The tests use the VS Code `vscode-test` harness.

## 7. Code‑Style & Conventions
* ESLint rules target naming conventions, curly braces, semi‑colon usage, and enforce strict equality.
* All public APIs align with the VS Code Language Model API naming (`LanguageModelChatProvider`, `LanguageModelTextPart`, etc.).
* File paths and module imports use Node16 ESM semantics – e.g., `import * as vscode from 'vscode';`.

## 8. Common Pitfalls
* The SSE parser assumes a newline‑separated stream; malformed lines are silently ignored.
* The provider does **not** handle image inputs – setting `imageInput: false` in the model capabilities is intentional.
