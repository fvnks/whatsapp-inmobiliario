require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');

// Inicialización de servicios
const { initWhatsAppBot, isBotInitialized } = require('./services/whatsappBot');
const { connectDatabase } = require('./config/database');
const { startScheduler } = require('./services/schedulerService');

// Rutas
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const googleSheetRoutes = require('./routes/googleSheet.routes');
const adminRoutes = require('./routes/admin.routes');
const googleSheetsRoutes = require('./routes/googleSheets.routes');
const whatsappUsersRoutes = require('./routes/whatsappUsers.routes');
const whatsappRolesRoutes = require('./routes/whatsappRoles.routes');
const configRoutes = require('./routes/config.routes.js');

// Middlewares
const { errorHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;

// Variable para controlar si se debe iniciar el bot de WhatsApp
const ENABLE_WHATSAPP = process.env.ENABLE_WHATSAPP === 'true';

// Configuración de middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Configuración de vistas y layouts
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');
app.use(expressLayouts);
app.set('layout', 'layouts/admin');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// Endpoint de estado para verificar si el servidor está funcionando
app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'whatsapp-property-bot',
    environment: process.env.NODE_ENV,
    whatsappBot: isBotInitialized() ? 'active' : 'inactive'
  });
});

// Endpoint público para verificar la API
app.get('/api/public/status', (req, res) => {
  res.json({
    status: 'ok',
    message: 'La API está funcionando correctamente',
    auth_required: 'Para acceder a otros endpoints de la API es necesario autenticarse en /api/auth/login',
    credentials: 'Usuario por defecto: admin, Contraseña: admin123',
    whatsapp_status: isBotInitialized() ? 'active' : 'inactive'
  });
});

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/google-sheets', authMiddleware, googleSheetRoutes);
app.use('/api/googlesheets', authMiddleware, googleSheetsRoutes);
app.use('/api/whatsapp-users', whatsappUsersRoutes);
app.use('/api/whatsapp-roles', whatsappRolesRoutes);
app.use('/api/config', authMiddleware, configRoutes);
app.use('/admin', authMiddleware, adminRoutes);

// Ruta principal
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Ruta de login
app.get('/login', (req, res) => {
  // Add path to debug routes
  console.log('Login route accessed. Rendering login view.');
  
  // Ensure the view exists by logging available views
  const viewPath = path.join(__dirname, '../views/login.ejs');
  console.log('Login view path:', viewPath);
  console.log('View exists:', require('fs').existsSync(viewPath));
  
  res.render('login', { 
    title: 'Iniciar Sesión', 
    path: '/login', 
    layout: 'layouts/login' 
  });
});

// Ruta de logout
app.get('/logout', (req, res) => {
  // Limpiar cookie
  res.clearCookie('token');
  // Redireccionar a login
  res.redirect('/login');
});

// Middleware de manejo de errores
app.use(errorHandler);

// Iniciar el servidor
const startServer = async () => {
  try {
    // Conectar a la base de datos
    await connectDatabase();
    
    // Iniciar el servidor Express
    const server = app.listen(PORT, () => {
      console.log(`Servidor iniciado en http://localhost:${PORT}`);
    });
    
    // Variable para indicar si WhatsApp se inicializó correctamente
    let whatsappReady = false;
    if (ENABLE_WHATSAPP) {
      try {
        console.log('Iniciando bot de WhatsApp (ENABLE_WHATSAPP=true)...');
        await initWhatsAppBot();
        console.log('Bot de WhatsApp iniciado correctamente');
        whatsappReady = true; // Marcar como listo
      } catch (whatsappError) {
        console.error('Error inicializando el bot de WhatsApp:', whatsappError);
        console.warn('Continuando sin el bot de WhatsApp. La interfaz web seguirá funcionando.');
      }
    } else {
      console.log('Bot de WhatsApp deshabilitado (ENABLE_WHATSAPP=false)');
    }

    // Iniciar el scheduler SOLO SI WhatsApp está listo (porque necesita sendMessage)
    if (whatsappReady) {
        startScheduler(); 
    } else {
        console.warn('[Scheduler] El scheduler no se iniciará porque el bot de WhatsApp no está listo.');
    }
    
    // Manejo de señales para una salida limpia
    const handleShutdown = () => {
      console.log('Cerrando servidor...');
      server.close(() => {
        console.log('Servidor HTTP cerrado.');
        process.exit(0);
      });
      
      // Cerrar forzadamente si no se cierra en 5 segundos
      setTimeout(() => {
        console.log('Forzando cierre después de 5 segundos');
        process.exit(1);
      }, 5000);
    };
    
    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);
    
  } catch (error) {
    console.error('Error al iniciar el servidor:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app; 