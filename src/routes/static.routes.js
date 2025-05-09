const express = require('express');
const path = require('path');
const router = express.Router();

// Ruta para el dashboard
router.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

module.exports = router; 