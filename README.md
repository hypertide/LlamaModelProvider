# LlamaModelProvider

**LlamaModelProvider** is a Visual Studio Code extension that supplies a **`LanguageModelChatProvider`** backed by a local [Llama.CPP](https://github.com/abetlen/llama.cpp) server.

The extension exposes each configured model as a chat provider through the VS Code Language Model API, allowing you to use the model in the built‑in Chat view or programmatically via extensions that consume chat providers.

## Features

* **Dynamic model registration** – Load one or more Llama.CPP models from workspace settings and expose them as chat providers.
* **Streaming chat** – The implementation streams tokens from the server using Server‑Sent Events (SSE), giving a real‑time response experience.
* **Tool calling support** – When the model generates a tool call, it is converted to a `vscode.LanguageModelToolCallPart`, enabling integration with other extensions that provide tools.
* **Lightweight** – No heavy dependencies; the extension only bundles the TypeScript source and communicates over HTTP.

## Requirements

* **Visual Studio Code** ≥ 1.109.0 (latest stable recommended).
* A **running Llama.CPP server** exposing the OpenAI‑compatible `/v1/chat/completions` endpoint. Typical URL: `http://localhost:8080`.
	* The extension will fall back to the default URL (`http://localhost:8080`) if no model URLs are configured.
* Optionally, a `models` configuration in `settings.json` (see *Extension Settings* below) to specify multiple models.

## Extension Settings

The extension contributes one complex setting that allows you to declare multiple models:

```json
{
	"llmcppprov.models": {
		"Model Display Name": {
			"id": "example-model-name-Q8_0.gguf",
			"url": "http://localhost:8080",
			"family": "llama",
			"version": "1.0.0",
			"maxInputTokens": 131072,
			"maxOutputTokens": 16384,
			"capabilities": { "toolCalling": true }
		}
	}
}
```

* `id` – Identifier used by VS Code to reference and display the model.
* `url` – Base URL of the Llama.CPP server (port included) - tailing / or /v1 will be striped.
* `family` – Optional; defaults to `llama`.
* `version` – Optional; displayed in the provider list.
* `maxInputTokens` / `maxOutputTokens` – Optional limits forwarded to the server via `n_ctx` and `n_predict`.
* `capabilities.toolCalling` – Must be `true` if you want to use tool calls; image input is not supported.

If no configuration is provided, a default single‑model provider named *Current Llama.CPP Model* is exposed pointing at `http://localhost:8080`.

## Known Issues

* **SSE parse errors** – Occasionally malformed chunks from the server may be silently ignored; the extension logs these to the console.
* **No image input** – The provider explicitly sets `imageInput: false` in its capabilities.
* **Tool call ordering** – When multiple tool calls are emitted in rapid succession, the provider buffers them until a `finish_reason: "tool_calls"` arrives.

These issues are considered low‑impact for typical development usage.

## Release Notes

### 0.0.1
Initial release of the **LlamaModelProvider** extension providing a stream‑based chat provider for Llama.CPP.

### 0.0.2
Added support for multiple model configuration via `llmcppprov.models` and basic tool‑calling integration.
