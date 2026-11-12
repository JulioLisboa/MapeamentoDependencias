import { Router } from 'express';
import { pool, enumValues, sistemasPorCodigos } from '../db/mysql.js';
import { driver, criarNoComDependencias, removerNo, consultarGrafo } from '../db/neo4j.js';

const router = Router();
const CODIGO_RE = /^SIS-\d{6}$/;

class HttpError extends Error {
  constructor(status, message, detalhes) {
    super(message);
    this.status = status;
    this.detalhes = detalhes;
  }
}

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

async function carregarOpcoes() {
  const [tipos, ambientes, criticidades, status] = await Promise.all([
    enumValues('sistemas', 'tipo'),
    enumValues('sistemas', 'ambiente'),
    enumValues('sistemas', 'criticidade'),
    enumValues('sistemas', 'status'),
  ]);
  return { tipos, ambientes, criticidades, status };
}

/* ---------- Opções do formulário (valores aceitos pelo banco) ---------- */

router.get('/opcoes', wrap(async (_req, res) => {
  const opcoes = await carregarOpcoes();
  const [responsaveis] = await pool.execute(
    'SELECT id, nome FROM usuarios WHERE ativo = TRUE ORDER BY nome',
  );
  res.json({ ...opcoes, responsaveis });
}));

/* ---------- Tela 2: consulta com filtros (sp_consultar_sistemas) ---------- */

router.get('/sistemas', wrap(async (req, res) => {
  const texto = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  const params = [
    texto(req.query.busca),
    texto(req.query.ambiente),
    texto(req.query.status),
    texto(req.query.criticidade),
  ];
  if (params[0] && params[0].length > 120) throw new HttpError(400, 'Busca muito longa.');
  const [results] = await pool.query('CALL sp_consultar_sistemas(?, ?, ?, ?)', params);
  res.json(results[0]);
}));

/* ---------- Tela 2: resumo de criticidade (vw_resumo_criticidade) ---------- */

router.get('/resumo-criticidade', wrap(async (req, res) => {
  const where = [];
  const params = [];
  for (const campo of ['ambiente', 'status']) {
    const v = req.query[campo];
    if (typeof v === 'string' && v.trim() !== '') {
      where.push(`${campo} = ?`);
      params.push(v.trim());
    }
  }
  const [rows] = await pool.execute(
    `SELECT criticidade, CAST(SUM(total_sistemas) AS UNSIGNED) AS quantidade
       FROM vw_resumo_criticidade
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      GROUP BY criticidade`,
    params,
  );
  const { criticidades } = await carregarOpcoes();
  const mapa = Object.fromEntries(rows.map((r) => [r.criticidade, Number(r.quantidade)]));
  res.json(criticidades.map((c) => ({ criticidade: c, quantidade: mapa[c] ?? 0 })));
}));

/* ---------- Tela 1: cadastro (MySQL -> Neo4j nó -> Neo4j relações) ---------- */

function validarCadastro(body, opcoes) {
  const erros = {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  const dados = {
    nome: str(body.nome),
    descricao: str(body.descricao) || null,
    url: str(body.url) || null,
    tipo: str(body.tipo),
    ambiente: str(body.ambiente),
    departamento: str(body.departamento),
    responsavel_id: str(body.responsavel_id),
    criticidade: str(body.criticidade),
    status: str(body.status),
  };

  if (!dados.nome) erros.nome = 'Informe o nome do sistema.';
  else if (dados.nome.length > 120) erros.nome = 'Máximo de 120 caracteres.';

  if (dados.url) {
    if (dados.url.length > 255) erros.url = 'Máximo de 255 caracteres.';
    else {
      try {
        const u = new URL(dados.url);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
      } catch {
        erros.url = 'URL inválida (use http:// ou https://).';
      }
    }
  }

  if (!dados.departamento) erros.departamento = 'Informe o departamento.';
  else if (dados.departamento.length > 100) erros.departamento = 'Máximo de 100 caracteres.';

  if (!dados.responsavel_id) erros.responsavel_id = 'Selecione o responsável.';

  const enums = { tipo: 'tipos', ambiente: 'ambientes', criticidade: 'criticidades', status: 'status' };
  for (const [campo, chave] of Object.entries(enums)) {
    if (!opcoes[chave].includes(dados[campo])) erros[campo] = 'Valor inválido.';
  }

  let dependencias = body.dependencias ?? [];
  if (!Array.isArray(dependencias) || dependencias.some((d) => typeof d !== 'string' || !CODIGO_RE.test(d))) {
    erros.dependencias = 'Lista de dependências inválida.';
    dependencias = [];
  }
  // Impede relacionamentos duplicados vindos do formulário.
  dependencias = [...new Set(dependencias)];

  return { dados, dependencias, erros };
}

router.post('/sistemas', wrap(async (req, res) => {
  const opcoes = await carregarOpcoes();
  const { dados, dependencias, erros } = validarCadastro(req.body ?? {}, opcoes);
  if (Object.keys(erros).length) throw new HttpError(400, 'Verifique os campos do formulário.', erros);

  // Somente sistemas previamente cadastrados podem ser dependências.
  if (dependencias.length) {
    const existentes = (await sistemasPorCodigos(dependencias)).map((s) => s.codigo);
    const faltando = dependencias.filter((d) => !existentes.includes(d));
    if (faltando.length) {
      throw new HttpError(422, `Dependências não cadastradas: ${faltando.join(', ')}`, {
        dependencias: 'Selecione apenas sistemas já cadastrados.',
      });
    }
  }

  const conn = await pool.getConnection();
  const neoSession = driver.session();
  let codigo;
  try {
    await conn.beginTransaction();

    // Etapa 1 — MySQL: sp_cadastrar_sistema com OUT p_codigo
    await conn.query(
      'CALL sp_cadastrar_sistema(?, ?, ?, ?, ?, ?, ?, ?, ?, @p_codigo)',
      [dados.nome, dados.descricao, dados.url, dados.tipo, dados.ambiente,
        dados.departamento, dados.responsavel_id, dados.criticidade, dados.status],
    );
    const [[{ codigo: gerado }]] = await conn.query('SELECT @p_codigo AS codigo');
    codigo = gerado;
    if (!codigo) throw new HttpError(500, 'O MySQL não retornou o código do sistema.');

    // Um sistema não pode depender de si mesmo (defensivo — o código é novo).
    if (dependencias.includes(codigo)) {
      throw new HttpError(422, 'Um sistema não pode depender de si mesmo.');
    }

    // Etapas 2 e 3 — Neo4j: nó + relacionamentos DEPENDE_DE
    let neoTx;
    try {
      neoTx = await criarNoComDependencias(neoSession, codigo, dependencias);
      await neoTx.commit();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const e = new HttpError(
        err.status || 502,
        'Falha na integração com o Neo4j. O cadastro foi desfeito no MySQL.',
      );
      e.cause = err;
      throw e;
    }

    // Só confirma no MySQL depois que o Neo4j confirmou.
    try {
      await conn.commit();
    } catch (err) {
      await removerNo(codigo).catch(() => {});
      throw err;
    }

    const [sistema] = await sistemasPorCodigos([codigo]);
    res.status(201).json({ codigo, sistema, dependencias });
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'Já existe um sistema com este nome neste ambiente.', {
        nome: 'Nome já utilizado neste ambiente.',
      });
    }
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      throw new HttpError(400, 'Responsável inválido.', { responsavel_id: 'Responsável não encontrado.' });
    }
    throw err;
  } finally {
    conn.release();
    await neoSession.close();
  }
}));

/* ---------- Tela 2: grafo de dependências (Neo4j -> MySQL) ---------- */

router.get('/sistemas/:codigo/dependencias', wrap(async (req, res) => {
  const { codigo } = req.params;
  if (!CODIGO_RE.test(codigo)) throw new HttpError(400, 'Código inválido.');

  let grafo;
  try {
    grafo = await consultarGrafo(codigo);
  } catch (err) {
    const e = new HttpError(502, 'Não foi possível consultar o Neo4j.');
    e.cause = err;
    throw e;
  }
  if (!grafo) throw new HttpError(404, `Sistema ${codigo} não encontrado no Neo4j.`);

  const codigos = [...new Set([codigo, ...grafo.diretas, ...grafo.indiretas, ...grafo.impactados])];
  const detalhes = await sistemasPorCodigos(codigos);
  const porCodigo = Object.fromEntries(detalhes.map((s) => [s.codigo, s]));
  const montar = (lista) => lista.map((c) => porCodigo[c] ?? { codigo: c, nome: '(sem cadastro no MySQL)' });

  res.json({
    sistema: porCodigo[codigo] ?? { codigo },
    diretas: montar(grafo.diretas),
    indiretas: montar(grafo.indiretas),
    impactados: montar(grafo.impactados),
    arestas: grafo.arestas,
  });
}));

export { HttpError };
export default router;
