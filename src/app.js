const express = require('express');
const path = require('path');
// ... other imports like session, passport, view engines, body-parser ...

// Import existing route handlers
const adminPageRoutes = require('./routes/admin.routes.js'); // For rendering admin HTML pages
// ... other route imports ...

// >>> NEWLY ADDED: Import routes for WhatsApp User API
const adminWhatsappUserApiRoutes = require('./routes/adminWhatsappUser.routes.js');

const app = express();

// View engine setup (example for EJS)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middlewares
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: false })); // For parsing application/x-www-form-urlencoded
app.use(express.static(path.join(__dirname, '../public'))); // Serving static files (CSS, client-side JS)
// Note: if app.js is in src, public might be at '../public' or just 'public' if it's also in src.
// Adjust path.join(__dirname, '../public') or path.join(__dirname, 'public') accordingly.


// ... other middlewares (session, passport, flash, connect-flash, method-override etc.) ...


// Routes
app.use('/admin', adminPageRoutes); // Mounts routes from admin.routes.js under /admin prefix
// ... other app.use() for other general routes ...

// >>> NEWLY ADDED: Mount routes for WhatsApp User API
// This will make GET /admin/whatsapp/users, DELETE /admin/whatsapp/users/:userId etc. available
app.use('/admin/whatsapp', adminWhatsappUserApiRoutes);


// Error handling middleware (examples)
// 404 handler
app.use((req, res, next) => {
  res.status(404).render('error/404', { title: 'Página no encontrada' }); // Assuming you have a 404.ejs view
});

// General error handler
app.use((err, req, res, next) => {
  console.error(err.stack); // Or use your logger: logger.error('UNHANDLED_ERROR', err.message, { stack: err.stack });
  res.status(err.status || 500).render('error/500', { title: 'Error del Servidor', error: err }); // Assuming a 500.ejs view
});


const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}. Accede al admin en http://localhost:${PORT}/admin`);
  // logger.info('SERVER_START', `Servidor corriendo en el puerto ${PORT}`, {}, null, null, 'Application');
});

module.exports = app; // If you export app for testing or other purposes 