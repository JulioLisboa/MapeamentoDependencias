# MapeamentoDependencias

## 1. Visão geral

O projeto consiste no desenvolvimento de uma aplicação web para cadastro, consulta e visualização de dependências entre sistemas.

A aplicação utilizará dois bancos de dados:

- **MySQL:** responsável pelo armazenamento dos dados cadastrais dos sistemas, consultas, procedures e views.
- **Neo4j:** responsável pelo armazenamento e pela consulta dos relacionamentos entre os sistemas, permitindo identificar dependências diretas, indiretas e sistemas impactados.

O objetivo é permitir que o usuário visualize como os sistemas se relacionam e identifique quais outros sistemas podem ser afetados caso determinado sistema apresente uma falha.

## 2. Escopo da aplicação

A aplicação deverá possuir somente duas telas:

1. Cadastro de sistemas.
2. Consulta de sistemas e visualização de dependências.

Não será necessário desenvolver CRUD para dependências separadamente. As dependências serão selecionadas durante o cadastro do sistema.

## 3. Arquitetura e responsabilidades

### 3.1 MySQL

O MySQL será o banco principal da aplicação.

Será responsável por:

- Armazenar os dados cadastrais dos sistemas.
- Gerar identificadores únicos para os sistemas.
- Disponibilizar procedures para cadastro e consulta.
- Disponibilizar views para consulta detalhada e resumo de criticidade.

Objetos que deverão ser utilizados:

| Objeto | Finalidade |
|---|---|
| `sp_cadastrar_sistema(...)` | Cadastrar um sistema e gerar seu código |
| `sp_consultar_sistemas(...)` | Consultar sistemas com filtros |
| `vw_sistemas_detalhado` | Disponibilizar os dados detalhados dos sistemas |
| `vw_resumo_criticidade` | Disponibilizar o quantitativo por criticidade |

### 3.2 Neo4j

O Neo4j será utilizado exclusivamente para representar os relacionamentos entre os sistemas.

Modelo de dados:

**Nó:**

```cypher
(:Sistema {
    codigo: 'SIS-000001'
})
```

**Relacionamento:**

```cypher
(:Sistema)-[:DEPENDE_DE]->(:Sistema)
```

O código armazenado no nó deverá corresponder ao identificador gerado pelo MySQL.

Não é necessário duplicar no Neo4j os dados cadastrais completos dos sistemas.

## 4. Tela 1 — Cadastro de sistemas

### 4.1 Objetivo

Permitir o cadastro de um sistema e a seleção dos sistemas dos quais ele depende.

### 4.2 Campos do formulário

Os campos deverão seguir a estrutura definida no banco MySQL:

- Nome do sistema.
- Descrição.
- Ambiente.
- Status.
- Criticidade.
- Dependências (seleção de sistemas já cadastrados).

Os campos deverão respeitar os tipos e valores aceitos pela estrutura do banco de dados.

### 4.3 Fluxo de cadastro

Ao clicar no botão **Cadastrar**, a aplicação deverá executar as seguintes operações:

**Etapa 1 — Cadastro no MySQL**

Chamar a procedure `sp_cadastrar_sistema(...)`, enviando os dados preenchidos pelo usuário.

A procedure deverá devolver o código gerado por meio do parâmetro de saída `p_codigo`.

Exemplo:

```text
SIS-000001
```

**Etapa 2 — Criação do nó no Neo4j**

Com o código retornado pelo MySQL, criar o nó correspondente no Neo4j.

```cypher
CREATE (:Sistema {
    codigo: 'SIS-000001'
});
```

**Etapa 3 — Criação dos relacionamentos**

Para cada dependência selecionada no formulário, criar um relacionamento `DEPENDE_DE` entre o sistema recém-cadastrado e o sistema selecionado.

Exemplo:

```cypher
MATCH (a:Sistema {codigo: 'SIS-000001'})
MATCH (b:Sistema {codigo: 'SIS-000002'})
CREATE (a)-[:DEPENDE_DE]->(b);
```

A operação deverá ser executada para cada dependência selecionada.

### 4.4 Regras importantes

- Somente sistemas previamente cadastrados poderão ser selecionados como dependências.
- Um sistema não poderá depender de si mesmo.
- O código do sistema deverá ser gerado pelo MySQL.
- O relacionamento deverá utilizar os códigos dos sistemas.
- Caso ocorra falha na integração com o Neo4j, a aplicação deverá tratar o erro e evitar apresentar o cadastro como concluído com sucesso.
- A aplicação deverá impedir duplicidade de relacionamentos.

## 5. Tela 2 — Consulta de sistemas

### 5.1 Objetivo

Permitir consultar os sistemas cadastrados, aplicar filtros, visualizar um resumo de criticidade e explorar seus relacionamentos.

A tela deverá possuir três áreas principais.

### 5.2 Listagem e filtros

Disponibilizar os seguintes filtros:

- Busca por nome ou código.
- Ambiente.
- Status.
- Criticidade.

A consulta deverá ser realizada por meio da procedure:

```sql
CALL sp_consultar_sistemas(
    busca,
    ambiente,
    status,
    criticidade
);
```

Quando um filtro não for utilizado, deverá ser enviado `NULL` ou `''`, conforme a implementação da procedure.

Os resultados deverão ser apresentados em uma tabela contendo as principais informações dos sistemas.

### 5.3 Resumo de criticidade

Disponibilizar indicadores com a quantidade de sistemas por nível de criticidade.

A consulta deverá utilizar:

```sql
SELECT * FROM vw_resumo_criticidade;
```

Os dados poderão ser apresentados em cards ou gráficos.

Exemplo:

| Criticidade | Quantidade |
|---|---:|
| Alta | 5 |
| Média | 8 |
| Baixa | 3 |

Os valores acima são apenas ilustrativos.

### 5.4 Visualização do grafo de dependências

Na listagem, o usuário deverá poder selecionar um sistema e acionar a opção **Visualizar dependências**.

A aplicação deverá consultar o Neo4j para identificar:

1. **Dependências diretas:** sistemas dos quais o sistema selecionado depende diretamente.
2. **Dependências indiretas:** sistemas alcançados por meio de outros relacionamentos de dependência.
3. **Sistemas impactados:** sistemas que dependem direta ou indiretamente do sistema selecionado.

A consulta deverá considerar a direção dos relacionamentos `DEPENDE_DE`.

O Neo4j deverá retornar os códigos dos sistemas encontrados.

Com esses códigos, a aplicação deverá consultar o MySQL para recuperar os dados completos:

```sql
SELECT *
FROM vw_sistemas_detalhado
WHERE codigo IN (...);
```

A aplicação deverá combinar os dados retornados pelos dois bancos para apresentar o grafo com informações legíveis, como nome e código dos sistemas.

**Importante:** o grafo deverá ser renderizado na própria aplicação. O Neo4j é responsável por consultar e devolver os relacionamentos, mas a interface deverá apresentar a visualização gráfica.

## 6. Regras de negócio

- Cada sistema deverá possuir um código único gerado pelo MySQL.
- O MySQL será a fonte oficial dos dados cadastrais.
- O Neo4j armazenará os nós identificados pelo código e seus relacionamentos.
- Um sistema poderá possuir nenhuma, uma ou várias dependências.
- Um sistema poderá ser dependência de vários outros sistemas.
- Não deverá existir relacionamento de um sistema com ele mesmo.
- A consulta de dependências deverá permitir identificar relações em múltiplos níveis.
- A consulta de sistemas impactados deverá percorrer os relacionamentos no sentido inverso.
- A aplicação deverá tratar falhas de comunicação entre os bancos.

## 7. Fluxo geral da aplicação

### Cadastro

```text
Usuário preenche o formulário
          |
          v
MySQL: sp_cadastrar_sistema()
          |
          v
Retorna código do sistema
          |
          v
Neo4j: cria nó Sistema
          |
          v
Neo4j: cria relacionamentos
          |
          v
Cadastro concluído
```

### Consulta

```text
Usuário acessa a tela de consulta
          |
          v
MySQL: consulta sistemas e filtros
          |
          v
MySQL: consulta resumo de criticidade
          |
          v
Usuário seleciona um sistema
          |
          v
Neo4j: consulta dependências e impactados
          |
          v
Retorna códigos dos sistemas
          |
          v
MySQL: busca detalhes na view
          |
          v
Aplicação apresenta o grafo
```

## 8. Requisitos técnicos

O desenvolvedor deverá:

- Implementar a comunicação com o MySQL.
- Implementar a comunicação com o Neo4j.
- Utilizar as procedures e views existentes no MySQL, evitando reproduzir sua lógica na aplicação.
- Implementar a criação de nós e relacionamentos no Neo4j.
- Implementar consultas de dependências diretas, indiretas e sistemas impactados.
- Implementar a integração dos resultados dos dois bancos.
- Desenvolver as duas telas previstas.
- Implementar tratamento de erros e validações.
- Utilizar parâmetros nas consultas para evitar SQL Injection e Cypher Injection.
- Não armazenar credenciais dos bancos diretamente no código-fonte.


## 9. Resultado esperado

Uma aplicação web simples, com duas telas, que permita cadastrar sistemas e suas dependências, consultar os registros e visualizar graficamente os relacionamentos entre eles.

O projeto deverá demonstrar a integração entre um banco de dados relacional (MySQL) e um banco de dados orientado a grafos (Neo4j), utilizando cada tecnologia para sua finalidade específica.

Iniciar Containers:
```text
docker compose up -d
```


