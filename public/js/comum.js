/* Utilitários compartilhados pelas duas telas. */

export async function api(url, options = {}) {
  let resp;
  try {
    resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw Object.assign(new Error('Não foi possível comunicar com o servidor.'), { detalhes: null });
  }
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw Object.assign(new Error(corpo.erro || `Erro ${resp.status}`), {
      status: resp.status,
      detalhes: corpo.detalhes,
    });
  }
  return corpo;
}

/** Converte valores ENUM (ex.: EM_MANUTENCAO) em texto legível. */
const ROTULOS = {
  PRODUCAO: 'Produção', HOMOLOGACAO: 'Homologação', DESENVOLVIMENTO: 'Desenvolvimento', TESTE: 'Teste',
  ATIVO: 'Ativo', INATIVO: 'Inativo', EM_MANUTENCAO: 'Em manutenção', DESCONTINUADO: 'Descontinuado',
  BAIXA: 'Baixa', MEDIA: 'Média', ALTA: 'Alta', CRITICA: 'Crítica',
  APLICACAO: 'Aplicação', API: 'API', BANCO_DE_DADOS: 'Banco de dados',
  INFRAESTRUTURA: 'Infraestrutura', SERVICO_EXTERNO: 'Serviço externo', OUTRO: 'Outro',
};
export const rotulo = (v) => ROTULOS[v] ?? v ?? '';

export function preencherSelect(select, valores, { vazio, valorPadrao } = {}) {
  select.replaceChildren();
  if (vazio !== undefined) select.append(new Option(vazio, ''));
  for (const v of valores) {
    const [valor, texto] = typeof v === 'object' ? [v.valor, v.texto] : [v, rotulo(v)];
    select.append(new Option(texto, valor, false, valor === valorPadrao));
  }
}

export function el(tag, attrs = {}, ...filhos) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...filhos.filter((f) => f !== null && f !== undefined));
  return node;
}

export async function atualizarStatusBancos() {
  const alvo = document.querySelector('.status-bancos');
  if (!alvo) return;
  let st = { mysql: false, neo4j: false };
  try {
    const r = await fetch('/api/health');
    st = await r.json();
  } catch { /* servidor indisponível */ }
  alvo.replaceChildren(
    el('span', { class: st.mysql ? 'ok' : 'falha' }, 'MySQL'),
    el('span', { class: st.neo4j ? 'ok' : 'falha' }, 'Neo4j'),
  );
}
