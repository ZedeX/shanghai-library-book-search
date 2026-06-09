@echo off
REM Build release version (no console window)
go build -ldflags="-H windowsgui" -o shlib-desktop.exe .
echo Release build done: shlib-desktop.exe
