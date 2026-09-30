# Registro de decisões

## ADR-001 — Aplicação web local

**Status:** aceito pelo responsável do produto em 29/09/2026. Substitui a decisão anterior por Electron.

O NetRunner será um serviço local acessado pelo navegador padrão. A mudança reduz dependências, elimina a ABI Electron/Node e evita contornar o Fury corporativo.

## ADR-002 — Dependências somente pelo Fury

**Status:** aceito.

Nenhum registro público será usado. O Marco 1 não possui dependências externas. Pacotes futuros exigem disponibilidade e aprovação no Fury.

## ADR-003 — HTTPS no navegador padrão

**Status:** aceito como consequência da arquitetura web local.

Não haverá aba HTTPS incorporada na primeira versão. O NetRunner não alegará controlar o TLS do navegador externo.

## ADR-004 — SQLite integrado ao Node

**Status:** aceito.

Usaremos `node:sqlite` no Marco 2, removendo a necessidade de `better-sqlite3` e de binários nativos adicionais.

## ADR-005 — macOS 13+ arm64

**Status:** aceito pelo responsável do produto em 28/09/2026.

O primeiro alvo permanece Apple Silicon. O serviço e seus testes também devem funcionar em Linux.

## ADR-006 — Registro somente da saída

**Status:** aceito pelo responsável do produto em 28/09/2026.

O gravador nunca persistirá teclas digitadas. O produto descreve o resultado como registro integral da saída observada, pois comandos sem eco não podem ser reconstruídos com segurança.

## ADR-007 — Criptografia legada fail-closed

**Status:** aceito pelo responsável do produto em 28/09/2026.

Somente algoritmos realmente suportados e testados serão disponibilizados. O aplicativo não reduzirá outras proteções para simular compatibilidade.

## ADR-008 — Transporte do terminal por HTTP autenticado

**Status:** aceito na implementação do Marco 3.

Entrada, resize e decisões usam POST; saída e estados usam long polling. Isso evita adicionar um servidor WebSocket e mantém autenticação e validação de origem uniformes. O navegador nunca recebe acesso direto a sockets SSH.

## ADR-009 — Dependências SSH instaladas sem scripts

**Status:** aceito na implementação do Marco 3.

`ssh2` e xterm foram obtidos apenas do Fury, com versões exatas. O binding criptográfico opcional do `ssh2` não é compilado; usamos o caminho JavaScript para impedir execução de scripts de instalação e reduzir risco de cadeia de suprimentos.

## ADR-010 — Normalização de logs com terminal headless

**Status:** aceito na implementação do Marco 4.

`@xterm/headless@6.0.0`, obtido exclusivamente do Fury, interpreta o stream VT com as dimensões da sessão. Essa abordagem preserva o efeito de cursor, backspace e ANSI sem manter sequências de controle no TXT. O gravador recebe somente a saída do SSH.

## ADR-011 — Logs fora de pastas sincronizadas

**Status:** aceito na implementação do Marco 4.

A raiz padrão é `~/NetRunner/Logs`, deliberadamente fora de Desktop, Documents, iCloud Drive e CloudStorage. Diretórios são `0700`; após a finalização, TXT e sidecar SHA-256 tornam-se `0400`.

## ADR-012 — HTTPS no navegador padrão com inspeção prévia

**Status:** aceito na implementação do Marco 5; detalha a ADR-003.

A aplicação web local não pode oferecer o isolamento de `WebContentsView` sem reintroduzir um runtime desktop. O NetRunner faz um handshake TLS 1.2+ sem HTTP, aplica TOFU a certificados não confiáveis e abre a URL validada no navegador padrão por ação explícita. A interface informa que a fixação é prévia e não controla a sessão TLS, cookies ou duração da aba externa.

## ADR-013 — Não simular garantias nativas no navegador

**Status:** aceito na implementação do Marco 6.

Touch ID e Secure Keyboard Entry dependem de APIs e integração nativas que não existem para o serviço web local. Não adicionaremos um wrapper desktop ou extensão de navegador apenas para simular esses recursos. Senhas permanecem efêmeras, campos desabilitam preenchimento convencional e a documentação exige navegador corporativo atualizado, mas o produto declara explicitamente que não protege contra keyloggers.

## ADR-014 — Restauração somente na inicialização

**Status:** aceito na implementação do Marco 6.

O processo não substitui um SQLite aberto. A interface apenas agenda uma restauração já validada; na próxima inicialização, antes de abrir os serviços, o NetRunner valida novamente o arquivo, serializa o banco corrente como backup de emergência, remove sidecars WAL/SHM e instala a cópia selecionada. Isso reduz risco de mistura de estados e mantém uma rota local de recuperação.

## ADR-015 — Coleta automática somente por runbook específico

**Status:** aceito na implementação dos snapshots de configuração.

O armazenamento e o diff são independentes de fabricante, mas o NetRunner não envia um comando genérico de coleta. A ação de snapshot usa uma definição específica de fabricante, família, sistema operacional, comando somente leitura, paginação e limites conhecidos, separada visualmente dos runbooks de troubleshooting. A entrada manual fica suspensa durante a captura e o operador encerra a coleta quando o prompt retorna; então o snapshot é salvo automaticamente com data e horário. Capturas truncadas são descartadas.

Quando o cadastro não identifica uma família suportada, o NetRunner não tenta descobri-la enviando comandos. O operador escolhe um perfil SSH do catálogo imutável, válido apenas para a sessão corrente. Essa escolha habilita tanto os comandos de troubleshooting quanto a coleta compatível, sem alterar o inventário.

Independentemente da origem, todo snapshot passa por redação central obrigatória antes do SQLite. Regras específicas poderão ser acrescentadas por runbook, mas nunca poderão desabilitar a política comum.
