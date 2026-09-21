# LayoutPilot AI Gateway

The JLCEDA extension never stores a model-provider API key.

Architecture:

```
JLCEDA extension
  -> HTTP localhost gateway
  -> model provider
  -> structured SemanticInference
  -> extension-side deterministic validator
```

## 1. Transport-only test (no AI)

Windows PowerShell:

```powershell
$env:LAYOUTPILOT_GATEWAY_MODE="mock"
node .\gateway\server.mjs
```

Gateway:

```
http://127.0.0.1:8787
```

The mock mode exists only to validate the extension -> gateway -> validator path.
The UI will explicitly show provider=mock and must not present it as an AI result.

## 2. OpenAI reference adapter

The reference adapter uses the OpenAI Responses API with Structured Outputs.

Set credentials only in the gateway process:

```powershell
$env:LAYOUTPILOT_GATEWAY_MODE="openai"
$env:OPENAI_API_KEY="<your key>"
$env:OPENAI_MODEL="<a Structured Outputs capable model>"
node .\gateway\server.mjs
```

Optional:

```powershell
$env:OPENAI_API_BASE="https://api.openai.com/v1"
$env:LAYOUTPILOT_GATEWAY_PORT="8787"
```

Do not commit secrets or put provider keys into `extension.json`, source files, or JLCEDA user configuration.

## API

### GET /health

Returns gateway mode and health state.

### POST /semantic-infer

Request:

```json
{
  "version": "1",
  "context": {},
  "evidenceCatalog": []
}
```

Response:

```json
{
  "inference": {
    "status": "inferred",
    "role": "decoupling-capacitor",
    "associatedCore": "U1",
    "confidence": "medium",
    "evidenceRefs": ["component:value", "net:VDD", "net:GND", "core:U1"],
    "explanation": "...",
    "constraints": [
      {
        "type": "near",
        "target": "U1",
        "evidenceRefs": ["net:VDD", "net:GND", "core:U1"]
      }
    ]
  },
  "provider": "openai",
  "model": "..."
}
```

The extension validates the response again. A schema-valid model response can still be rejected if it cites evidence or a core that does not exist in the deterministic PCB context.


## 3. DeepSeek adapter

DeepSeek is supported through its official OpenAI-compatible Chat Completions API.

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\gateway\start-deepseek.ps1
```

The launcher asks for:
- DeepSeek API Key
- model ID (press Enter to use `deepseek-flash`)

The key is kept only in the current PowerShell process environment.

The adapter uses:
- base URL: `https://api.deepseek.com`
- endpoint: `/chat/completions`
- `response_format: {"type":"json_object"}`
- non-thinking mode for a smaller, more deterministic structured-output path

DeepSeek JSON Output guarantees valid JSON, but not LayoutPilot's semantic schema. Therefore the extension-side parser and deterministic evidence validator remain mandatory.

Optional environment variables:

```powershell
$env:DEEPSEEK_API_BASE="https://api.deepseek.com"
$env:DEEPSEEK_MODEL="deepseek-flash"
```
