@echo off
cd app
echo Building nodrix image
docker build -t nodrix:latest .
cd ..
echo Exporting nodrix image to nodrix.tar
docker save nodrix:latest -o nodrix.tar