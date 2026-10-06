export function createInventoryRepository(pool) {
  return {
    async ping() { await pool.query('SELECT 1'); },
    async findProducts({ categoriaId, stockBajo }) {
      const conditions = [];
      const params = [];
      if (categoriaId !== undefined) {
        conditions.push('p.categoria_id = ?');
        params.push(categoriaId);
      }
      if (stockBajo) conditions.push('p.stock <= p.stock_minimo');
      // Únicamente fragmentos fijos de SQL; los valores externos son parámetros.
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [rows] = await pool.execute(`
        SELECT p.id, p.sku, p.nombre, p.categoria_id AS categoriaId,
               c.nombre AS categoria, p.stock, p.stock_minimo AS stockMinimo,
               p.precio_unitario AS precioUnitario
        FROM productos p JOIN categorias c ON c.id = p.categoria_id
        ${where} ORDER BY p.id`, params);
      return rows;
    }
  };
}
