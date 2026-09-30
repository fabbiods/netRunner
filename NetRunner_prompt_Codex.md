# NetRunner — especificação para desenvolvimento

> Construa o **NetRunner**: um app desktop para macOS que funciona como terminal pessoal para acessar equipamentos de rede por **SSH** e **HTTPS**, com inventário local organizado por **localidades**, **usernames** reutilizáveis, **nenhuma senha armazenada** e **opção de gravar cada sessão SSH em TXT** para auditoria e análise de incidentes. Leia a especificação inteira antes de começar.

## 0. Seu papel e forma de trabalho

Você é um Engenheiro de Software Sênior especialista em aplicações desktop seguras, SSH/TLS e equipamentos de rede corporativos (Fortinet, Huawei, Cisco, Ruckus, Juniper, Aruba, Mist).

1. **Antes de escrever qualquer código**, entregue o Plano Técnico (Marco 0, seção 13) e **aguarde minha aprovação**.
2. Depois da aprovação, implemente **um marco por vez**, na ordem da seção 13. Ao fim de cada marco, pare, envie o relatório pedido e aguarde meu OK para o próximo.
3. Segurança vem antes de conveniência. Se um requisito for inviável, inseguro ou ambíguo, **aponte e proponha uma alternativa** — nunca implemente algo diferente em silêncio.
4. Não adicione funcionalidades fora do escopo (seção 14) sem perguntar.
5. Código, identificadores, comentários e commits em inglês (Conventional Commits); interface e documentação de usuário em PT-BR.
6. Crie e mantenha um `AGENTS.md` na raiz com as convenções do projeto e os comandos exatos de instalação, dev, lint, typecheck, testes e build.
7. Você não tem acesso aos equipamentos reais: simule-os com servidores SSH de teste (seção 11). Nunca declare algo como testado sem ter executado o teste.
8. O ambiente de desenvolvimento pode ser Linux: tudo, exceto o empacotamento para macOS, deve compilar e ser testável em Linux.

## 1. Visão do produto

- **Nome:** NetRunner (referência aos netrunners de Cyberpunk 2077).
- **Usuário:** engenheiro de redes que administra firewalls, switches e access points de vários fabricantes, distribuídos por muitas localidades, inclusive em mais de um país.
- **Princípios:** seguro por padrão; nenhuma senha persistida; 100% local (sem nuvem, sem telemetria); tudo organizado por localidade; toda sessão SSH pode ser documentada; interface limpa, moderna e rápida.

Referências de mercado — inspiração de UX e funcionalidade, sem copiar código, marcas ou assets:
- **SecureCRT:** gerenciador de sessões em árvore; log por sessão com timestamp e nome de arquivo configurável; realce de palavras-chave; atraso de envio ao colar.
- **iTerm2:** perfis, busca no buffer, triggers de realce, Secure Keyboard Entry.
- **PuTTY:** política de algoritmos com alerta para os fracos; cache de host keys com alerta forte quando a chave muda.
- **MobaXterm:** sessões organizadas em pastas na barra lateral; abas.
- **Xshell:** abas, gerenciador de sessões, conjuntos de realce.

## 2. Stack

Use esta stack, nas versões estáveis mais recentes e com lockfile. Não a troque sem me consultar.

- **Electron** com **Electron Forge + Vite** (se houver limitação real, `electron-vite` + `electron-builder`, justificando no plano). Alvo: macOS **arm64** (Apple Silicon); x64/universal opcional. Node.js LTS.
- **TypeScript** em modo `strict` no projeto inteiro.
- **Renderer:** React, Tailwind CSS, componentes acessíveis com Radix UI/shadcn/ui, ícones `lucide-react`, `cmdk` (paleta de comandos), React Hook Form + Zod, i18next.
- **Terminal:** `@xterm/xterm` com os addons `fit`, `webgl` (fallback para o renderer DOM), `search`, `web-links` e `unicode11`; `@xterm/headless` no processo main para gerar o log limpo.
- **SSH:** `ssh2`, no processo main.
- **Banco local:** SQLite via `better-sqlite3`, com migrações versionadas.
- **Testes:** Vitest; Playwright para Electron (E2E, quando o ambiente permitir).

Por que esta stack: o `ssh2` permite controlar kex, cifras, MACs e host keys por dispositivo (essencial para equipamentos legados) e oferece um `Server` para simular equipamentos nos testes; o Electron permite tratar os certificados autoassinados das interfaces web dos equipamentos com fixação (TOFU); e o núcleo é testável em Linux.

Atenções conhecidas:
- O Electron usa **BoringSSL** (não OpenSSL) no `crypto` do Node. Valide, com testes executados **sob o runtime do Electron** (ex.: `ELECTRON_RUN_AS_NODE=1`), que cada algoritmo do perfil Legado funciona de fato.
- `better-sqlite3` é módulo nativo: resolva a diferença de ABI entre Node (testes) e Electron (runtime) para que `npm test`, `npm run dev` e o build funcionem sem passos manuais.
- Bundle id sugerido: `com.netrunner.app` (ajustável). Documente a versão mínima de macOS suportada.

## 3. Requisitos funcionais

### 3.1 Localidades
- CRUD com: nome (obrigatório), sigla/código, tipo (País, Estado/Região, Cidade, Site, Prédio, Andar, Rack, Outro), localidade-pai opcional (hierarquia, ex.: `Brasil › São Paulo › Site-01`), endereço e observações.
- Os dispositivos ficam dentro de uma localidade. Barra lateral em árvore `Localidade › Dispositivos`, com contagem.
- Arrastar e soltar para mover dispositivos e reorganizar a hierarquia. "Novo dispositivo aqui", no menu da localidade, já a pré-seleciona.
- Excluir uma localidade com conteúdo exige mover o conteúdo ou confirmar explicitamente o destino.

### 3.2 Usernames (sem senha)
- CRUD com: username (obrigatório), descrição (ex.: "TACACS pessoal", "local break-glass") e um marcado como padrão.
- Não existe campo de senha em nenhum cadastro.
- Mostrar quantos dispositivos usam cada username; excluir um username em uso exige reatribuição.

### 3.3 Dispositivos
Campos:
- **Hostname** (obrigatório; é um rótulo — aceita maiúsculas e `_`).
- **Endereço:** IP ou FQDN (obrigatório; validar IPv4, IPv6 e FQDN).
- **Username:** seleção com busca na base de usernames + "Criar novo" inline.
- **Localidade:** seleção com busca (combobox/autocomplete) na base de localidades, exibindo o caminho completo + "Criar nova" inline.
- **Fabricante:** Fortinet, Huawei, Cisco, Ruckus, Juniper, Aruba, Juniper Mist, Outro.
- **Tipo:** Firewall, Switch, Access Point, Controladora WLAN, Roteador, Outro.
- **Plataforma** (opcional): FortiOS, VRP, IOS-XE, NX-OS, FastIron, Junos, AOS-8, AOS-CX etc.
- **Protocolos:** SSH (porta padrão 22) e/ou HTTPS (porta padrão 443 **ou** URL completa personalizada — necessária para portais de nuvem).
- Perfil de algoritmos SSH (4.2), modo de login — padrão ou "login no shell" (4.1) — e opções de terminal (3.4).
- Tags, observações, favorito.

Regras:
- IP ou hostname duplicado gera **aviso**, não bloqueio (localidades diferentes podem reutilizar faixas privadas).
- Busca global instantânea (hostname, IP, localidade, fabricante, tipo, tag), fluida com mais de 10.000 dispositivos.
- Seções Favoritos e Recentes.
- Edição em massa (ex.: aplicar perfil de algoritmos, username ou localidade a vários dispositivos selecionados).
- Menu de contexto: Conectar SSH, Abrir HTTPS no app, Abrir HTTPS no navegador padrão, Editar, Duplicar, Mover, Favoritar, Copiar IP/hostname, Excluir (com confirmação).

### 3.4 Sessões SSH
Fluxo de conexão:
1. Duplo clique, Enter ou paleta de comandos (⌘K) sobre o dispositivo.
2. Janela de conexão compacta, com: dados do dispositivo; username pré-selecionado (é possível escolher outro cadastrado ou digitar um avulso **só para esta conexão**); **senha, sempre obrigatória** (exceto no modo "login no shell", em que ela é digitada no próprio terminal); opção **"Gravar sessão em TXT"** — o valor inicial vem das Configurações, mas a escolha é feita **a cada conexão**; campo opcional **"Nº do chamado/change"**; botão Conectar.
3. Verificação da host key (4.3) → autenticação (4.1) → a sessão abre em nova aba, com indicador **REC** bem visível quando estiver gravando.

Terminal:
- Várias abas simultâneas, inclusive para o mesmo equipamento; renomear, reordenar e duplicar (pede a senha de novo). Fechar uma aba conectada ou sair do app com sessões abertas pede confirmação.
- Redimensionamento propagado ao equipamento (window-change).
- Scrollback configurável (padrão 20.000 linhas), busca (⌘F), copiar/colar, zoom de fonte; "copiar ao selecionar" e "colar com clique direito" (estilo PuTTY) opcionais.
- **Proteção de colagem:** colar mais de uma linha exige confirmação, com prévia e contagem de linhas; **atraso configurável por linha** (ms), porque muitos equipamentos perdem caracteres em colagens rápidas.
- Opções por dispositivo ou fabricante: tipo de terminal (padrão `xterm-256color`; também `xterm`, `vt100`, `vt220`), Backspace enviando DEL (`^?`) ou BS (`^H`), codificação (UTF-8; ISO-8859-1 opcional), Option como Meta, keepalive (intervalo e limite configuráveis, podendo desativar — alguns equipamentos antigos lidam mal com keepalive) e timeout de conexão (padrão 20 s).
- Comando pós-login opcional (ex.: desativar a paginação — seção 5), **desligado por padrão** e restrito a comandos de escopo de sessão. Nunca enviar comandos que alterem configuração.
- Desconexão (remota, timeout, queda de rede, suspensão do Mac): a aba mostra o motivo e oferece **Reconectar**, que pede a senha de novo e pergunta sobre a gravação, pré-selecionando a escolha anterior.
- Barra de status: estado, host:porta, username, algoritmos negociados (kex, cifra, MAC, host key), tamanho do terminal, indicador e caminho do log.
- Conexão rápida avulsa (`usuario@host:porta`) sem salvar o dispositivo, com as mesmas regras de senha, host key e gravação (logs em `Logs/_Avulsas/`).

### 3.5 Gravação de sessão em TXT
Objetivo: se houver um incidente, estar 100% documentado o que foi feito na CLI.
- A gravação começa antes da autenticação (captura o banner) e termina no encerramento da sessão. Cada conexão ou reconexão gera um arquivo novo; a reconexão referencia a sessão anterior no cabeçalho.
- Grava o **fluxo de saída do terminal** — o que o equipamento devolve, incluindo o eco dos comandos. **Nunca grave as teclas digitadas**: assim, senhas digitadas em prompts sem eco (`enable`, `super` etc.) não vão para o log.
- TXT legível: sem sequências ANSI, sem backspaces, sem restos de paginação (`--More--`, `---- More ----`, `---(more)---`) e sem quebras artificiais causadas pela largura do terminal. Técnica recomendada: manter, desde o início de toda sessão, um `@xterm/headless` com o mesmo tamanho do terminal visível e gravar cada linha quando ela for finalizada.
- Timestamp por linha (opcional, ligado por padrão), no formato `[AAAA-MM-DD HH:mm:ss.SSS]`.
- **Cabeçalho:** ID da sessão, app e versão, hostname, IP:porta, fabricante, tipo, caminho da localidade, username SSH, usuário local do macOS, nº do chamado (se houver), início em ISO 8601 com fuso horário, fingerprint da host key e algoritmos negociados.
- Eventos do app marcados com o prefixo `[NetRunner]` (conectando, host key aceita, autenticado, gravação iniciada/parada, desconectado).
- **Rodapé:** fim, duração e motivo do encerramento.
- Nome configurável por tokens. Padrão: `Logs/<Localidade>/<Hostname>/<AAAA-MM-DD_HHmmss>_<Hostname>_<IP>[_<Chamado>].txt`, sanitizado (sem path traversal nem caracteres inválidos).
- Pasta padrão **fora de pastas sincronizadas em nuvem** (ex.: `~/NetRunner/Logs`); alertar se o usuário escolher iCloud Drive, `~/Documents`, `~/Desktop` ou `~/Library/CloudStorage`.
- Robustez: escrita em streaming com flush periódico; se o app travar, o que já foi recebido permanece no disco; no próximo início, logs sem rodapé recebem um rodapé "encerrada inesperadamente".
- Integridade: ao encerrar, calcular o SHA-256 (arquivo `.sha256` ao lado, no formato do `shasum -a 256 -c`, e registro no índice de sessões) e deixar o log somente leitura (`0400`); pasta de logs com `0700`.
- Se o usuário optou por não gravar, permitir **iniciar a gravação no meio da sessão**, despejando o buffer atual (marcado como "conteúdo recuperado do buffer"); permitir também parar a gravação, registrando o evento.
- Tela **Histórico de sessões**: dispositivo, localidade, data, duração, chamado e protocolo, com filtros e as ações Abrir log, Mostrar no Finder e Verificar integridade.

### 3.6 Sessões HTTPS
- **No app:** aba com navegador isolado (`WebContentsView`) em partição **não persistente e exclusiva por aba**; `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, sem preload; todas as permissões negadas (câmera, microfone, localização, notificações etc.); sem salvar senhas nem autopreencher; cookies e cache apagados ao fechar a aba.
- Barra com URL, indicador do certificado, voltar/avançar/recarregar e "Abrir no navegador padrão".
- Navegação restrita ao host do dispositivo, mais uma lista opcional de domínios permitidos por dispositivo (necessária para portais de nuvem com SSO). Fora disso, abrir no navegador padrão após confirmação. Pop-ups da mesma origem abrem em nova aba do app; downloads (ex.: backup de configuração) perguntam onde salvar.
- **Certificados autoassinados** (comuns em equipamentos): tela própria com fingerprint SHA-256, emissor e validade, e a opção "Confiar neste certificado para este dispositivo" (fixação TOFU). Certificado diferente do fixado ⇒ bloquear com alerta.
- **No navegador padrão:** `shell.openExternal` apenas com URL `https://` montada a partir do cadastro validado.
- Interfaces que só oferecem TLS 1.0/1.1 ou cifras antigas não abrem no Chromium: exibir um erro claro explicando o motivo.
- Registrar o acesso HTTPS (início e fim) no índice de sessões, sem gravar conteúdo.

### 3.7 Importação, exportação e backup
- Importar dispositivos por CSV/JSON (hostname, endereço, fabricante, tipo, caminho da localidade, username, porta SSH, HTTPS/URL, tags), com validação, prévia, detecção de duplicados e criação opcional das localidades e usernames inexistentes. Importar também só localidades (CSV com o caminho completo). Aceitar CSV separado por `,` ou `;` (o Excel em PT-BR usa `;`), em UTF-8 com ou sem BOM, e oferecer um modelo de CSV para download.
- Exportar o inventário (JSON completo e CSV de dispositivos) — não há segredos a exportar.
- Backup automático do banco ao iniciar (um por dia, mantendo os 14 últimos) e restauração pelas Configurações.

## 4. Segurança (requisitos não negociáveis)

### 4.1 Senhas e autenticação
- **Nenhuma senha é persistida:** nem no SQLite, nem em arquivos, Keychain, localStorage/IndexedDB, logs do app ou relatórios de erro. Não existe a opção "lembrar senha".
- A senha é pedida a cada conexão e reconexão, em campo `type="password"` sem autocomplete nem corretor; fica em memória só durante a autenticação e é descartada em seguida (limpar o campo e as referências; nunca guardar em estado global do renderer; nunca escrever no terminal). Documente no `SECURITY.md` os limites de "apagar da memória" em JavaScript.
- Métodos: `password` e `keyboard-interactive` com vários prompts (ex.: senha + token/OTP de 2FA). O primeiro prompt sem eco recebe a senha digitada no modal; os demais são exibidos ao usuário, respeitando a flag `echo` de cada um.
- **Modo "login no shell"** (ex.: APs Ruckus, que aceitam o SSH e pedem `Please login:` dentro do terminal): o modal não pede senha e o usuário a digita no terminal. **Nunca** envie senha automaticamente para o fluxo do shell.
- **Evite bloqueio de conta no AAA (TACACS+/RADIUS/AD):** use os métodos anunciados pelo servidor, com **uma tentativa por senha digitada**, sem repetir a mesma senha em vários métodos; se o servidor pedir a senha de novo, mostre o prompt ao usuário em vez de reenviá-la.
- Exibir o banner pré-autenticação (e gravá-lo, se a gravação estiver ativa).
- Autenticação por chave pública: fora do escopo (política: sempre senha).
- **Teste obrigatório "senha canário":** usar uma senha única nos testes de integração e provar que ela não aparece no banco, nos logs de sessão, nos logs do app, nas configurações nem em nenhum arquivo do diretório de dados.

### 4.2 Algoritmos SSH (perfil por dispositivo)
- **Moderno (padrão):** kex `curve25519-sha256`, `ecdh-sha2-nistp256/384/521`, `diffie-hellman-group-exchange-sha256`, `diffie-hellman-group16-sha512`, `diffie-hellman-group18-sha512`, `diffie-hellman-group14-sha256`; host keys `ssh-ed25519`, `ecdsa-sha2-nistp*`, `rsa-sha2-512`, `rsa-sha2-256`; cifras `chacha20-poly1305@openssh.com`, `aes256-gcm@openssh.com`, `aes128-gcm@openssh.com`, `aes256-ctr`, `aes192-ctr`, `aes128-ctr`; MACs `hmac-sha2-512-etm@openssh.com`, `hmac-sha2-256-etm@openssh.com`, `hmac-sha2-512`, `hmac-sha2-256`.
- **Legado (opt-in por dispositivo):** acrescenta, com prioridade menor, `diffie-hellman-group14-sha1`, `diffie-hellman-group-exchange-sha1`, `diffie-hellman-group1-sha1`, `ssh-rsa`, `ssh-dss`, `aes256-cbc`, `aes192-cbc`, `aes128-cbc`, `3des-cbc` e `hmac-sha1`. Dispositivos em Legado exibem um marcador de alerta em toda a UI.
- **Personalizado:** seleção e ordenação por categoria (inspirado no PuTTY).
- **Nunca permitidos:** SSH v1, cifra `none`, `arcfour*`, `blowfish-cbc`, `cast128-cbc`, MACs MD5.
- **Diagnóstico de handshake:** sem algoritmo em comum, mostrar o que o equipamento ofereceu (kex, cifra, MAC, host key) e sugerir o perfil Legado **só para aquele dispositivo**. Obtenha isso do debug do `ssh2`, filtrando apenas as linhas de handshake — nunca registre o debug completo.
- Visão/filtro **"Criptografia legada"**: dispositivos que só negociam algoritmos fracos (insumo para hardening).
- Valide as listas contra a versão instalada do `ssh2` e contra o runtime do Electron.

### 4.3 Host keys (TOFU)
- Primeira conexão: exibir o tipo e a fingerprint SHA-256 (formato OpenSSH) e exigir aceite explícito.
- Guardar em tabela própria (host, porta, tipo, fingerprint, primeira e última vez vista).
- Chave diferente da armazenada ⇒ **bloquear** a conexão com alerta de possível MITM. Atualizar a chave (ex.: RMA ou troca de equipamento) exige ação deliberada, com as fingerprints antiga e nova lado a lado.

### 4.4 Hardening do Electron
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, `webviewTag: false`; preload mínimo expondo uma API tipada via `contextBridge` (nunca o `ipcRenderer` inteiro).
- Todo IPC validado com Zod e com verificação do remetente (`senderFrame`); canais explícitos e mínimos.
- CSP restritiva: sem `unsafe-eval`; `unsafe-inline` só em `style-src`, se o xterm.js exigir; `connect-src 'self'` (em dev, liberar apenas o necessário ao HMR). O renderer não acessa rede, disco nem Node.
- Em produção, carregar a UI por protocolo customizado (`protocol.handle`), não `file://`; bloquear `will-navigate`; `setWindowOpenHandler` negando por padrão.
- Electron Fuses: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on, `EnableCookieEncryption` on.
- DevTools desabilitado em produção; instância única (`requestSingleInstanceLock`); **zero telemetria** e nenhuma chamada de rede que não tenha sido iniciada pelo usuário; fontes e ícones embarcados (sem CDN); sem auto-update nesta versão.
- Terminal: não habilitar OSC 52 (escrita na área de transferência por sequência de escape); sanitizar títulos definidos por OSC; links só com ⌘+clique, apenas `http/https`, com confirmação.

### 4.5 Dados locais
- Dados em `~/Library/Application Support/NetRunner/` (diretório `0700`, banco `0600`), SQLite em modo WAL, migrações versionadas e checagem de integridade ao iniciar.
- Logs de diagnóstico do app nunca contêm conteúdo das sessões nem segredos (redação obrigatória).
- Validar e sanitizar todas as entradas (endereços, portas, nomes de arquivo, importações).
- Criptografia do banco em repouso (ex.: SQLCipher com chave no Keychain): apenas documentar como evolução; recomendar FileVault no `SECURITY.md`.
- Dependências: preferir poucas e bem mantidas; revisar os scripts de instalação de toda dependência nova.

### 4.6 Opções de segurança (Configurações, desligadas por padrão)
- Desconexão automática após X minutos sem interação.
- Bloqueio do app com Touch ID ou senha do macOS (`systemPreferences.promptTouchID`) ao abrir e após inatividade.
- Secure Keyboard Entry (como no iTerm2 e no Terminal) enquanto o terminal estiver em foco — pode exigir módulo nativo; planeje para o último marco.

## 5. Compatibilidade com equipamentos

Crie o `docs/COMPATIBILITY.md` com uma matriz por fabricante (autenticação, algoritmos esperados, paginação, peculiaridades e como foi testado), validando cada item na documentação oficial. Ponto de partida:

| Fabricante / plataforma | Pontos de atenção |
|---|---|
| Fortinet FortiGate (FortiOS) | `keyboard-interactive` com FortiToken (2FA); post-login banner que exige aceite; a paginação é configuração **global** (`config system console`) ⇒ nunca enviar comando automático; `strong-crypto` altera os algoritmos; versões antigas podem exigir CBC/SHA-1; GUI HTTPS com certificado autoassinado. |
| Huawei VRP (switches, APs, ACs) | Versões antigas exigem o perfil Legado; prompt de troca de senha no primeiro login (`Change now? [Y/N]`); `---- More ----` apagado com sequências ANSI de cursor; comando de sessão: `screen-length 0 temporary`. |
| Cisco IOS / IOS-XE / NX-OS | `--More--` apagado com backspaces; comando de sessão: `terminal length 0`; IOS antigo exige Legado; `enable` pede senha dentro da sessão (sem eco); equipamentos só com SSHv1 não são suportados (mensagem clara). |
| Ruckus ICX (FastIron) | Firmwares antigos exigem Legado; comando de sessão: `skip-page-display`. |
| Ruckus APs / Unleashed / SmartZone | Login dentro do shell após o SSH (`Please login:`) ⇒ modo "login no shell"; a SmartZone pede senha no `enable`. |
| Juniper Junos (EX/QFX/SRX/MX) | `keyboard-interactive` comum com RADIUS/TACACS; `---(more)---`; comando de sessão: `set cli screen-length 0`; root entra no shell (`%`) antes do `cli`; o redimensionamento precisa ser propagado. |
| Aruba (AOS-8, Instant, AOS-CX, ArubaOS-Switch) | Controladoras: `no paging`; AOS-CX e ArubaOS-Switch: `no page`; o ArubaOS-Switch mostra "Press any key to continue" e usa muitas sequências VT100 de cursor (validar o log limpo). |
| APs gerenciados em nuvem (Juniper Mist, Aruba Central/AOS-10, Ruckus One) | Podem não expor SSH local ou tê-lo desativado; acesso pelo portal HTTPS ⇒ URL personalizada e domínios permitidos. |

Requisitos gerais: IPv4, IPv6 e FQDN; respeitar o DNS e a VPN do sistema; reagir a mudanças de rede e à suspensão do Mac; Telnet e HTTP sem TLS não são suportados nesta versão.

## 6. Interface (UI/UX)

**Direção visual.** Uma ferramenta de engenharia de redes com alma de netrunner. A identidade nasce do mundo real de quem opera redes — cores de cabos de fibra, LEDs de porta, etiquetas de patch panel — e o aceno ao cyberpunk fica concentrado em um único elemento marcante: o momento de conectar ("jack-in"). A identidade é **original**: não use logos, fontes, imagens ou marcas do jogo nem dos fabricantes.

**Tokens iniciais** (ajuste para contraste WCAG AA; os temas claro e alto contraste derivam dos mesmos papéis):

| Papel | Nome | Cor |
|---|---|---|
| Fundo (escuro por função: sessões longas de terminal) | Grafite | `#12161B` |
| Superfícies e bordas | Chassi | `#1A2028` e `#222A34`; bordas `#2E3844` |
| Texto e texto secundário | Etiqueta | `#E4E8EE` e `#8A94A3` |
| Ação primária e aba ativa | Fibra monomodo | `#F5C542` (com texto escuro) |
| Foco e seleção | Fibra multimodo | `#2EC4C9` |
| Conectado | LED de link | `#52D273` |
| Alerta e perfil Legado | LED âmbar | `#FFA630` |
| Erro e ações destrutivas | Falha | `#FF5A5F` |

**Tipografia.** IBM Plex Sans na interface e IBM Plex Mono no terminal e nos campos de endereço e comando — uma única superfamília, licença OFL, embarcada (ex.: pacotes `@fontsource/ibm-plex-sans` e `@fontsource/ibm-plex-mono`). Escala tipográfica definida, algarismos tabulares para IPs, portas e horários, textos em caixa normal. A fonte do terminal é configurável (ex.: SF Mono, Menlo, JetBrains Mono).

**O elemento marcante: a linha de handshake.** Ao conectar, uma linha fina no topo da aba percorre as etapas TCP → troca de chaves → host key → autenticação → shell, como um pulso de luz na fibra. Se algo falhar, a etapa fica vermelha e a causa aparece em linguagem clara (ex.: "O equipamento não oferece nenhum algoritmo de troca de chaves permitido"). Além dela, só as abas de sessão e a janela de conexão têm cantos chanfrados. O resto da interface é quieto e disciplinado.

**Evite:** excesso de neon, glow, scanlines ou glitch; gradientes decorativos; telas feitas de cartões idênticos com a mesma sombra; rótulos em caixa alta espaçada; animações de entrada em todos os elementos. Movimento apenas em resposta a ações (abrir, conectar, confirmar), respeitando "reduzir movimento".

**Microtexto.** Verbos no ativo e botões que dizem o que fazem ("Conectar", "Confiar neste certificado", "Iniciar gravação"); o mesmo termo do começo ao fim do fluxo (Conectar → Conectado); erros dizem o que aconteceu e como resolver, sem pedir desculpas; telas vazias convidam a agir ("Cadastre sua primeira localidade").

**Layout de referência:**

```text
┌────────────────────┬────────────────────────────────────────────────────┐
│ Buscar (Cmd+K)     │ /SW-CORE-01 [REC]\ /FW-BORDA-01\  +                │
│                    ├────────────────────────────────────────────────────┤
│ Favoritos          │ ━━━━━━━━━━━━━━━━━━━━━━━━  handshake concluído      │
│ Recentes           │ <SW-CORE-01>display interface brief                │
│ Brasil             │ ...                                                │
│ └ São Paulo        │                                                    │
│   └ Site-01        │                                                    │
│     ├ SW-CORE-01   │                                                    │
│     └ FW-BORDA-01 !│                                                    │
│                    │                                                    │
│ + Dispositivo      │                                                    │
├────────────────────┴────────────────────────────────────────────────────┤
│ Conectado | 192.0.2.10:22 | netadmin | curve25519 | aes256-gcm | REC    │
└─────────────────────────────────────────────────────────────────────────┘
```

Legenda: `/ \` = cantos chanfrados das abas; `[REC]` = sessão sendo gravada; `!` = dispositivo com perfil Legado.

- **Barra lateral:** busca, Favoritos, Recentes e árvore `Localidade › Dispositivos` (ícones genéricos por tipo — firewall, switch, AP — e fabricante escrito em texto, sem logos); agrupamento alternativo por fabricante/tipo; marcadores de Legado e de sessão aberta.
- **Área principal:** abas SSH/HTTPS; sem sessões abertas, tela inicial com conexão rápida, recentes e resumo do inventário.
- **Barra de status** (3.4) e **paleta de comandos ⌘K** (buscar e conectar, abrir telas, executar ações).
- **Telas:** Dispositivos, Localidades, Usernames, Histórico de sessões, Host keys e certificados confiáveis, Configurações (Aparência, Terminal, Sessões e logs, Segurança, SSH, Backup e importação).
- **Atalhos:** ⌘K paleta, ⌘T conexão rápida, ⌘W fechar aba, ⌘1–9 trocar de aba, ⌘F buscar no terminal, ⌘+/⌘− fonte, ⌘, Configurações.
- Estados vazio, carregando e erro bem resolvidos; boa experiência de um MacBook 13" a um monitor externo.
- Realce de palavras-chave configurável no terminal (ex.: `down`, `error`, `fail`, `critical`, `%LINK-3-UPDOWN`) — só visual, não altera o log.
- Se o ambiente permitir, capture screenshots das telas principais (Playwright) para revisar o visual e anexe ao relatório do Marco 6.

## 7. Acessibilidade e idioma
- Navegação completa por teclado, foco visível, rótulos para VoiceOver, contraste WCAG AA (inclusive nas cores de acento) e tamanho de fonte ajustável.
- Interface em PT-BR com i18n estruturado (i18next), pronta para espanhol e inglês.

## 8. Arquitetura e dados
- **Main (Node):** sessões SSH (`ssh2`), gravador (headless + disco), repositórios SQLite, host keys e certificados, configurações, sessões HTTPS e handlers IPC. Se o processamento da saída pesar, mova-o para um `utilityProcess`.
- **Preload:** ponte mínima e tipada. **Renderer:** UI e xterm.js, sem acesso a Node, disco ou rede. **Shared:** tipos e schemas Zod (contrato IPC único e versionado).
- Controle de fluxo no terminal (agrupar chunks; usar o callback de `write` do xterm.js) para suportar saídas grandes (`show tech`, `display current-configuration`) sem travar.
- Motor SSH atrás de uma interface (`SshTransport`), preparado para evoluções (jump host, SFTP).
- Perfis de fabricante como dados editáveis (tipo de terminal, comando de paginação sugerido, perfil de algoritmos sugerido, observações), para incluir fabricantes sem mudar código.
- Modelo mínimo (refine no plano): `locations` (hierarquia via `parent_id`), `usernames`, `devices`, `vendor_profiles`, `known_hosts`, `trusted_certificates`, `sessions` (índice: dispositivo, protocolo, início/fim, motivo, caminho e SHA-256 do log, chamado, algoritmos negociados), `settings` e `schema_migrations`. Chaves UUID; `created_at`/`updated_at` em todas as tabelas.
- Dados de exemplo apenas fictícios, com IPs de documentação (`192.0.2.0/24`, `198.51.100.0/24`, `2001:db8::/32`).

## 9. Desempenho (Apple Silicon)
- Abertura do app em menos de 2 s; busca na barra lateral em menos de 100 ms com 10.000 dispositivos (listas virtualizadas).
- Terminal fluido recebendo 10 MB de saída; 20 sessões simultâneas sem degradação perceptível.

## 10. Qualidade de código
- ESLint + Prettier; `tsc --noEmit` sem erros; sem `any` implícito; módulos pequenos e testáveis; erros tipados e tratados.
- Dependências justificadas no plano e com versões fixadas; `npm audit --omit=dev` sem vulnerabilidades altas ou críticas.

## 11. Testes
- **Unitários:** validações (endereços, portas), sanitização de nomes de arquivo, montagem dos perfis de algoritmos, lógica TOFU (host key e certificado), repositórios e migrações, contrato IPC.
- **Log limpo:** fixtures sintéticas com ANSI, backspaces, `\r`, linhas quebradas pela largura e os padrões de paginação típicos de Cisco, Huawei, Junos, FortiOS, Aruba e Ruckus; o TXT final precisa sair limpo.
- **Integração com `ssh2.Server` simulando equipamentos:**
  1. Servidor só com algoritmos modernos.
  2. Servidor só legado (`diffie-hellman-group1-sha1`/`diffie-hellman-group14-sha1`, `ssh-rsa`, `aes128-cbc`, `3des-cbc`): falha no perfil Moderno com diagnóstico correto e sucesso no Legado — **também sob o runtime do Electron**.
  3. `keyboard-interactive` com dois prompts (senha + OTP).
  4. `none` + login dentro do shell (estilo Ruckus).
  5. Banner pré-autenticação exibido e gravado.
  6. Host key alterada ⇒ conexão bloqueada.
  7. Senha errada ⇒ uma única tentativa por senha digitada.
  8. Saída paginada ⇒ log limpo, com cabeçalho, rodapé e SHA-256 válidos.
  9. Senha canário (4.1).
- **E2E** (Playwright + Electron, se o ambiente permitir, ex.: xvfb): criar localidade, username e dispositivo; conectar ao servidor de teste; gravar e conferir o log.
- **CI (GitHub Actions):** lint, typecheck e testes em Ubuntu; build em runner macOS gerando `.dmg`/`.zip` como artefato.

## 12. Documentação
- `README.md` (PT-BR): requisitos, instalação, dev, testes, build local no Mac (assinatura ad hoc) e passo a passo opcional de assinatura com Developer ID, hardened runtime e notarização.
- `AGENTS.md`; `docs/ARCHITECTURE.md` (com diagrama Mermaid); `docs/SECURITY.md` (modelo de ameaças: ativos, ameaças, mitigações e o que o app **não** protege — ex.: um macOS comprometido); `docs/COMPATIBILITY.md`; `docs/DECISIONS.md` (registro de decisões); `CHANGELOG.md`.

## 13. Marcos
- **Marco 0 — Plano (sem código; aguardar aprovação):** stack e versões; arquitetura e contrato IPC; modelo de dados; estrutura de pastas; matriz de compatibilidade inicial; modelo de ameaças resumido; plano de testes; riscos; e até 5 perguntas objetivas para mim.
- **Marco 1 — Fundação:** projeto Electron + Vite + React + TS strict; hardening (4.4); IPC tipado; lint, testes e CI; `AGENTS.md` e README.
- **Marco 2 — Inventário:** SQLite, migrações e backups; CRUD de localidades (com hierarquia), usernames e dispositivos; árvore, busca, favoritos/recentes, seleção com busca, edição em massa; importação e exportação.
- **Marco 3 — SSH:** janela de conexão; TOFU; `password`, `keyboard-interactive` e login no shell; perfis de algoritmos e diagnóstico; abas; redimensionamento; keepalive; reconexão; proteção de colagem; opções por fabricante.
- **Marco 4 — Gravação:** TXT limpo com timestamps, cabeçalho e rodapé, SHA-256, índice, recuperação após falha, iniciar/parar no meio da sessão, Histórico de sessões.
- **Marco 5 — HTTPS:** navegador isolado, fixação de certificado, domínios permitidos, navegador externo, registro no índice.
- **Marco 6 — Acabamento:** identidade visual e temas, linha de handshake, paleta ⌘K, atalhos, realce de palavras-chave, Configurações, acessibilidade, i18n, metas de desempenho, opções de segurança (4.6), empacotamento para macOS e revisão final de segurança com o checklist da seção 4 marcado item a item.

Um marco só está pronto com lint, typecheck e testes passando, documentação atualizada e um relatório com: o que foi feito, comandos para eu testar, evidências dos testes executados e limitações conhecidas.

## 14. Fora do escopo desta versão (a arquitetura deve permitir no futuro)
Telnet e HTTP sem TLS, autenticação por chave pública, console serial (USB), SFTP/SCP, jump host/ProxyJump, port forwarding, painéis divididos, envio de comandos para várias sessões ao mesmo tempo, biblioteca de comandos, gravação bruta para replay (asciicast), terminal local e sincronização entre máquinas.

## 15. Checklist de aceite (requisitos originais)
- [ ] Cadastro de dispositivos com IP, hostname, username (selecionado da base) e localidade (seleção com busca na base de localidades).
- [ ] Localidades criadas por mim, com os dispositivos organizados dentro delas.
- [ ] Usernames cadastrados e selecionáveis na criação de um dispositivo.
- [ ] Senha exigida em todo login; nenhuma senha armazenada em lugar algum.
- [ ] Localidades, dispositivos e configurações salvos localmente.
- [ ] Acesso por SSH e por HTTPS.
- [ ] Em toda sessão SSH, a opção de gravar ou não em TXT, com log completo e íntegro.
- [ ] Compatível com firewalls FortiGate, switches Huawei, Cisco, Ruckus e Juniper, e access points Aruba, Mist, Ruckus e Huawei (seção 5).
- [ ] App chamado NetRunner, com layout limpo e moderno.
- [ ] Segurança, compatibilidade, escalabilidade e acessibilidade validadas e documentadas.
