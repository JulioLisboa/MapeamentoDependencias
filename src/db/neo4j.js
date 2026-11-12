import neo4j from 'neo4j-driver';

export const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://127.0.0.1:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || ''),
  { disableLosslessIntegers: true },
);

/** Garante unicidade do código do nó :Sistema. */
export async function ensureSchema() {
  const session = driver.session();
  try {
    await session.run(
      'CREATE CONSTRAINT sistema_codigo_unico IF NOT EXISTS FOR (s:Sistema) REQUIRE s.codigo IS UNIQUE',
    );
  } finally {
    await session.close();
  }
}

/**
 * Executa as etapas 2 e 3 do cadastro em uma transação explícita do Neo4j.
 * Retorna a transação aberta para que o chamador decida commit/rollback
 * em conjunto com a transação do MySQL.
 */
export async function criarNoComDependencias(session, codigo, dependencias) {
  const tx = session.beginTransaction();
  try {
    await tx.run('CREATE (:Sistema {codigo: $codigo})', { codigo });

    if (dependencias.length) {
      const result = await tx.run(
        `MATCH (a:Sistema {codigo: $codigo})
         UNWIND $dependencias AS dep
         MATCH (b:Sistema {codigo: dep})
         WHERE b <> a
         MERGE (a)-[:DEPENDE_DE]->(b)
         RETURN collect(b.codigo) AS criadas`,
        { codigo, dependencias },
      );
      const criadas = result.records[0]?.get('criadas') ?? [];
      const faltando = dependencias.filter((d) => !criadas.includes(d));
      if (faltando.length) {
        const err = new Error(`Dependências não encontradas no Neo4j: ${faltando.join(', ')}`);
        err.status = 422;
        throw err;
      }
    }
    return tx;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

/** Remove um nó (compensação caso o commit do MySQL falhe após o commit no Neo4j). */
export async function removerNo(codigo) {
  const session = driver.session();
  try {
    await session.run('MATCH (s:Sistema {codigo: $codigo}) DETACH DELETE s', { codigo });
  } finally {
    await session.close();
  }
}

/**
 * Consulta dependências diretas, indiretas e sistemas impactados,
 * respeitando a direção de DEPENDE_DE, e as arestas entre os nós envolvidos.
 */
export async function consultarGrafo(codigo) {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(
      `MATCH (s:Sistema {codigo: $codigo})
       OPTIONAL MATCH (s)-[:DEPENDE_DE]->(d:Sistema)
       WITH s, collect(DISTINCT d.codigo) AS diretas
       OPTIONAL MATCH (s)-[:DEPENDE_DE*2..]->(i:Sistema)
       WHERE i <> s AND NOT i.codigo IN diretas
       WITH s, diretas, collect(DISTINCT i.codigo) AS indiretas
       OPTIONAL MATCH (imp:Sistema)-[:DEPENDE_DE*1..]->(s)
       WHERE imp <> s
       WITH s, diretas, indiretas, collect(DISTINCT imp.codigo) AS impactados
       WITH s, diretas, indiretas, impactados,
            [s.codigo] + diretas + indiretas + impactados AS todos
       OPTIONAL MATCH (a:Sistema)-[:DEPENDE_DE]->(b:Sistema)
       WHERE a.codigo IN todos AND b.codigo IN todos
       RETURN diretas, indiretas, impactados,
              collect(DISTINCT {de: a.codigo, para: b.codigo}) AS arestas`,
      { codigo },
    );
    if (!result.records.length) return null;
    const r = result.records[0];
    return {
      diretas: r.get('diretas'),
      indiretas: r.get('indiretas'),
      impactados: r.get('impactados'),
      arestas: r.get('arestas').filter((e) => e.de && e.para),
    };
  } finally {
    await session.close();
  }
}
