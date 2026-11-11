CREATE DATABASE IF NOT EXISTS gerenciador_dependencias CHARACTER SET utf8mb4;

USE gerenciador_dependencias;

/* ============================ TABELAS ============================ */

/* Controle da geração de IDs (usado por fn_gerar_id) */
CREATE TABLE sequencias_id (
    prefixo      VARCHAR(5)      NOT NULL PRIMARY KEY,
    ultimo_valor BIGINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

/* AUTO_INCREMENT justificado: tabela de domínio pequena, sem dado crítico */
CREATE TABLE grupos_usuarios (
    id           SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    nome         VARCHAR(50)  NOT NULL UNIQUE,
    descricao    VARCHAR(255),
    nivel_acesso ENUM('ADMINISTRADOR','GESTOR','CONSULTA') NOT NULL DEFAULT 'CONSULTA'
) ENGINE=InnoDB;

/* ID gerado por fn_gerar_id('USR') -> USR-000001 */
CREATE TABLE usuarios (
    id         VARCHAR(20)  NOT NULL PRIMARY KEY,
    nome       VARCHAR(120) NOT NULL,
    login      VARCHAR(50)  NOT NULL UNIQUE,
    email      VARCHAR(150) NOT NULL UNIQUE,
    senha_hash VARCHAR(100) NOT NULL,         
    ativo      BOOLEAN      NOT NULL DEFAULT TRUE,
    criado_em  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE usuarios_grupos (
    usuario_id VARCHAR(20)       NOT NULL,
    grupo_id   SMALLINT UNSIGNED NOT NULL,
    PRIMARY KEY (usuario_id, grupo_id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)        ON DELETE CASCADE,
    FOREIGN KEY (grupo_id)   REFERENCES grupos_usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB;

/* ID gerado por fn_gerar_id('SIS') -> SIS-000001 (chave comum com o Neo4j) */
CREATE TABLE sistemas (
    codigo            VARCHAR(20)  NOT NULL PRIMARY KEY,
    nome              VARCHAR(120) NOT NULL,
    descricao         TEXT,
    url               VARCHAR(255),
    tipo              ENUM('APLICACAO','API','BANCO_DE_DADOS','INFRAESTRUTURA','SERVICO_EXTERNO','OUTRO') NOT NULL DEFAULT 'APLICACAO',
    ambiente          ENUM('PRODUCAO','HOMOLOGACAO','DESENVOLVIMENTO','TESTE') NOT NULL DEFAULT 'PRODUCAO',
    departamento      VARCHAR(100) NOT NULL,
    responsavel_id    VARCHAR(20)  NOT NULL,
    criticidade       ENUM('BAIXA','MEDIA','ALTA','CRITICA') NOT NULL DEFAULT 'MEDIA',
    criticidade_valor TINYINT UNSIGNED NOT NULL DEFAULT 2,   -- preenchido por trigger
    status            ENUM('ATIVO','INATIVO','EM_MANUTENCAO','DESCONTINUADO') NOT NULL DEFAULT 'ATIVO',
    criado_em         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (responsavel_id) REFERENCES usuarios (id),

    UNIQUE KEY uq_sistemas_nome_ambiente (nome, ambiente),
    KEY idx_sistemas_filtros (ambiente, status, criticidade_valor)
) ENGINE=InnoDB;

DELIMITER $$

/* Gera IDs no formato PREFIXO-NNNNNN.*/
CREATE FUNCTION fn_gerar_id(p_prefixo VARCHAR(5)) RETURNS VARCHAR(20)
NOT DETERMINISTIC MODIFIES SQL DATA SQL SECURITY DEFINER
BEGIN
    DECLARE v_prox BIGINT UNSIGNED DEFAULT NULL;
    SELECT ultimo_valor + 1 INTO v_prox FROM sequencias_id WHERE prefixo = p_prefixo FOR UPDATE;
    IF v_prox IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Prefixo de sequencia inexistente';
    END IF;
    UPDATE sequencias_id SET ultimo_valor = v_prox WHERE prefixo = p_prefixo;
    RETURN CONCAT(p_prefixo, '-', LPAD(v_prox, 6, '0'));
END$$

/* Converte criticidade em número para ordenar/priorizar: BAIXA=1, MEDIA=2, ALTA=3, CRITICA=4 */
CREATE FUNCTION fn_classificar_criticidade(p_criticidade VARCHAR(10)) RETURNS TINYINT UNSIGNED
DETERMINISTIC NO SQL
BEGIN
    RETURN CASE UPPER(p_criticidade)
        WHEN 'BAIXA' THEN 1 WHEN 'MEDIA' THEN 2 WHEN 'ALTA' THEN 3 WHEN 'CRITICA' THEN 4 ELSE 0 END;
END$$

/* ============================ TRIGGERS ============================ */

/* Gera o ID do usuário e padroniza login/e-mail em minúsculas  */
CREATE TRIGGER trg_usuarios_bi BEFORE INSERT ON usuarios FOR EACH ROW
BEGIN
    IF NEW.id IS NULL OR NEW.id = '' THEN SET NEW.id = fn_gerar_id('USR'); END IF;
    SET NEW.login = LOWER(TRIM(NEW.login));
    SET NEW.email = LOWER(TRIM(NEW.email));
END$$

/* Gera o código do sistema e calcula criticidade_valor automaticamente. */
CREATE TRIGGER trg_sistemas_bi BEFORE INSERT ON sistemas FOR EACH ROW
BEGIN
    IF NEW.codigo IS NULL OR NEW.codigo = '' THEN SET NEW.codigo = fn_gerar_id('SIS'); END IF;
    SET NEW.criticidade_valor = fn_classificar_criticidade(NEW.criticidade);
END$$

/* Impede alterar o código e recalcula criticidade_valor. */
CREATE TRIGGER trg_sistemas_bu BEFORE UPDATE ON sistemas FOR EACH ROW
BEGIN
    IF NEW.codigo <> OLD.codigo THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'O codigo do sistema nao pode ser alterado';
    END IF;
    SET NEW.criticidade_valor = fn_classificar_criticidade(NEW.criticidade);
END$$

/* ============================ PROCEDURES ============================ */

/* Cadastra o sistema e devolve o código gerado (o backend cria depois o nó e as dependências no Neo4j). */
CREATE PROCEDURE sp_cadastrar_sistema(
    IN p_nome VARCHAR(120), IN p_descricao TEXT, IN p_url VARCHAR(255),
    IN p_tipo VARCHAR(20), IN p_ambiente VARCHAR(20), IN p_departamento VARCHAR(100),
    IN p_responsavel_id VARCHAR(20), IN p_criticidade VARCHAR(10), IN p_status VARCHAR(20),
    OUT p_codigo VARCHAR(20))
BEGIN
    SET p_codigo = fn_gerar_id('SIS');
    INSERT INTO sistemas (codigo, nome, descricao, url, tipo, ambiente, departamento, responsavel_id, criticidade, status)
    VALUES (p_codigo, p_nome, p_descricao, p_url, p_tipo, p_ambiente, p_departamento, p_responsavel_id, p_criticidade, p_status);
END$$

/* Consulta da Tela 2: busca por código/nome + filtros opcionais (NULL ou '' = sem filtro). */
CREATE PROCEDURE sp_consultar_sistemas(
    IN p_busca VARCHAR(120), IN p_ambiente VARCHAR(20), IN p_status VARCHAR(20), IN p_criticidade VARCHAR(10))
BEGIN
    SELECT * FROM vw_sistemas_detalhado
     WHERE (NULLIF(p_busca,'') IS NULL OR codigo = p_busca OR nome LIKE CONCAT('%', p_busca, '%'))
       AND (NULLIF(p_ambiente,'')    IS NULL OR ambiente    = p_ambiente)
       AND (NULLIF(p_status,'')      IS NULL OR status      = p_status)
       AND (NULLIF(p_criticidade,'') IS NULL OR criticidade = p_criticidade)
     ORDER BY criticidade_valor DESC, nome;
END$$

DELIMITER ;

/* ============================ VIEWS ============================ */

/* Base da Tela 2: traz o nome do responsável e evita expor a tabela usuarios (e senha_hash). */
CREATE VIEW vw_sistemas_detalhado AS
SELECT s.codigo, s.nome, s.descricao, s.url, s.tipo, s.ambiente, s.departamento,
       u.nome AS responsavel, s.criticidade, s.criticidade_valor, s.status
  FROM sistemas s JOIN usuarios u ON u.id = s.responsavel_id;

/* Visão gerencial: quantidade de sistemas por ambiente, status e criticidade. */
CREATE VIEW vw_resumo_criticidade AS
SELECT ambiente, status, criticidade, COUNT(*) AS total_sistemas
  FROM sistemas GROUP BY ambiente, status, criticidade;

/* ============================ DADOS INICIAIS ============================ */

INSERT INTO sequencias_id (prefixo) VALUES ('SIS'), ('USR');
INSERT INTO grupos_usuarios (nome, descricao, nivel_acesso) VALUES
    ('Administradores', 'Acesso total à aplicação', 'ADMINISTRADOR'),
    ('Gestores de TI',  'Cadastram e alteram sistemas', 'GESTOR'),
    ('Consulta',        'Somente consulta', 'CONSULTA');

/*Usuarios do BD*/
CREATE USER 'dba_projeto'@'%'  IDENTIFIED BY 'TROCAR_Dba@2026!';
CREATE USER 'app_backend'@'%'  IDENTIFIED BY 'TROCAR_Backend@2026!';
CREATE USER 'app_consulta'@'%' IDENTIFIED BY 'TROCAR_Consulta@2026!';

GRANT ALL PRIVILEGES ON gerenciador_dependencias.* TO 'dba_projeto'@'%';

GRANT SELECT, INSERT, UPDATE ON gerenciador_dependencias.sistemas         TO 'app_backend'@'%';
GRANT SELECT, INSERT, UPDATE ON gerenciador_dependencias.usuarios         TO 'app_backend'@'%';
GRANT SELECT, INSERT, UPDATE ON gerenciador_dependencias.usuarios_grupos  TO 'app_backend'@'%';
GRANT SELECT ON gerenciador_dependencias.grupos_usuarios                  TO 'app_backend'@'%';
GRANT SELECT ON gerenciador_dependencias.vw_sistemas_detalhado            TO 'app_backend'@'%';
GRANT SELECT ON gerenciador_dependencias.vw_resumo_criticidade            TO 'app_backend'@'%';
GRANT EXECUTE ON PROCEDURE gerenciador_dependencias.sp_cadastrar_sistema  TO 'app_backend'@'%';
GRANT EXECUTE ON PROCEDURE gerenciador_dependencias.sp_consultar_sistemas TO 'app_backend'@'%';
GRANT EXECUTE ON FUNCTION  gerenciador_dependencias.fn_gerar_id           TO 'app_backend'@'%';
GRANT EXECUTE ON FUNCTION  gerenciador_dependencias.fn_classificar_criticidade TO 'app_backend'@'%';

GRANT SELECT ON gerenciador_dependencias.vw_sistemas_detalhado            TO 'app_consulta'@'%';
GRANT SELECT ON gerenciador_dependencias.vw_resumo_criticidade            TO 'app_consulta'@'%';
GRANT EXECUTE ON PROCEDURE gerenciador_dependencias.sp_consultar_sistemas TO 'app_consulta'@'%';

FLUSH PRIVILEGES;