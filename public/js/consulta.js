import { api, preencherSelect, rotulo, el, atualizarStatusBancos } from './comum.js';

const formFiltros = document.getElementById('form-filtros');
const alerta = document.getElementById('alerta');
const corpo = document.getElementById('tabela-corpo');
const qtdResultados = document.getElementById('qtd-resultados');
const indicadores = document.getElementById('indicadores');
const resumoCtx = document.getElementById('resumo-ctx');
const secaoGrafo = document.getElementById('secao-grafo');

let rede = null;
let selecionado = null;

const CORES = {
  selecionado: { background: '#172033', border: '#0b1020', font: '#ffffff' },
  direta: { background: '#4f46e5', border: '#3730a3', font: '#ffffff' },
  indireta: { background: '#8b93b8', border: '#6b7397', font: '#ffffff' },
  impactado: { background: '#d33a3a', border: '#a82626', font: '#ffffff' },
};

function mostrarErro(msg) {
  alerta.textContent = msg;
  alerta.classList.remove('oculto');
}
const ocultarErro = () => alerta.classList.add('oculto');

const filtrosAtuais = () => Object.fromEntries(
  [...new FormData(formFiltros).entries()].filter(([, v]) => String(v).trim() !== ''),
);

/* ---------- Listagem (sp_consultar_sistemas) ---------- */

async function carregarSistemas() {
  const qs = new URLSearchParams(filtrosAtuais());
  corpo.replaceChildren(el('tr', {}, el('td', { colspan: 9, class: 'vazio' }, 'Carregando…')));
  try {
    const lista = await api(`/api/sistemas?${qs}`);
    qtdResultados.textContent = `(${lista.length})`;
    if (!lista.length) {
      corpo.replaceChildren(el('tr', {}, el('td', { colspan: 9, class: 'vazio' }, 'Nenhum sistema encontrado.')));
      return;
    }
    corpo.replaceChildren(...lista.map((s) => el('tr', {
      class: s.codigo === selecionado ? 'selecionado' : '',
      'data-codigo': s.codigo,
      title: 'Clique para visualizar as dependências',
      onclick: () => visualizar(s.codigo),
    },
      el('td', { class: 'codigo' }, s.codigo),
      el('td', {}, el('strong', {}, s.nome), s.descricao ? el('div', { class: 'desc', title: s.descricao }, s.descricao) : null),
      el('td', {}, rotulo(s.tipo)),
      el('td', {}, rotulo(s.ambiente)),
      el('td', {}, el('span', { class: `status ${s.status}` }, rotulo(s.status))),
      el('td', {}, el('span', { class: `badge ${s.criticidade}` }, rotulo(s.criticidade))),
      el('td', {}, s.departamento),
      el('td', {}, s.responsavel),
      el('td', {}, el('button', {
        type: 'button',
        class: 'pequeno fantasma',
        onclick: (ev) => { ev.stopPropagation(); visualizar(s.codigo); },
      }, 'Visualizar dependências')),
    )));
  } catch (err) {
    qtdResultados.textContent = '';
    corpo.replaceChildren(el('tr', {}, el('td', { colspan: 9, class: 'vazio' }, 'Não foi possível carregar os sistemas.')));
    mostrarErro(err.message);
  }
}

/* ---------- Resumo de criticidade (vw_resumo_criticidade) ---------- */

async function carregarResumo() {
  const { ambiente, status } = filtrosAtuais();
  const qs = new URLSearchParams(Object.entries({ ambiente, status }).filter(([, v]) => v));
  const ctx = [ambiente && rotulo(ambiente), status && rotulo(status)].filter(Boolean);
  resumoCtx.textContent = ctx.length ? `(${ctx.join(' · ')})` : '(todos)';
  try {
    const resumo = await api(`/api/resumo-criticidade?${qs}`);
    const total = resumo.reduce((acc, r) => acc + r.quantidade, 0);
    indicadores.replaceChildren(
      ...[...resumo].reverse().map((r) => el('div', { class: `indicador ${r.criticidade}` },
        el('div', { class: 'rotulo' }, rotulo(r.criticidade)),
        el('div', { class: 'valor' }, String(r.quantidade)),
        el('div', { class: 'barra' }, el('i', { style: `width:${total ? (r.quantidade / total) * 100 : 0}%` })))),
      el('div', { class: 'indicador total' },
        el('div', { class: 'rotulo' }, 'Total'),
        el('div', { class: 'valor' }, String(total))),
    );
  } catch (err) {
    indicadores.replaceChildren(el('div', { class: 'codigo' }, 'Resumo indisponível.'));
    mostrarErro(err.message);
  }
}

/* ---------- Grafo (Neo4j + MySQL) ---------- */

function preencherLista(id, itens) {
  const n = document.getElementById(`n-${id}`);
  n.className = 'contador';
  n.textContent = String(itens.length);
  const ul = document.getElementById(`l-${id}`);
  ul.replaceChildren(...(itens.length
    ? itens.map((s) => el('li', {}, s.nome, ' ', el('span', { class: 'codigo' }, s.codigo)))
    : [el('li', { class: 'vazio' }, 'Nenhum')]));
}

function rotuloNo(s) {
  return `${s.nome ?? ''}\n${s.codigo}`;
}

function tooltip(s, categoria) {
  const div = document.createElement('div');
  div.style.cssText = 'font:13px system-ui;line-height:1.5';
  const linhas = [
    ['', `${s.nome} (${s.codigo})`], ['Categoria', categoria],
    ['Ambiente', rotulo(s.ambiente)], ['Status', rotulo(s.status)],
    ['Criticidade', rotulo(s.criticidade)], ['Responsável', s.responsavel],
  ];
  for (const [k, v] of linhas) {
    if (!v) continue;
    div.append(el('div', {}, k ? el('b', {}, `${k}: `) : null, k ? v : el('b', {}, v)));
  }
  return div;
}

function desenharGrafo(dados) {
  if (typeof vis === 'undefined') {
    document.getElementById('grafo').textContent = 'Biblioteca de visualização indisponível (sem acesso à internet?).';
    return;
  }
  const nos = new Map();
  const add = (s, cat, nome) => {
    if (nos.has(s.codigo)) return;
    nos.set(s.codigo, {
      id: s.codigo,
      label: rotuloNo(s),
      color: { ...CORES[cat], highlight: CORES[cat], hover: CORES[cat] },
      font: { color: CORES[cat].font, multi: false },
      title: tooltip(s, nome),
      borderWidth: cat === 'selecionado' ? 3 : 1,
      shape: 'box',
      shapeProperties: { borderRadius: 8 },
      margin: { top: 10, bottom: 10, left: 14, right: 14 },
      shadow: { enabled: true, color: 'rgba(16,24,40,.15)', size: 8, x: 0, y: 2 },
    });
  };
  add(dados.sistema, 'selecionado', 'Sistema selecionado');
  dados.diretas.forEach((s) => add(s, 'direta', 'Dependência direta'));
  dados.indiretas.forEach((s) => add(s, 'indireta', 'Dependência indireta'));
  dados.impactados.forEach((s) => add(s, 'impactado', 'Sistema impactado'));

  const arestas = dados.arestas.map((a, i) => ({
    id: i, from: a.de, to: a.para, arrows: 'to',
    color: { color: '#a3abbd', highlight: '#172033', hover: '#172033' },
    width: 1.5,
  }));

  const container = document.getElementById('grafo');
  rede?.destroy();
  rede = new vis.Network(container,
    { nodes: new vis.DataSet([...nos.values()]), edges: new vis.DataSet(arestas) },
    {
      layout: { hierarchical: { direction: 'UD', sortMethod: 'directed', levelSeparation: 110, nodeSpacing: 180 } },
      physics: false,
      interaction: { hover: true, tooltipDelay: 150 },
      edges: { smooth: { type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.4 } },
    });
  rede.on('doubleClick', (p) => {
    if (p.nodes.length && p.nodes[0] !== selecionado) visualizar(p.nodes[0]);
  });
}

async function visualizar(codigo) {
  ocultarErro();
  selecionado = codigo;
  corpo.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('selecionado', tr.dataset.codigo === codigo));
  try {
    const dados = await api(`/api/sistemas/${encodeURIComponent(codigo)}/dependencias`);
    document.getElementById('grafo-titulo').textContent = `${dados.sistema.nome ?? ''} (${codigo})`;
    preencherLista('diretas', dados.diretas);
    preencherLista('indiretas', dados.indiretas);
    preencherLista('impactados', dados.impactados);
    secaoGrafo.classList.remove('oculto');
    desenharGrafo(dados);
    secaoGrafo.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    mostrarErro(`Não foi possível carregar as dependências: ${err.message}`);
  }
}

/* ---------- Inicialização ---------- */

formFiltros.addEventListener('submit', (ev) => {
  ev.preventDefault();
  ocultarErro();
  carregarSistemas();
  carregarResumo();
});
formFiltros.addEventListener('reset', () => setTimeout(() => {
  ocultarErro();
  carregarSistemas();
  carregarResumo();
}));
for (const s of formFiltros.querySelectorAll('select')) {
  s.addEventListener('change', () => formFiltros.requestSubmit());
}
let debounce;
formFiltros.busca.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => formFiltros.requestSubmit(), 350);
});
document.getElementById('btn-centralizar').addEventListener('click', () => rede?.fit({ animation: true }));
document.getElementById('btn-fechar-grafo').addEventListener('click', () => {
  secaoGrafo.classList.add('oculto');
  selecionado = null;
  corpo.querySelectorAll('tr.selecionado').forEach((tr) => tr.classList.remove('selecionado'));
});

(async () => {
  atualizarStatusBancos();
  try {
    const op = await api('/api/opcoes');
    preencherSelect(formFiltros.ambiente, op.ambientes, { vazio: 'Todos' });
    preencherSelect(formFiltros.status, op.status, { vazio: 'Todos' });
    preencherSelect(formFiltros.criticidade, op.criticidades, { vazio: 'Todas' });
  } catch (err) {
    mostrarErro(`Falha ao carregar filtros: ${err.message}`);
  }
  await Promise.all([carregarSistemas(), carregarResumo()]);
  const inicial = new URLSearchParams(location.search).get('sistema');
  if (inicial) visualizar(inicial);
})();
