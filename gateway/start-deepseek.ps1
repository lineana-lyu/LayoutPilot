$ErrorActionPreference = "Stop"

$secureKey = Read-Host "DeepSeek API Key" -AsSecureString
$model = Read-Host "DeepSeek model ID (press Enter for deepseek-flash)"

if ([string]::IsNullOrWhiteSpace($model)) {
    $model = "deepseek-flash"
}

$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)

try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $env:DEEPSEEK_API_KEY = $plainKey
    $env:DEEPSEEK_MODEL = $model
    $env:LAYOUTPILOT_GATEWAY_MODE = "deepseek"

    Write-Host "Starting LayoutPilot AI Gateway in DeepSeek mode..."
    Write-Host "Model: $model"
    Write-Host "API key is kept only in this PowerShell process environment."
    node "$PSScriptRoot\server.mjs"
}
finally {
    if ($ptr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
    Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:DEEPSEEK_MODEL -ErrorAction SilentlyContinue
    Remove-Item Env:LAYOUTPILOT_GATEWAY_MODE -ErrorAction SilentlyContinue
}
