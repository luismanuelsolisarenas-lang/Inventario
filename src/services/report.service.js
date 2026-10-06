export class ValidationError extends Error {}

export function parseFilters(query) {
  const allowed = new Set(['categoriaId', 'stockBajo']);
  for (const key of Object.keys(query)) {
    if (!allowed.has(key)) throw new ValidationError(`Filtro desconocido: ${key}`);
  }
  const filters = {};
  if (query.categoriaId !== undefined) {
    if (typeof query.categoriaId !== 'string' || !/^[1-9]\d*$/.test(query.categoriaId)
        || Number(query.categoriaId) > 4294967295) {
      throw new ValidationError('categoriaId debe ser un entero positivo válido');
    }
    filters.categoriaId = Number(query.categoriaId);
  }
  if (query.stockBajo !== undefined) {
    if (!['true', 'false'].includes(query.stockBajo)) {
      throw new ValidationError('stockBajo debe ser true o false');
    }
    filters.stockBajo = query.stockBajo === 'true';
  }
  return filters;
}

// DECIMAL de MySQL se recibe como texto. BigInt evita redondear dinero.
function cents(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function money(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

export function createReportService(repository) {
  return {
    async generate(filters) {
      const rows = await repository.findProducts(filters);
      let total = 0n;
      let units = 0n;
      const productos = rows.map(row => {
        const value = cents(row.precioUnitario) * BigInt(row.stock);
        total += value;
        units += BigInt(row.stock);
        return { ...row, precioUnitario: money(cents(row.precioUnitario)),
          valorTotal: money(value), stockBajo: row.stock <= row.stockMinimo };
      });
      return {
        generadoEn: new Date().toISOString(),
        filtros: { categoriaId: filters.categoriaId ?? null, stockBajo: filters.stockBajo ?? false },
        resumen: {
          totalProductos: productos.length,
          totalUnidades: units.toString(),
          valorInventario: money(total),
          productosStockBajo: productos.filter(p => p.stockBajo).length,
          productosSinStock: productos.filter(p => p.stock === 0).length
        },
        productos
      };
    }
  };
}
