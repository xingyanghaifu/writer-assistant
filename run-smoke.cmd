@echo off
cd /d E:\dsh\????
set "ELECTRON_RUN_AS_NODE="
node_modules\electron\dist\electron.exe . > smoke2.log 2>&1
echo EXIT=%ERRORLEVEL%
