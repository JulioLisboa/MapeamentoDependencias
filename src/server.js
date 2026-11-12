import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sistemasRouter from './routes/sistemas.js';
import { pool } from './db/mysql.js';
import { driver, ensureSchema } from './db/neo4j.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.get('/api/health', async (_req, res) => {
  const status = { mysql: false, neo4j: false };
  try { await pool.query('SELECT 1'); status.mysql = true; } catch { /* indisponível */ }
  try { await driver.verifyConnectivity(); status.neo4j = true; } catch { /* indisponível */ }
  res.status(status.mysql && status.neo4j ? 200 : 503).json(status);
});

app.use('/api', sistemasRouter);

app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// Tratamento centralizado de erros
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err.cause ?? err);
  let mensagem = err.status ? err.message : 'Erro interno ao processar a solicitação.';
  if (!err.status && ['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT'].includes(err.code)) {
    mensagem = 'Não foi possível comunicar com o MySQL.';
  }
  res.status(status).json({ erro: mensagem, detalhes: err.detalhes });
});

const port = Number(process.env.PORT || 3000);

ensureSchema()
  .catch((err) => console.warn('Aviso: não foi possível criar a constraint no Neo4j:', err.message))
  .finally(() => {
    app.listen(port, () => console.log(`Aplicação disponível em http://localhost:${port}`));
  });

const shutdown = async () => {
  await Promise.allSettled([pool.end(), driver.close()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
