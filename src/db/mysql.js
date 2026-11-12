import mysql from 'mysql2/promise';

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Variável de ambiente ${name} não definida (veja .env.example)`);
  }
  return value;
}

export const pool = mysql.createPool({
  host: required('MYSQL_HOST'),
  port: Number(process.env.MYSQL_PORT || 3306),
  database: required('MYSQL_DATABASE'),
  user: required('MYSQL_USER'),
  password: required('MYSQL_PASSWORD'),
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

/** Lê os valores aceitos por uma coluna ENUM diretamente da estrutura do banco. */
export async function enumValues(table, column) {
  const [rows] = await pool.execute(
    `SELECT COLUMN_TYPE AS tipo
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  if (!rows.length) return [];
  const match = /^enum\((.*)\)$/i.exec(rows[0].tipo);
  if (!match) return [];
  return [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

/** Busca dados completos dos sistemas na view, a partir de uma lista de códigos. */
export async function sistemasPorCodigos(codigos) {
  if (!codigos.length) return [];
  const placeholders = codigos.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT * FROM vw_sistemas_detalhado WHERE codigo IN (${placeholders})`,
    codigos,
  );
  return rows;
}
