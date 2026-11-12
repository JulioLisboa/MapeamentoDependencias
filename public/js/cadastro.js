import { api, preencherSelect, rotulo, el, atualizarStatusBancos } from './comum.js';

const form = document.getElementById('form-cadastro');
const alerta = document.getElementById('alerta');
const btn = document.getElementById('btn-cadastrar');
const listaDeps = document.getElementById('deps-lista');
const buscaDeps = document.getElementById('busca-deps');
const chipsDeps = document.getElementById('deps-chips');

let sistemas = [];
const selecionadas = new Set();

function mostrarAlerta(tipo, mensagem) {
  alerta.className = `alerta ${tipo}`;
  alerta.replaceChildren(el('div', {}, ...(Array.isArray(mensagem) ? mensagem : [mensagem])));
  alerta.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
const ocultarAlerta = () => alerta.classList.add('oculto');

function limparErros() {
  form.querySelectorAll('.campo').forEach((c) => {
    c.classList.remove('invalido');
    c.querySelector('.erro-campo').textContent = '';
  });
}

function marcarErros(erros = {}) {
  for (const [campo, msg] of Object.entries(erros)) {
    const c = form.querySelector(`.campo[data-campo="${campo}"]`);
    if (!c) continue;
    c.classList.add('invalido');
    c.querySelector('.erro-campo').textContent = msg;
  }
  form.querySelector('.campo.invalido input, .campo.invalido select, .campo.invalido textarea')?.focus();
}

function renderDeps() {
  const termo = buscaDeps.value.trim().toLowerCase();
  const filtrados = sistemas.filter(
    (s) => !termo || s.nome.toLowerCase().includes(termo) || s.codigo.toLowerCase().includes(termo),
  );
  if (!filtrados.length) {
    listaDeps.replaceChildren(el('div', { class: 'vazio' },
      sistemas.length ? 'Nenhum sistema encontrado.' : 'Nenhum sistema cadastrado ainda.'));
  } else {
    listaDeps.replaceChildren(...filtrados.map((s) => {
      const cb = el('input', { type: 'checkbox', value: s.codigo });
      cb.checked = selecionadas.has(s.codigo);
      const label = el('label', { class: cb.checked ? 'marcado' : '' }, cb,
        el('span', { class: 'nome-dep' }, s.nome),
        el('span', { class: `badge ${s.criticidade}` }, rotulo(s.criticidade)),
        el('span', { class: 'codigo' }, `${s.codigo} · ${rotulo(s.ambiente)}`));
      cb.addEventListener('change', () => {
        if (cb.checked) selecionadas.add(s.codigo); else selecionadas.delete(s.codigo);
        label.classList.toggle('marcado', cb.checked);
        renderChips();
      });
      return label;
    }));
  }
  renderChips();
}

function renderChips() {
  const porCodigo = Object.fromEntries(sistemas.map((s) => [s.codigo, s]));
  chipsDeps.replaceChildren(...[...selecionadas].map((c) => el('span', { class: 'chip' },
    porCodigo[c]?.nome ?? c,
    el('button', {
      type: 'button',
      title: 'Remover',
      'aria-label': `Remover ${porCodigo[c]?.nome ?? c}`,
      onclick: () => { selecionadas.delete(c); renderDeps(); },
    }, '×'))));
}

async function carregarSistemas() {
  // Somente sistemas já cadastrados podem ser selecionados como dependência.
  sistemas = await api('/api/sistemas');
  sistemas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  for (const c of [...selecionadas]) if (!sistemas.some((s) => s.codigo === c)) selecionadas.delete(c);
  renderDeps();
}

async function carregarOpcoes() {
  const op = await api('/api/opcoes');
  preencherSelect(form.tipo, op.tipos, { valorPadrao: 'APLICACAO' });
  preencherSelect(form.ambiente, op.ambientes, { valorPadrao: 'PRODUCAO' });
  preencherSelect(form.status, op.status, { valorPadrao: 'ATIVO' });
  preencherSelect(form.criticidade, op.criticidades, { valorPadrao: 'MEDIA' });
  preencherSelect(form.responsavel_id,
    op.responsaveis.map((r) => ({ valor: r.id, texto: `${r.nome} (${r.id})` })),
    { vazio: 'Selecione…' });
}

function validarLocal(dados) {
  const erros = {};
  if (!dados.nome) erros.nome = 'Informe o nome do sistema.';
  if (!dados.departamento) erros.departamento = 'Informe o departamento.';
  if (!dados.responsavel_id) erros.responsavel_id = 'Selecione o responsável.';
  if (dados.url && !form.url.checkValidity()) erros.url = 'URL inválida (use http:// ou https://).';
  return erros;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  ocultarAlerta();
  limparErros();

  const fd = new FormData(form);
  const dados = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim()]));
  dados.dependencias = [...selecionadas];

  const erros = validarLocal(dados);
  if (Object.keys(erros).length) {
    marcarErros(erros);
    mostrarAlerta('erro', 'Verifique os campos destacados.');
    return;
  }

  btn.disabled = true;
  btn.replaceChildren(el('span', { class: 'spinner' }), 'Cadastrando…');
  try {
    const r = await api('/api/sistemas', { method: 'POST', body: JSON.stringify(dados) });
    const qtd = r.dependencias.length;
    form.reset();
    selecionadas.clear();
    buscaDeps.value = '';
    await carregarSistemas();
    mostrarAlerta('sucesso', [
      'Sistema ', el('strong', {}, r.sistema?.nome ?? dados.nome), ' cadastrado com o código ',
      el('strong', {}, r.codigo), qtd ? ` e ${qtd} dependência${qtd > 1 ? 's' : ''} registrada${qtd > 1 ? 's' : ''}. ` : '. ',
      el('a', { href: `/consulta?sistema=${encodeURIComponent(r.codigo)}` }, 'Ver no grafo →'),
    ]);
    form.nome.focus();
  } catch (err) {
    marcarErros(err.detalhes);
    mostrarAlerta('erro', `Cadastro não concluído: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cadastrar';
  }
});

form.addEventListener('reset', () => {
  ocultarAlerta();
  limparErros();
  selecionadas.clear();
  buscaDeps.value = '';
  setTimeout(renderDeps);
});

buscaDeps.addEventListener('input', renderDeps);

(async () => {
  atualizarStatusBancos();
  try {
    await Promise.all([carregarOpcoes(), carregarSistemas()]);
  } catch (err) {
    mostrarAlerta('erro', `Falha ao carregar dados: ${err.message}`);
    btn.disabled = true;
  }
})();
