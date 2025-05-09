const { query } = require('../config/database');

// This is a mock prisma client that uses the existing database connection
// rather than an actual Prisma ORM implementation
const prisma = {
  googleSheet: {
    findMany: async ({ orderBy } = {}) => {
      let orderClause = 'ORDER BY created_at DESC';
      
      if (orderBy && orderBy.createdAt) {
        orderClause = `ORDER BY created_at ${orderBy.createdAt === 'desc' ? 'DESC' : 'ASC'}`;
      }
      
      const [sheets] = await query(`SELECT * FROM google_sheets ${orderClause}`);
      return sheets;
    },
    findUnique: async ({ where }) => {
      const [sheets] = await query('SELECT * FROM google_sheets WHERE id = ?', [where.id]);
      return sheets.length > 0 ? sheets[0] : null;
    },
    create: async ({ data }) => {
      const [result] = await query(
        'INSERT INTO google_sheets (sheet_id, name, description, `range`, is_active) VALUES (?, ?, ?, ?, ?)',
        [data.sheetId, data.name, data.description || '', data.range || 'A:Z', data.status === 'active' ? 1 : 0]
      );
      const [newSheet] = await query('SELECT * FROM google_sheets WHERE id = ?', [result.insertId]);
      return newSheet[0];
    },
    update: async ({ where, data }) => {
      const updates = [];
      const params = [];
      
      if (data.name) {
        updates.push('name = ?');
        params.push(data.name);
      }
      if (data.sheetId) {
        updates.push('sheet_id = ?');
        params.push(data.sheetId);
      }
      if (data.description !== undefined) {
        updates.push('description = ?');
        params.push(data.description);
      }
      if (data.range) {
        updates.push('`range` = ?');
        params.push(data.range);
      }
      if (data.status) {
        updates.push('is_active = ?');
        params.push(data.status === 'active' ? 1 : 0);
      }
      
      params.push(where.id);
      
      await query(
        `UPDATE google_sheets SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
      
      const [updatedSheet] = await query('SELECT * FROM google_sheets WHERE id = ?', [where.id]);
      return updatedSheet[0];
    },
    delete: async ({ where }) => {
      await query('DELETE FROM google_sheets WHERE id = ?', [where.id]);
      return { id: where.id };
    }
  }
};

module.exports = { prisma }; 