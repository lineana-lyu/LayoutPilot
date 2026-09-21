$ErrorActionPreference = "Stop"

$secureKey = Read-Host "OpenAI API Key" -AsSecureString
$model = Read-Host "OpenAI model ID"

if ([string]::IsNullOrWhiteSpace($model)) {
    throw "Model ID cannot be empty."
}

$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)

try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $env:OPENAI_API_KEY = $plainKey
    $env:OPENAI_MODEL = $model
    $env:LAYOUTPILOT_GATEWAY_MODE = "openai"

    Write-Host "Starting LayoutPilot AI Gateway in OpenAI mode..."
    Write-Host "API key is kept only in this PowerShell process environment."
    node "$PSScriptRoot\server.mjs"
}
finally {
    if ($ptr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:OPENAI_MODEL -ErrorAction SilentlyContinue
    Remove-Item Env:LAYOUTPILOT_GATEWAY_MODE -ErrorAction SilentlyContinue
}
