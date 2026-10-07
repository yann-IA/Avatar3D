@echo off
rem ==========================================================================
rem  Avatar3D - lanceur Windows : double-cliquer sur ce fichier pour demarrer.
rem  1. verifie que Node.js est installe (et assez recent)
rem  2. installe les composants la premiere fois (npm install)
rem  3. telecharge l'avatar d'exemple pour un chargement rapide
rem  4. lance l'application et l'ouvre dans Chrome ou Edge
rem ==========================================================================
setlocal
title Avatar3D - Compagnon IA
cd /d "%~dp0"

echo.
echo  ==========================================
echo     Avatar3D - Compagnon IA
echo  ==========================================
echo.

rem --- 1. Node.js -----------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERREUR] Node.js n'est pas installe sur ce PC.
  echo.
  echo  Installez la version "LTS" depuis https://nodejs.org
  echo  ^(la page va s'ouvrir^), puis redemarrez le PC et relancez ce fichier.
  start "" https://nodejs.org
  goto :fin_erreur
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)"
if errorlevel 1 (
  echo  [ERREUR] Votre version de Node.js est trop ancienne :
  node -v
  echo.
  echo  Installez la version "LTS" depuis https://nodejs.org
  echo  ^(la page va s'ouvrir^), puis relancez ce fichier.
  start "" https://nodejs.org
  goto :fin_erreur
)

rem --- 2. Composants --------------------------------------------------------
if not exist "node_modules\" (
  echo  Premiere utilisation : installation des composants.
  echo  Cela prend 1 a 3 minutes, merci de patienter...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  [ERREUR] L'installation a echoue. Verifiez votre connexion Internet
    echo  puis relancez ce fichier.
    goto :fin_erreur
  )
) else (
  rem Met a jour les composants si une nouvelle version de l'application a ete telechargee.
  call npm install --no-audit --no-fund --loglevel=error >nul 2>nul
)

rem --- 3. Avatar d'exemple (facultatif : sinon il est charge depuis Internet) -
if not exist "public\avatars\default.vrm" (
  echo  Telechargement de l'avatar d'exemple...
  call npm run fetch-avatar --silent >nul 2>nul
)

rem --- 4. Navigateur : Chrome si present, sinon Edge (Firefox ne gere pas la voix) -
set "BROWSER=msedge"
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" >nul 2>nul && set "BROWSER=chrome"
reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" >nul 2>nul && set "BROWSER=chrome"

echo.
echo  L'application s'ouvre dans votre navigateur ^(adresse : http://localhost:5173^).
echo.
echo  *** Laissez cette fenetre ouverte pendant que vous utilisez l'application. ***
echo  Pour arreter : fermez cette fenetre.
echo.
call npx vite --port 5173 --open
echo.
echo  L'application s'est arretee.
pause
exit /b 0

:fin_erreur
echo.
pause
exit /b 1
