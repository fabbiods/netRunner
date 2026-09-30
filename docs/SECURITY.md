# Segurança

## Estado do documento

Este modelo cobre a fundação web local, o inventário, o terminal SSH, o gravador íntegro, o handoff HTTPS e os controles operacionais do Marco 6.

## Ativos

- inventário e topologia;
- snapshots de configuração, que podem conter dados operacionais sensíveis;
- usernames e configurações;
- host keys e fingerprints observadas;
- senhas enquanto transitoriamente em memória;
- logs e índice de sessões;
- token efêmero da interface local.

## Controles implementados

- Serviço restrito a `127.0.0.1`; não escuta interfaces LAN ou VPN.
- Porta dinâmica para reduzir conflitos e exposição previsível.
- Token de sessão com 256 bits de entropia, mantido somente em memória.
- Token entregue em fragmento de URL, que não é enviado ao servidor pelo navegador.
- Fragmento removido imediatamente do histórico.
- Conexão autenticada de ciclo de vida encerra o serviço local quando a última página do NetRunner é fechada.
- Comparação de token com `timingSafeEqual`.
- Validação estrita do cabeçalho `Host` contra DNS rebinding.
- Validação de `Origin` quando presente e ausência de CORS permissivo.
- CSP sem `unsafe-inline`, `unsafe-eval` ou origens externas.
- Permissões de câmera, microfone, localização, notificações, pagamentos, USB e captura de tela negadas.
- `Cache-Control: no-store`, `Referrer-Policy: no-referrer` e proteção contra framing.
- Lista explícita de assets servidos; caminhos arbitrários não são aceitos.
- Diretório de dados com permissão `0700`.
- Banco e backups com permissão `0600`, SQLite em WAL e checagem de integridade ao iniciar.
- Migrações e alterações compostas executadas em transações.
- Entradas validadas por tipo, tamanho, enumeração, endereço, porta e URL HTTPS.
- SQL parametrizado; nenhuma entrada do usuário é concatenada em comandos SQL.
- Upload lógico limitado a 12 MiB e importação limitada a 20.000 registros.
- URLs de dispositivo aceitam somente HTTPS e rejeitam credenciais embutidas.
- Exportações não contêm senhas porque o modelo de dados não possui campo de senha.
- Host keys verificadas antes da autenticação, com TOFU e bloqueio de mudança.
- Uma tentativa de autenticação por senha digitada; sem fallback que reutilize a mesma senha.
- Perfis de algoritmos exatos e Legado habilitado somente por dispositivo.
- Máximo de 20 sessões SSH simultâneas e limites em entrada, prompts e histórico de eventos.
- Fechar uma página com sessão SSH conectada ou em conexão aciona a confirmação nativa do navegador antes do desligamento automático.
- OSC 0/1/2/8/52 bloqueados no terminal; títulos remotos e escrita remota na área de transferência não são aceitos.
- Links somente HTTP/HTTPS, abertos com ⌘+clique e confirmação explícita.
- Colagem multilinha é fracionada e usa atraso configurável por linha para reduzir perda de comandos, sem prompt modal do navegador.
- Sem telemetria, atualização automática, CDN ou registro público.
- Gravador conectado exclusivamente à saída SSH; a função que envia teclas não encaminha dados ao gravador.
- Logs fora das pastas sincronizadas por padrão, em diretórios `0700`, com TXT e SHA-256 `0400` após o fechamento.
- Escrita incremental, recuperação após falha e verificação de integridade sob demanda.
- Abertura de log limitada a caminhos indexados dentro de `~/NetRunner/Logs`.
- Probe HTTPS limitado ao handshake TLS, sem requisição HTTP, cookies ou conteúdo remoto.
- Painel de saúde iniciado somente por ação autenticada, limitado a 20 dispositivos por lote e quatro probes concorrentes.
- Verificação de saúde sem credenciais, autenticação SSH, comandos remotos ou requisições HTTP; ICMP é informativo e TCP/TLS determinam o estado.
- Snapshots limitados a 2 MiB e 50.000 linhas, normalizados sem sequências de controle e renderizados somente após escape de HTML.
- Redação obrigatória no backend antes do SQLite para senhas, secrets, passphrases, comunidades SNMP, chaves de autenticação, credenciais em URL e blocos de chave privada.
- Comparação limitada a snapshots do mesmo dispositivo e com teto de complexidade para evitar exaustão local.
- Runbooks resolvidos exclusivamente pelo backend; o navegador envia IDs e nunca comandos arbitrários neste fluxo.
- Allowlist de runbooks restrita a comandos `show` e três ajustes temporários de paginação, sem modo de configuração, commit, escrita, cópia ou reinicialização.
- A escolha manual de perfil é aceita somente quando fabricante e tipo cadastrados não correspondem a nenhuma família conhecida; o backend limita a seleção às famílias SSH do catálogo imutável e não altera o inventário.
- Término da captura confirmado pelo operador para evitar detecção insegura de prompts; diagnósticos não são persistidos.
- APs em Aruba Central, Mist Cloud e iMaster não recebem automação SSH local nem credenciais cloud nesta etapa.
- TLS mínimo 1.2 e URLs restritas a `https://` sem credenciais embutidas.
- TOFU de certificados não confiáveis por dispositivo/host/porta e bloqueio de mudança de fingerprint.
- Nova inspeção imediatamente antes do handoff para reduzir troca de certificado entre confirmação e abertura.
- Navegador padrão aberto somente após ação autenticada e explícita do usuário.
- Desconexão opcional por inatividade aplicada no processo local e atualizada em sessões existentes.
- Preferências validadas e persistidas somente no SQLite local; nenhum storage do navegador é usado.
- Remoção de host keys e certificados exige ação e confirmação explícitas; a próxima conexão volta ao fluxo TOFU.
- Backup manual criado por serialização consistente e restauração adiada para a próxima inicialização.
- Backup selecionado verificado por `integrity_check` e presença do esquema antes do agendamento e da aplicação.
- Backup de emergência do estado corrente criado antes de cada restauração.

## Dependências

Os Marcos 3 e 4 adicionam `ssh2`, xterm e `@xterm/headless` em versões exatas. Todos os tarballs do lockfile apontam para o Fury. As licenças são permissivas (MIT, BSD-3-Clause ou Unlicense). O `install.js` do `ssh2` e o binding opcional `cpu-features` foram revisados; a instalação usa `--ignore-scripts`, portanto nenhum deles é executado e o fallback JavaScript é usado. `@xterm/headless@6.0.0` foi validado no Fury, sob licença MIT e sem scripts de instalação declarados.

O Nexus/Fury respondeu `400` ao endpoint padrão de `npm audit`, então a auditoria automática não produziu um relatório. O projeto não consultou o registro público como fallback. Essa limitação deve ser tratada pelo scanner corporativo de componentes antes de distribuição ampla.

## Inventário e importações

Arquivos importados são dados não confiáveis. O parser trata campos CSV entre aspas, BOM, separadores regionais e erros por linha; referências ausentes só são criadas mediante escolha explícita. O banco aceita IP/FQDN duplicado com aviso, conforme o requisito, mas mantém unicidade dos usernames.

Os backups melhoram recuperação operacional, mas não substituem backup corporativo nem criptografia em repouso. A restauração é local e sobrescreve o banco somente após uma reinicialização deliberada; o backup de emergência permite recuperação manual. Recomenda-se FileVault; SQLCipher com chave protegida pelo sistema permanece uma evolução documentada.

O NetRunner remove padrões sensíveis conhecidos antes de persistir e registra a quantidade de trechos removidos. Como fabricantes podem introduzir sintaxes desconhecidas, a interface ainda exige revisão e os testes dos runbooks devem incluir exemplos anonimizados de cada sistema operacional. Somente o conteúdo redigido integra o banco e seus backups; FileVault e o controle de acesso às cópias continuam recomendados.

## Senhas

O NetRunner não armazenará senhas no banco, Keychain, configurações, storage do navegador, logs ou relatórios. A senha ficará disponível somente durante a tentativa solicitada pelo usuário.

JavaScript não oferece garantia de sobrescrita física de strings. O projeto reduzirá tempo de vida, escopo e referências, mas não afirmará apagamento físico garantido.

A senha existe no campo protegido apenas até a criação da sessão. O campo é esvaziado, a API não devolve o segredo e o processo local remove sua referência após a única tentativa ou o fim do prompt interativo. OTPs seguem o mesmo fluxo. Testes canário verificam banco, WAL, diretório de dados e o TXT finalizado.

Touch ID e Secure Keyboard Entry não estão disponíveis nesta arquitetura web local. O produto não os simula nem afirma proteção contra keyloggers; essa decisão e sua compensação estão registradas na ADR-013.

## HTTP no loopback

A interface usa HTTP porque o tráfego fica no loopback e um certificado TLS local confiável exigiria instalar uma autoridade ou ignorar alertas. O token protege a API contra páginas e processos não autorizados. Um processo local executado com a mesma conta ou privilégios superiores continua fora do modelo de proteção.

## HTTPS dos equipamentos

A fixação do NetRunner é uma verificação prévia e não instala confiança no macOS nem contorna alertas do navegador. Um certificado autoassinado fixado pode continuar sendo recusado ou alertado pelo navegador padrão. Do mesmo modo, o usuário ainda pode acessar a URL fora do NetRunner; a aplicação não funciona como proxy ou política global de bloqueio.

O registro de Histórico representa o momento do handoff. A arquitetura web local não consegue observar quando a aba externa foi fechada, portanto não apresenta esse intervalo como duração real da navegação.

## Logs

O log é um registro da saída observada. Um equipamento pode não ecoar comandos; quando ecoa, esse eco passa a ser saída do equipamento. O `.sha256` detecta alterações após o fechamento, mas não constitui assinatura contra um invasor local capaz de substituir o TXT e o sidecar.

Saída maliciosa é interpretada pelo emulador headless e escrita como texto sem ANSI. OSC de título, hyperlink e clipboard não é preservado. Marcadores de paginação conhecidos são removidos, mas firmwares podem usar variantes ainda não catalogadas.

## Fora do modelo de proteção

O NetRunner não protege contra:

- macOS comprometido, malware ou administrador local malicioso;
- keylogger, captura de tela ou leitura da memória;
- extensão maliciosa instalada no navegador;
- processo local capaz de inspecionar memória ou tráfego de loopback;
- equipamento autorizado que produza saída enganosa;
- adulteração deliberada do TXT acompanhada da troca de seu `.sha256`.

## Recomendações ao usuário

- Habilitar FileVault.
- Usar um perfil de navegador corporativo atualizado e sem extensões não aprovadas.
- Manter macOS e Node.js atualizados.
- Verificar cuidadosamente mudanças de host key e certificado.

## Higiene do repositório

O código-fonte não armazena inventário, configurações coletadas, snapshots, hostnames, endereços de equipamentos, host keys, certificados confiáveis, logs ou backups. Esses dados permanecem nos diretórios privados locais documentados pela aplicação.

O `.gitignore` bloqueia bancos SQLite e seus sidecars, diretórios de dados e backups, logs de sessão, exports, arquivos de ambiente, chaves privadas e certificados. Fixtures versionadas devem usar exclusivamente hostnames claramente fictícios e faixas reservadas para documentação, como `192.0.2.0/24`, `198.51.100.0/24` e `2001:db8::/32`.
