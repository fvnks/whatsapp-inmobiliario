const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool;

/**
 * Conecta a la base de datos MySQL y crea las tablas si no existen
 */
const connectDatabase = async () => {
  try {
    // Crear el pool de conexiones
    pool = mysql.createPool(dbConfig);
    
    console.log('Conexión a la base de datos establecida');
    
    // Verificar la conexión
    const connection = await pool.getConnection();
    console.log('Base de datos conectada correctamente');
    connection.release();
    
    // Crear tablas si no existen
    await createTables();
    
    return pool;
  } catch (error) {
    console.error('Error al conectar a la base de datos:', error);
    throw error;
  }
};

/**
 * Crea las tablas necesarias en la base de datos
 */
const createTables = async () => {
  const connection = await pool.getConnection();
  try {
    // Tabla de Roles
    await connection.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Tabla de Usuarios
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(100),
        role_id INT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        last_login TIMESTAMP NULL,
        FOREIGN KEY (role_id) REFERENCES roles(id)
      )
    `);

    // Tabla de Permisos
    await connection.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de Relación Roles-Permisos
    await connection.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INT,
        permission_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (role_id, permission_id),
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
      )
    `);

    // Tabla de Google Sheets
    await connection.query(`
      CREATE TABLE IF NOT EXISTS google_sheets (
        id INT PRIMARY KEY AUTO_INCREMENT,
        sheet_id VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        \`range\` VARCHAR(50) DEFAULT 'A:Z',
        is_active BOOLEAN DEFAULT true,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);

    // Tabla de Consultas
    await connection.query(`
      CREATE TABLE IF NOT EXISTS queries (
        id INT PRIMARY KEY AUTO_INCREMENT,
        phone_number VARCHAR(20) NOT NULL,
        query_text TEXT NOT NULL,
        response_text TEXT,
        google_sheet_id INT,
        status ENUM('pending', 'processed', 'failed') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP NULL,
        FOREIGN KEY (google_sheet_id) REFERENCES google_sheets(id)
      )
    `);

    // Insertar roles por defecto
    const [roles] = await connection.query('SELECT * FROM roles LIMIT 1');
    if (roles.length === 0) {
      await connection.query(`
        INSERT INTO roles (name, description) VALUES 
        ('admin', 'Administrador con acceso completo'),
        ('operator', 'Operador con acceso al bot y consultas'),
        ('viewer', 'Visualizador con acceso de solo lectura')
      `);
    }

    // Insertar permisos por defecto
    const [permissions] = await connection.query('SELECT * FROM permissions LIMIT 1');
    if (permissions.length === 0) {
      await connection.query(`
        INSERT INTO permissions (name, description) VALUES 
        ('manage_users', 'Gestionar usuarios'),
        ('manage_sheets', 'Gestionar hojas de Google Sheets'),
        ('view_queries', 'Ver consultas de usuarios'),
        ('respond_queries', 'Responder consultas de usuarios'),
        ('access_bot', 'Acceder al bot de WhatsApp'),
        ('view_dashboard', 'Ver el panel de control')
      `);
    }

    // Asignar permisos a roles
    const [rolePermissions] = await connection.query('SELECT * FROM role_permissions LIMIT 1');
    if (rolePermissions.length === 0) {
      // Obtener IDs de roles
      const [roles] = await connection.query('SELECT id, name FROM roles');
      const roleMap = {};
      roles.forEach(role => {
        roleMap[role.name] = role.id;
      });

      // Obtener IDs de permisos
      const [permissions] = await connection.query('SELECT id, name FROM permissions');
      const permissionMap = {};
      permissions.forEach(permission => {
        permissionMap[permission.name] = permission.id;
      });

      // Admin tiene todos los permisos
      for (const permName in permissionMap) {
        await connection.query(`
          INSERT INTO role_permissions (role_id, permission_id) 
          VALUES (?, ?)
        `, [roleMap.admin, permissionMap[permName]]);
      }

      // Operator tiene permisos limitados
      const operatorPermissions = ['view_queries', 'respond_queries', 'access_bot', 'view_dashboard'];
      for (const permName of operatorPermissions) {
        await connection.query(`
          INSERT INTO role_permissions (role_id, permission_id) 
          VALUES (?, ?)
        `, [roleMap.operator, permissionMap[permName]]);
      }

      // Viewer solo puede ver
      const viewerPermissions = ['view_queries', 'view_dashboard'];
      for (const permName of viewerPermissions) {
        await connection.query(`
          INSERT INTO role_permissions (role_id, permission_id) 
          VALUES (?, ?)
        `, [roleMap.viewer, permissionMap[permName]]);
      }
    }

    // Crear usuario administrador por defecto si no existe
    const [adminUsers] = await connection.query('SELECT * FROM users WHERE username = ?', ['admin']);
    if (adminUsers.length === 0) {
      // Obtener el ID del rol de administrador
      const [adminRoles] = await connection.query('SELECT id FROM roles WHERE name = ?', ['admin']);
      if (adminRoles.length > 0) {
        const adminRoleId = adminRoles[0].id;
        
        // Generar hash de la contraseña
        const hashedPassword = await bcrypt.hash('admin123', 10);
        
        // Insertar usuario administrador
        await connection.query(`
          INSERT INTO users (username, email, password, full_name, role_id, is_active) 
          VALUES (?, ?, ?, ?, ?, ?)
        `, ['admin', 'admin@example.com', hashedPassword, 'Administrador', adminRoleId, 1]);
        
        console.log('Usuario administrador creado con éxito (usuario: admin, contraseña: admin123)');
      }
    }

    console.log('Tablas creadas correctamente');
  } catch (error) {
    console.error('Error al crear las tablas:', error);
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Obtiene una conexión del pool para ejecutar consultas
 */
const getConnection = async () => {
  return await pool.getConnection();
};

/**
 * Ejecuta una consulta SQL y devuelve los resultados
 */
const query = async (sql, params) => {
  return await pool.query(sql, params);
};

module.exports = {
  connectDatabase,
  getConnection,
  query
}; 