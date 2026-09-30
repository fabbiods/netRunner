# NetRunner

O NetRunner é uma aplicação web local para organizar equipamentos de rede, acessá-los por SSH e manter registros de auditoria locais. Nenhuma senha é armazenada e nenhum dado é enviado para a nuvem.

> Estado atual: Marco 6 — candidato v0.6.0 com inventário, SSH, gravação íntegra, histórico, handoff HTTPS seguro, preferências e recuperação local.

## Como funciona

O NetRunner inicia um serviço somente em `127.0.0.1`, escolhe uma porta livre e abre a interface no navegador padrão. As operações privilegiadas permanecem no processo local; o navegador nunca se conecta diretamente aos equipamentos.

O acesso à API exige um token aleatório de uso da sessão. O token é entregue no fragmento da URL, removido imediatamente da barra de endereço e mantido apenas em memória.

A página mantém uma conexão autenticada com o serviço local. Ao fechar a última aba do NetRunner, o processo encerra automaticamente após um curto intervalo; se houver conexão SSH ativa ou em andamento, o navegador solicita confirmação antes de fechar.

## Requisitos

- macOS 13 ou superior no alvo principal.
- Node.js 24.21 LTS e npm 11.
- Um navegador moderno.

O núcleo também é testável em Linux. As dependências SSH/xterm usam versões exatas, são resolvidas exclusivamente pelo Fury corporativo e são instaladas sem executar scripts.

## Inventário

- Localidades hierárquicas com reorganização por arrastar e soltar.
- Usernames reutilizáveis, sem qualquer campo de senha.
- Dispositivos com SSH/HTTPS, fabricante, tipo, plataforma, tags e perfil de algoritmos.
- Busca indexada, favoritos, recentes, filtro de criptografia legada e edição em massa.
- Importação CSV/JSON com prévia e exportação CSV/JSON.
- SQLite local com migrações, integridade ao iniciar, backup diário dos últimos 14 dias e backup/restauração manual.

Os dados ficam em `~/Library/Application Support/NetRunner/`. O banco e seus backups são privados ao usuário do macOS.

## Terminal SSH

- O menu **Sessões** retorna à sessão ativa mesmo depois de navegar por Saúde, Runbooks ou outra tela; o contador mostra quantas sessões continuam abertas.
- O menu **Cadastro** reúne Localidades, Username e Dispositivos. Operação reúne Saúde, Runbooks, Snapshots e Histórico; Administração reúne Confianças e Configurações.
- Clique em **Conectar** ou dê duplo clique no dispositivo.
- A senha é solicitada em cada conexão e nunca é salva.
- Primeira conexão exige confirmar a fingerprint SHA-256 da host key.
- Uma host key alterada bloqueia a conexão até substituição explícita.
- Suporta senha, `keyboard-interactive` com OTP e login dentro do shell.
- Perfis Moderno, Legado opt-in e Personalizado com lista permitida.
- Múltiplas abas, redimensionamento remoto, busca, zoom, keepalive e reconexão.
- Colagem multilinha é enviada linha a linha com atraso configurável, sem interromper a digitação normal com prompts do navegador.
- `⌘T` abre uma conexão avulsa no formato `usuario@host:porta`.

Atalhos atuais: `⌘K` abre a paleta de comandos, `⌘,` abre Configurações, `⌘T` inicia uma conexão rápida, `⌘F` busca no terminal, `⌘W` fecha a sessão e `⌘1–9` troca de aba.

## Preferências e operação

- Temas escuro, claro e alto contraste; o tema claro usa superfícies neutras de aplicativo desktop e preserva o terminal escuro para leitura operacional.
- Fonte, scrollback, cópia ao selecionar, colagem por clique direito e atraso de colagem configuráveis.
- Realce visual semântico no terminal: `offline`/`down` em vermelho, `online`/`up` em verde, 100 Mbps em laranja e velocidades de 1 Gbps ou mais em azul, sem alterar o stream nem o arquivo de gravação.
- Desconexão SSH opcional por inatividade; `0` mantém o recurso desabilitado.
- Tela **Confianças** para revisar e remover host keys SSH e certificados HTTPS fixados.
- Tela **Configurações** para criar backups manuais e agendar restauração na próxima inicialização.

## Saúde dos dispositivos

- Verificação iniciada manualmente para até 20 dispositivos por lote.
- ICMP informativo, abertura TCP da porta SSH e handshake TLS da interface HTTPS.
- Nenhuma credencial, autenticação SSH, comando remoto ou requisição HTTP nesse fluxo.
- Estado geral baseado somente nos protocolos habilitados; ICMP bloqueado não marca o equipamento como offline.
- Histórico local dos 100 resultados mais recentes por dispositivo.

## Snapshots de configuração

- Colete a configuração completa pela ação **Snapshot** separada dos runbooks na sessão SSH ativa.
- Ao finalizar a coleta depois do retorno do prompt, o snapshot é salvo automaticamente com data e horário.
- Compare dois snapshots do mesmo dispositivo com linhas adicionadas e removidas.
- Cada snapshot recebe hash SHA-256, origem, data e contagem de linhas.
- O conteúdo é normalizado para remover sequências de controle e limitado a 2 MiB e 50.000 linhas.
- Capturas que ultrapassam 2 MiB são descartadas, evitando comparar uma configuração incompleta.
- Antes de persistir, o backend substitui linhas com senhas, comunidades SNMP, chaves, passphrases e blocos de chave privada por marcadores de remoção.
- Snapshots redigidos ficam no SQLite e entram nos backups locais; a tela informa quantos trechos foram removidos.

## Runbooks operacionais

- Switches Ruckus ICX/FastIron, Juniper EX/Junos e Cisco Catalyst/IOS-XE recebem runbooks de troubleshooting somente leitura.
- Os comandos ficam em catálogo imutável no backend; o navegador envia somente o identificador do runbook.
- Apenas comandos `show` e os ajustes temporários `skip`, `set cli screen-length 0` e `terminal length 0` entram na allowlist.
- O painel identifica o tipo e o fabricante, por exemplo **Switch Juniper**, antes de exibir os comandos.
- Quando o cadastro não identifica uma família suportada, o operador escolhe explicitamente o perfil seguro usado somente naquela sessão.
- Cada runbook envia seus comandos diretamente ao terminal, sem captura, persistência ou pergunta de snapshot.
- APs Aruba, Mist e Huawei aparecem como gerenciados por Aruba Central, Mist Cloud e iMaster, sem automação SSH local.

A arquitetura web não oferece Touch ID nem Secure Keyboard Entry. O NetRunner não simula essas garantias: senhas continuam efêmeras e nunca são armazenadas, mas a proteção contra keyloggers depende do macOS e do navegador corporativo.

## Gravação e histórico

- **Gravar sessão em TXT** vem habilitado por padrão e pode ser alterado no Histórico.
- A gravação começa antes da autenticação, captura exclusivamente o stream de saída e nunca recebe as teclas enviadas pelo usuário.
- ANSI, backspaces, marcadores de paginação e quebras artificiais são normalizados com `@xterm/headless` na largura da sessão.
- Cada linha de saída recebe timestamp; cabeçalho, eventos do NetRunner e rodapé registram o contexto e o término.
- Cada TXT finalizado recebe um sidecar `.sha256` e ambos ficam somente para leitura (`0400`).
- Logs ficam em `~/NetRunner/Logs/<Localidade>/<Hostname>/`, fora de pastas sincronizadas por padrão.
- Uma sessão interrompida é marcada como `unexpected_shutdown` e selada na próxima inicialização.
- O Histórico filtra por dispositivo, localidade, data, duração, ticket e protocolo; também abre, revela no Finder e verifica o log.
- Ao iniciar a gravação durante uma sessão, até 2 MiB da saída anterior são recuperados e identificados no arquivo.

## Acesso HTTPS

- O NetRunner realiza somente um handshake TLS local para inspecionar certificado, protocolo e cifra; não baixa a página nem recebe cookies.
- Certificados reconhecidos pelo sistema podem seguir diretamente para o navegador padrão.
- Um certificado privado ou autoassinado exige confirmação explícita da fingerprint SHA-256 antes da fixação TOFU.
- Uma fingerprint diferente da fixada bloqueia o handoff até uma substituição deliberada.
- TLS 1.0 e 1.1 não são aceitos; o erro informa quando o equipamento requer protocolo obsoleto.
- A URL é aberta pelo processo local somente após ação do usuário e precisa ter sido validada como `https://`, sem credenciais embutidas.
- O acesso fica registrado no Histórico como handoff ao navegador. Como a aba é externa, o NetRunner não observa sua duração real, cookies, autenticação ou encerramento.

## Instalação e execução

```bash
nvm install
nvm use
npm ci --ignore-scripts --no-audit --no-fund
npm start
```

O navegador abre automaticamente. Fechar a última aba do NetRunner encerra o serviço local; também é possível pressionar `Ctrl+C` no terminal que iniciou o processo.

## Qualidade

```bash
npm run verify
```

Esse comando valida sintaxe e políticas locais e executa os testes com o test runner nativo do Node.

Para validar a meta da busca com 10.000 dispositivos fictícios:

```bash
npm run benchmark:inventory
```

Antes de distribuição ampla, execute também a lista de validações manuais e corporativas em [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## Distribuição local

```bash
npm run package
```

O resultado é criado em `out/netrunner`. No macOS, `start.command` inicia o serviço usando o Node instalado na máquina. Um executável independente poderá ser avaliado depois que a arquitetura estiver estabilizada.

## Segurança corporativa

- Nenhum pacote é obtido de registro público.
- Novas dependências só poderão vir do Fury corporativo após revisão.
- Sem CDN, fontes remotas, telemetria ou chamadas externas automáticas.
- Servidor restrito ao endereço de loopback.
- API protegida por token efêmero.
- Host e origem validados para reduzir DNS rebinding e CSRF.
- CSP e permissões do navegador restritivas.
- Dependências fixadas no lockfile e originadas somente de `npm.artifacts.furycloud.io`.
- Scripts de instalação npm desabilitados por configuração do projeto.
- Perfis SSH não oferecem cifra `none`, RC4, Blowfish, CAST ou MACs MD5.
- Arquivos de log usam diretórios `0700`, TXT/sidecar `0400`, escrita incremental e SHA-256 final.
- Restaurações são validadas, executadas somente na próxima inicialização e preservam um backup de emergência do estado anterior.

Consulte [docs/SECURITY.md](docs/SECURITY.md) para o modelo de ameaças e os limites de proteção.

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Segurança](docs/SECURITY.md)
- [Compatibilidade](docs/COMPATIBILITY.md)
- [Decisões](docs/DECISIONS.md)
- [Checklist de lançamento](docs/RELEASE_CHECKLIST.md)
