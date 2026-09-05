$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://localhost:8000/')
$listener.Start()
$root = $PSScriptRoot
$mime = @{'.html'='text/html; charset=utf-8';'.js'='application/javascript; charset=utf-8';'.css'='text/css; charset=utf-8';'.png'='image/png';'.jpg'='image/jpeg';'.jpeg'='image/jpeg';'.svg'='image/svg+xml'}
while ($listener.IsListening) {
  $context = $listener.GetContext()
  $relative = $context.Request.Url.AbsolutePath.TrimStart('/').Replace('/','\\')
  if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
  $target = Join-Path $root $relative
  if ((Test-Path -LiteralPath $target -PathType Leaf) -and ((Resolve-Path -LiteralPath $target).Path.StartsWith($root))) {
    $extension = [IO.Path]::GetExtension($target).ToLowerInvariant()
    $context.Response.ContentType = if ($mime.ContainsKey($extension)) { $mime[$extension] } else { 'application/octet-stream' }
    $bytes = [IO.File]::ReadAllBytes($target)
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes,0,$bytes.Length)
  } else { $context.Response.StatusCode = 404 }
  $context.Response.Close()
}
