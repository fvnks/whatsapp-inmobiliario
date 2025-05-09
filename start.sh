#!/bin/bash

echo "Iniciando WhatsApp Property Bot..."

# Verificar que node esté instalado
if ! command -v node &> /dev/null; then
    echo "Node.js no está instalado. Por favor instálalo antes de continuar."
    exit 1
fi

# Verificar que npm esté instalado
if ! command -v npm &> /dev/null; then
    echo "npm no está instalado. Por favor instálalo antes de continuar."
    exit 1
fi

# Verificar si las dependencias están instaladas
if [ ! -d "node_modules" ]; then
    echo "Instalando dependencias..."
    npm install
fi

# Verificar que el archivo .env existe
if [ ! -f ".env" ]; then
    echo "El archivo .env no existe. Por favor, crea uno basándote en .env.example"
    exit 1
fi

# Verificar que el archivo credentials.json existe
if [ ! -f "credentials.json" ]; then
    echo "El archivo credentials.json no existe. Por favor, asegúrate de tenerlo en la raíz del proyecto."
    exit 1
fi

echo "Iniciando servidor..."
node src/index.js 