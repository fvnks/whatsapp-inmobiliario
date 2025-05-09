require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { connectDatabase, query } = require('./src/config/database');

const app = express();
const PORT = 3001;

// Parse JSON request body
app.use(bodyParser.json());

// Public health check endpoint
app.get('/status', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        error: 'Username and password are required' 
      });
    }
    
    // Find the user
    const [users] = await query(
      'SELECT * FROM users WHERE username = ? AND is_active = true', 
      [username]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ 
        error: 'Invalid credentials' 
      });
    }
    
    const user = users[0];
    
    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ 
        error: 'Invalid credentials' 
      });
    }
    
    // Create token
    const payload = {
      id: user.id,
      username: user.username,
      email: user.email,
      role_id: user.role_id
    };
    
    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRATION || '24h' }
    );
    
    // Return token and user info
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Server error' 
    });
  }
});

// Protected endpoint
app.get('/protected', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Token no proporcionado' 
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      res.json({ 
        message: 'Acceso autorizado', 
        user: decoded 
      });
    } catch (error) {
      return res.status(401).json({ 
        error: 'Token inválido o expirado' 
      });
    }
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ 
      error: 'Server error' 
    });
  }
});

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDatabase();
    
    // Start Express server
    app.listen(PORT, () => {
      console.log(`Test server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
};

startServer(); 