@echo off
REM Build debug version (with console window and DevTools)
go build -o shlib-desktop-debug.exe .
echo Debug build done: shlib-desktop-debug.exe
