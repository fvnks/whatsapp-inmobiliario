# Configuración del Bot de WhatsApp en Modo Headless

## Problema

El error "Missing X server or $DISPLAY" indica que Puppeteer está intentando ejecutar un navegador en un entorno sin servidor gráfico X11.

## Soluciones

### 1. Instalación de dependencias para un entorno headless

```bash
# Instalar paquetes necesarios en Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget libgbm-dev
```

### 2. Usar Xvfb (X Virtual Framebuffer)

Si necesitas ejecutar en modo no headless, puedes usar Xvfb:

```bash
# Instalar Xvfb
sudo apt-get install -y xvfb

# Iniciar una sesión Xvfb
Xvfb :99 -ac &
export DISPLAY=:99

# Luego iniciar la aplicación
npm run dev
```

### 3. Actualización de la configuración de Puppeteer

Asegúrate de que estás usando estas opciones en tu configuración:

```javascript
const puppeteerOptions = {
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-webgl',
    '--mute-audio',
    '--single-process',
    '--disable-features=site-per-process',
    '--ignore-certificate-errors',
    '--headless=new'
  ],
  headless: 'new',
  timeout: 120000,
  defaultViewport: null
};
```

### 4. Usar un browser endpoint remoto

Si nada de lo anterior funciona, puedes usar un navegador Chrome remoto con un endpoint WebSocket:

```javascript
client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'property-bot',
    dataPath: WHATSAPP_SESSION_PATH
  }),
  puppeteer: {
    browserWSEndpoint: 'ws://browser-service:3000'
  }
});
```

Esto requiere ejecutar un servicio de navegador Chrome por separado.

## Iniciar con el servicio desactivado

Para desarrollo, puedes desactivar temporalmente el bot de WhatsApp cambiando la variable de entorno:

```
# .env
ENABLE_WHATSAPP=false
```

Esto permitirá que la aplicación web funcione mientras solucionas los problemas del bot de WhatsApp. 