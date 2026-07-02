param(
  [string]$BaseUrl = $env:LT_BASE_URL,
  [string]$Token = $env:LT_API_TOKEN
)

if (-not $BaseUrl) {
  $BaseUrl = "http://localhost:8000"
}

if (-not $Token) {
  Write-Error "Set LT_API_TOKEN or pass -Token."
  exit 1
}

$headers = @{
  Authorization = "Bearer $Token"
  "Content-Type" = "application/json"
}

function Invoke-LicenseTrackJson {
  param(
    [string]$Path,
    [string]$Method = "GET",
    [object]$Body = $null
  )

  $params = @{
    Uri = "$($BaseUrl.TrimEnd('/'))$Path"
    Method = $Method
    Headers = $headers
  }

  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 8)
  }

  Invoke-RestMethod @params
}

Write-Host "LicenseTrack integration quickstart"
Write-Host "Base URL: $BaseUrl"
Write-Host ""

Write-Host "1. Listing visible licenses..."
$licenses = Invoke-LicenseTrackJson -Path "/api/licenses"
$licenseList = @($licenses)
Write-Host "Visible licenses: $($licenseList.Count)"

if ($licenseList.Count -gt 0) {
  $first = $licenseList[0]
  Write-Host "First license: $($first.publisherName) - $($first.softwareDescription)"
  Write-Host "Custom fields on first license: $(@($first.customFields).Count)"
}

Write-Host ""
Write-Host "2. Checking expected API-token route boundary..."
try {
  Invoke-LicenseTrackJson -Path "/api/settings/global" | Out-Null
  Write-Warning "Unexpected success. This route should normally reject API tokens."
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Host "GET /api/settings/global -> $status"
}

Write-Host ""
Write-Host "3. Registering a sample integration capability if the token allows it..."
try {
  $capability = Invoke-LicenseTrackJson `
    -Path "/api/extensions/capabilities/example-integration" `
    -Method "PUT" `
    -Body @{
      name = "Example Integration"
      capabilityType = "example.integration"
      status = "available"
      version = "0.1.0"
      description = "Quickstart capability registration."
    }
  Write-Host "Registered capability: $($capability.key) ($($capability.status))"
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Host "Capability registration skipped or denied -> $status"
  Write-Host "Grant extensions:write if this integration needs to declare capabilities/status."
}

Write-Host ""
Write-Host "Quickstart complete."
