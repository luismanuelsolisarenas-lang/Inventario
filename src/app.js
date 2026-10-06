import express from 'express';
import { createReportService, ValidationError } from './services/report.service.js';
import { createReportRouter } from './routes/report.routes.js';

export function createApp(repository, logger = console) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/health', async (_req, res) => {
    try {
      await repository.ping();
      res.json({ status: 'ok', database: 'up' });
    } catch {
      res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Base de datos no disponible' } });
    }
  });
  app.use('/api/v1/reportes', createReportRouter(createReportService(repository)));
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } }));
  app.use((err, _req, res, _next) => {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: { code: 'INVALID_FILTER', message: err.message } });
    }
    logger.error('Error al generar reporte:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'No fue posible generar el reporte' } });
  });
  return app;
}
