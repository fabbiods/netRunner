# Changelog

Todas as mudanças relevantes deste projeto serão documentadas aqui.

## [Unreleased]

### Added

- Serviço HTTP local restrito a `127.0.0.1` e porta dinâmica.
- Autenticação da API com token efêmero de 256 bits.
- Proteções contra DNS rebinding, requisições cross-origin e carregamento de recursos externos.
- CSP, Permissions Policy e cabeçalhos de segurança.
- Interface inicial em PT-BR sem frameworks ou assets remotos.
- Testes usando exclusivamente o test runner nativo do Node.
- Empacotamento local sem dependências externas.
- SQLite local via `node:sqlite`, migrações versionadas e verificação de integridade.
- Backups diários privados com retenção dos 14 arquivos mais recentes.
- CRUD de localidades hierárquicas, usernames sem senha e dispositivos.
- Busca FTS5, favoritos, recentes, filtro de criptografia legada e edição em massa.
- Importação CSV/JSON com prévia, validação e criação opcional de referências.
- Exportação completa em JSON e de dispositivos em CSV.
- Interface de inventário acessível com árvore, seleção pesquisável e arrastar/soltar.
- Benchmark automatizado da busca com 10.000 dispositivos.
- Terminal SSH com múltiplas abas usando `ssh2` e xterm.
- Verificação TOFU com fingerprint SHA-256 e bloqueio de host key alterada.
- Autenticação por senha, `keyboard-interactive`/OTP e login dentro do shell.
- Perfis de algoritmos Moderno, Legado opt-in e Personalizado por allowlist.
- Diagnóstico filtrado de falhas de negociação SSH.
- Redimensionamento remoto, keepalive, busca, zoom, reconexão e proteção de colagem multilinha.
- Conexão rápida avulsa e comandos pós-login limitados a uma allowlist de escopo de sessão.
- Testes SSH simulados para 2FA, senha canário, legado, login no shell, 20 sessões e saída de 10 MB.
- Gravação TXT normalizada com timestamps, cabeçalho, rodapé, escrita incremental e recuperação após falha.
- Sidecar SHA-256, permissões privadas e Histórico de sessões com filtros e verificação de integridade.
- Inspeção TLS 1.2+ sem requisição HTTP e fixação TOFU de certificados não confiáveis.
- Bloqueio de certificado alterado, substituição explícita e handoff autenticado ao navegador padrão.
- Registro de acessos HTTPS no Histórico sem capturar conteúdo, cookies ou credenciais.
- Configurações persistentes de tema, terminal, gravação e desconexão por inatividade.
- Temas claro, escuro e alto contraste e realce visual de palavras no terminal.
- Paleta de comandos acessível por `⌘K` e navegação completa por teclado.
- Revisão e remoção explícita de host keys SSH e certificados HTTPS fixados.
- Backup manual e restauração validada na próxima inicialização, com cópia de emergência.
- Testes contratuais de acessibilidade básica e ausência de persistência no navegador.
- Painel de saúde sob demanda para ICMP, TCP/SSH e TLS/HTTPS, com histórico dos 100 resultados mais recentes por dispositivo.
- Snapshots de configuração manuais ou capturados da seleção do terminal, com SHA-256 e comparação por linhas.
- Redação obrigatória de senhas, comunidades SNMP, chaves e outros padrões sensíveis antes de persistir snapshots.
- Runbooks somente leitura para switches Ruckus ICX, Juniper EX e Cisco Catalyst, com catálogo cloud informativo para APs Aruba, Mist e Huawei.

### Changed

- Arquitetura migrada de Electron para aplicação web local após aprovação do responsável do produto.
- HTTPS de equipamentos será aberto no navegador padrão, sem aba incorporada.
- O handoff HTTPS passou a ter inspeção prévia e verificação repetida da fingerprint antes da abertura.
- SQLite usa o módulo nativo `node:sqlite`, sem binários adicionais.
- `⌘K` agora abre a paleta global; a busca do terminal permanece em `⌘F`.
- Entrada normal no terminal não aciona mais o prompt de colagem; conteúdos realmente multilinha continuam sendo enviados linha a linha com atraso configurável.
- O terminal realça estados `offline`/`down`, `online`/`up` e velocidades de 100 Mbps ou 1 Gbps ou mais com cores semânticas.
- O serviço local agora encerra automaticamente quando a última página autenticada do NetRunner é fechada, com confirmação do navegador para sessões SSH ativas.
- A navegação agora mantém uma entrada permanente para retornar às sessões abertas e agrupa Cadastro, Operação e Administração em menus compactos.

### Removed

- Electron, Electron Forge, Vite, React e módulos nativos da fundação.
- Dependência de registros npm públicos no Marco 1.
