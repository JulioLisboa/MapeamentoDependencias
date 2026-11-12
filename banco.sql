
CREATE DATABASE IF NOT EXISTS gerenciador_dependencias
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE gerenciador_dependencias;

-- tabelas

CREATE TABLE IF NOT EXISTS sequencias_id (
    prefixo VARCHAR(5) NOT NULL PRIMARY KEY,
    ultimo_valor BIGINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS grupos_usuarios (
    id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) NOT NULL UNIQUE,
    descricao VARCHAR(255),
    nivel_acesso ENUM(
        'ADMINISTRADOR',
        'GESTOR',
        'CONSULTA'
    ) NOT NULL DEFAULT 'CONSULTA'
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS usuarios (
    id VARCHAR(20) NOT NULL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    login VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(150) NOT NULL UNIQUE,
    senha_hash VARCHAR(100) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS usuarios_grupos (
    usuario_id VARCHAR(20) NOT NULL,
    grupo_id SMALLINT UNSIGNED NOT NULL,

    PRIMARY KEY (usuario_id, grupo_id),

    FOREIGN KEY (usuario_id)
        REFERENCES usuarios (id)
        ON DELETE CASCADE,

    FOREIGN KEY (grupo_id)
        REFERENCES grupos_usuarios (id)
        ON DELETE CASCADE
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS sistemas (
    codigo VARCHAR(20) NOT NULL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    descricao TEXT,
    url VARCHAR(255),

    tipo ENUM(
        'APLICACAO',
        'API',
        'BANCO_DE_DADOS',
        'INFRAESTRUTURA',
        'SERVICO_EXTERNO',
        'OUTRO'
    ) NOT NULL DEFAULT 'APLICACAO',

    ambiente ENUM(
        'PRODUCAO',
        'HOMOLOGACAO',
        'DESENVOLVIMENTO',
        'TESTE'
    ) NOT NULL DEFAULT 'PRODUCAO',

    departamento VARCHAR(100) NOT NULL,
    responsavel_id VARCHAR(20) NOT NULL,

    criticidade ENUM(
        'BAIXA',
        'MEDIA',
        'ALTA',
        'CRITICA'
    ) NOT NULL DEFAULT 'MEDIA',

    criticidade_valor TINYINT UNSIGNED NOT NULL DEFAULT 2,

    status ENUM(
        'ATIVO',
        'INATIVO',
        'EM_MANUTENCAO',
        'DESCONTINUADO'
    ) NOT NULL DEFAULT 'ATIVO',

    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (responsavel_id)
        REFERENCES usuarios (id),

    UNIQUE KEY uq_sistemas_nome_ambiente (nome, ambiente),

    KEY idx_sistemas_filtros (
        ambiente,
        status,
        criticidade_valor
    )
) ENGINE=InnoDB;



INSERT INTO sequencias_id (prefixo)
VALUES ('USR'), ('SIS')
ON DUPLICATE KEY UPDATE prefixo = VALUES(prefixo);


-- functions

DROP FUNCTION IF EXISTS fn_gerar_id;
DROP FUNCTION IF EXISTS fn_classificar_criticidade;

DELIMITER $$


/* Geração de IDs */

CREATE FUNCTION fn_gerar_id(
    p_prefixo VARCHAR(5)
)
RETURNS VARCHAR(20)
NOT DETERMINISTIC
MODIFIES SQL DATA
SQL SECURITY DEFINER
BEGIN

    DECLARE v_prox BIGINT UNSIGNED DEFAULT NULL;

    SELECT ultimo_valor + 1
    INTO v_prox
    FROM sequencias_id
    WHERE prefixo = p_prefixo
    FOR UPDATE;

    IF v_prox IS NULL THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Prefixo de sequencia inexistente';
    END IF;

    UPDATE sequencias_id
    SET ultimo_valor = v_prox
    WHERE prefixo = p_prefixo;

    RETURN CONCAT(
        p_prefixo,
        '-',
        LPAD(v_prox, 6, '0')
    );

END$$


/* Classificação da criticidade */

CREATE FUNCTION fn_classificar_criticidade(
    p_criticidade VARCHAR(10)
)
RETURNS TINYINT UNSIGNED
DETERMINISTIC
NO SQL
BEGIN

    RETURN CASE UPPER(p_criticidade)
        WHEN 'BAIXA' THEN 1
        WHEN 'MEDIA' THEN 2
        WHEN 'ALTA' THEN 3
        WHEN 'CRITICA' THEN 4
        ELSE 0
    END;

END$$


-- triggers

DROP TRIGGER IF EXISTS trg_usuarios_bi;
DROP TRIGGER IF EXISTS trg_sistemas_bi;
DROP TRIGGER IF EXISTS trg_sistemas_bu;


/* Geração de ID e padronização do usuário */

CREATE TRIGGER trg_usuarios_bi
BEFORE INSERT ON usuarios
FOR EACH ROW
BEGIN

    IF NEW.id IS NULL OR NEW.id = '' THEN
        SET NEW.id = fn_gerar_id('USR');
    END IF;

    SET NEW.login = LOWER(TRIM(NEW.login));
    SET NEW.email = LOWER(TRIM(NEW.email));

END$$


/* Geração de código e classificação */

CREATE TRIGGER trg_sistemas_bi
BEFORE INSERT ON sistemas
FOR EACH ROW
BEGIN

    IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
        SET NEW.codigo = fn_gerar_id('SIS');
    END IF;

    SET NEW.criticidade_valor =
        fn_classificar_criticidade(NEW.criticidade);

END$$


/* Impede alteração do código */

CREATE TRIGGER trg_sistemas_bu
BEFORE UPDATE ON sistemas
FOR EACH ROW
BEGIN

    IF NEW.codigo <> OLD.codigo THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'O codigo do sistema nao pode ser alterado';
    END IF;

    SET NEW.criticidade_valor =
        fn_classificar_criticidade(NEW.criticidade);

END$$


DELIMITER ;


-- views

DROP VIEW IF EXISTS vw_sistemas_detalhado;
DROP VIEW IF EXISTS vw_resumo_criticidade;


CREATE VIEW vw_sistemas_detalhado AS

SELECT
    s.codigo,
    s.nome,
    s.descricao,
    s.url,
    s.tipo,
    s.ambiente,
    s.departamento,
    u.nome AS responsavel,
    s.criticidade,
    s.criticidade_valor,
    s.status

FROM sistemas s

INNER JOIN usuarios u
    ON u.id = s.responsavel_id;


CREATE VIEW vw_resumo_criticidade AS

SELECT
    ambiente,
    status,
    criticidade,
    COUNT(*) AS total_sistemas

FROM sistemas

GROUP BY
    ambiente,
    status,
    criticidade;


-- procedures

DROP PROCEDURE IF EXISTS sp_cadastrar_sistema;
DROP PROCEDURE IF EXISTS sp_consultar_sistemas;

DELIMITER $$


/* Cadastro de sistemas */

CREATE PROCEDURE sp_cadastrar_sistema(

    IN p_nome VARCHAR(120),
    IN p_descricao TEXT,
    IN p_url VARCHAR(255),
    IN p_tipo VARCHAR(20),
    IN p_ambiente VARCHAR(20),
    IN p_departamento VARCHAR(100),
    IN p_responsavel_id VARCHAR(20),
    IN p_criticidade VARCHAR(10),
    IN p_status VARCHAR(20),

    OUT p_codigo VARCHAR(20)

)
BEGIN

    SET p_codigo = fn_gerar_id('SIS');

    INSERT INTO sistemas (
        codigo,
        nome,
        descricao,
        url,
        tipo,
        ambiente,
        departamento,
        responsavel_id,
        criticidade,
        status
    )
    VALUES (
        p_codigo,
        p_nome,
        p_descricao,
        p_url,
        p_tipo,
        p_ambiente,
        p_departamento,
        p_responsavel_id,
        p_criticidade,
        p_status
    );

END$$


/* Consulta de sistemas com filtros opcionais */

CREATE PROCEDURE sp_consultar_sistemas(

    IN p_busca VARCHAR(120),
    IN p_ambiente VARCHAR(20),
    IN p_status VARCHAR(20),
    IN p_criticidade VARCHAR(10)

)
BEGIN

    SELECT *
    FROM vw_sistemas_detalhado

    WHERE
        (
            NULLIF(p_busca, '') IS NULL
            OR codigo = p_busca
            OR nome LIKE CONCAT('%', p_busca, '%')
        )

        AND (
            NULLIF(p_ambiente, '') IS NULL
            OR ambiente = p_ambiente
        )

        AND (
            NULLIF(p_status, '') IS NULL
            OR status = p_status
        )

        AND (
            NULLIF(p_criticidade, '') IS NULL
            OR criticidade = p_criticidade
        )

    ORDER BY criticidade_valor DESC, nome;

END$$


DELIMITER ;


-- grupos insert

INSERT INTO grupos_usuarios (
    nome,
    descricao,
    nivel_acesso
)
VALUES
(
    'Administradores',
    'Acesso total à aplicação',
    'ADMINISTRADOR'
),
(
    'Gestores de TI',
    'Cadastram e alteram sistemas',
    'GESTOR'
),
(
    'Consulta',
    'Somente consulta',
    'CONSULTA'
)
ON DUPLICATE KEY UPDATE
    descricao = VALUES(descricao);


-- usuario insert
/* Administrador */

INSERT INTO usuarios (
    id,
    nome,
    login,
    email,
    senha_hash
)
SELECT
    NULL,
    'Administrador',
    'admin',
    'admin@projeto.com',
    SHA2('Admin@123', 256)

WHERE NOT EXISTS (
    SELECT 1 FROM usuarios WHERE login = 'admin'
);


/* Gestor */

INSERT INTO usuarios (
    id,
    nome,
    login,
    email,
    senha_hash
)
SELECT
    NULL,
    'Gestor de TI',
    'gestor',
    'gestor@projeto.com',
    SHA2('Gestor@123', 256)

WHERE NOT EXISTS (
    SELECT 1 FROM usuarios WHERE login = 'gestor'
);


/* Consulta */

INSERT INTO usuarios (
    id,
    nome,
    login,
    email,
    senha_hash
)
SELECT
    NULL,
    'Usuário Consulta',
    'consulta',
    'consulta@projeto.com',
    SHA2('Consulta@123', 256)

WHERE NOT EXISTS (
    SELECT 1 FROM usuarios WHERE login = 'consulta'
);


-- usuario-grupo

INSERT INTO usuarios_grupos (usuario_id, grupo_id)

SELECT u.id, g.id

FROM usuarios u

CROSS JOIN grupos_usuarios g

WHERE
    (
        (u.login = 'admin' AND g.nome = 'Administradores')
        OR
        (u.login = 'gestor' AND g.nome = 'Gestores de TI')
        OR
        (u.login = 'consulta' AND g.nome = 'Consulta')
    )

AND NOT EXISTS (
    SELECT 1
    FROM usuarios_grupos ug
    WHERE ug.usuario_id = u.id
    AND ug.grupo_id = g.id
);


-- usuarios

CREATE USER IF NOT EXISTS
'dba_projeto'@'%' IDENTIFIED BY 'TROCAR_Dba@2026!';

CREATE USER IF NOT EXISTS
'app_backend'@'%' IDENTIFIED BY 'TROCAR_Backend@2026!';

CREATE USER IF NOT EXISTS
'app_consulta'@'%' IDENTIFIED BY 'TROCAR_Consulta@2026!';


/* DBA */

GRANT ALL PRIVILEGES
ON gerenciador_dependencias.*
TO 'dba_projeto'@'%';


/* BACKEND */

GRANT SELECT, INSERT, UPDATE
ON gerenciador_dependencias.usuarios
TO 'app_backend'@'%';

GRANT SELECT, INSERT, UPDATE
ON gerenciador_dependencias.usuarios_grupos
TO 'app_backend'@'%';

GRANT SELECT
ON gerenciador_dependencias.grupos_usuarios
TO 'app_backend'@'%';

GRANT SELECT, INSERT, UPDATE
ON gerenciador_dependencias.sistemas
TO 'app_backend'@'%';

GRANT SELECT
ON gerenciador_dependencias.vw_sistemas_detalhado
TO 'app_backend'@'%';

GRANT SELECT
ON gerenciador_dependencias.vw_resumo_criticidade
TO 'app_backend'@'%';

GRANT EXECUTE
ON PROCEDURE gerenciador_dependencias.sp_cadastrar_sistema
TO 'app_backend'@'%';

GRANT EXECUTE
ON PROCEDURE gerenciador_dependencias.sp_consultar_sistemas
TO 'app_backend'@'%';

GRANT EXECUTE
ON FUNCTION gerenciador_dependencias.fn_gerar_id
TO 'app_backend'@'%';

GRANT EXECUTE
ON FUNCTION gerenciador_dependencias.fn_classificar_criticidade
TO 'app_backend'@'%';


/* CONSULTA */

GRANT SELECT
ON gerenciador_dependencias.vw_sistemas_detalhado
TO 'app_consulta'@'%';

GRANT SELECT
ON gerenciador_dependencias.vw_resumo_criticidade
TO 'app_consulta'@'%';

GRANT EXECUTE
ON PROCEDURE gerenciador_dependencias.sp_consultar_sistemas
TO 'app_consulta'@'%';


FLUSH PRIVILEGES;

