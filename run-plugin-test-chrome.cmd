@echo off
setlocal

set "ROOT=%~dp0"
set "PROFILE=%ROOT%.chrome-extension-test-profile"
set "EXT=%ROOT%apps\extension\dist"
set "URL=http://localhost:3000/login"

if not exist "%EXT%\manifest.json" (
  echo Extension build not found: %EXT%
  echo Run: pnpm --filter @saas/extension build
  pause
  exit /b 1
)

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "--user-data-dir=%PROFILE%" "--load-extension=%EXT%" "--disable-extensions-except=%EXT%" "%URL%"
  exit /b 0
)

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "--user-data-dir=%PROFILE%" "--load-extension=%EXT%" "--disable-extensions-except=%EXT%" "%URL%"
  exit /b 0
)

echo Chrome or Edge was not found.
pause
exit /b 1
