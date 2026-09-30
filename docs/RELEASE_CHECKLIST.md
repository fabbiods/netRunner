# Checklist de lançamento

## Estado da candidata v0.6.0

Esta versão conclui o escopo de implementação do Marco 6, mas permanece candidata. Os itens marcados como pendentes dependem de hardware, navegador gerenciado ou ferramentas corporativas que não estão disponíveis no ambiente de desenvolvimento.

## Controles automatizados

- [x] Serviço acessível somente por loopback, com token efêmero, validação de `Host`/`Origin` e CSP restritiva.
- [x] Nenhuma senha persistida no modelo, preferências, storage do navegador ou gravação de saída.
- [x] Host keys SSH e certificados privados protegidos por TOFU e bloqueio de mudança.
- [x] Algoritmos SSH limitados por allowlist; perfil legado exige opt-in por dispositivo.
- [x] TLS de equipamentos limitado a 1.2 ou superior no preflight.
- [x] Logs incrementais privados, normalizados e selados com SHA-256.
- [x] Desconexão por inatividade validada e aplicada no processo local.
- [x] Backups e restaurações validados, com restauração na inicialização e backup de emergência.
- [x] Interface sem CDN, telemetria, assets ou storage externos.
- [x] Navegação principal e paleta operáveis por teclado; foco visível e movimento reduzido.
- [x] Busca FTS5 validada com 10.000 dispositivos abaixo da meta local.
- [x] Painel de saúde sob demanda sem credenciais, com lote limitado, concorrência controlada e retenção local.
- [x] Snapshots normalizados com SHA-256, limites de tamanho/linhas e diff restrito ao mesmo dispositivo.
- [x] Redação obrigatória de segredos conhecidos antes da persistência de snapshots e backups.
- [x] Catálogo de runbooks imutável, comandos somente leitura e execução resolvida no backend por dispositivo.

## Validação antes de distribuição corporativa

- [x] Executar `npm run verify` com a versão exata do Node.js 24.21 LTS. Validado em 30/09/2026 com Node.js 24.21.0 e npm 11.19.0: 77 testes aprovados.
- [ ] Submeter `package-lock.json` e o artefato ao scanner corporativo de componentes. O endpoint `npm audit` do Fury retorna HTTP 400 e nenhum registro público deve ser usado como fallback.
- [ ] Validar assinatura, notarização e política de distribuição escolhida. O pacote atual requer Node instalado e não é um aplicativo `.app` assinado.
- [ ] Executar VoiceOver e navegação completa por teclado no Safari e no navegador corporativo homologado.
- [ ] Testar senha, OTP e login dentro do shell em ao menos um equipamento real por família prioritária.
- [ ] Testar TOFU, troca de host key e perfis Moderno/Legado em laboratório isolado.
- [ ] Validar runbooks e retorno do prompt em ao menos um switch Ruckus ICX, Juniper EX e Cisco Catalyst com suas versões reais.
- [ ] Testar preflight e handoff HTTPS com certificado público, CA privada e autoassinado em hardware real.
- [ ] Confirmar comportamento com VPN, proxy, EDR e política de navegador corporativa ativos.
- [ ] Validar backup e restauração com cópia protegida dos dados de homologação.
- [ ] Fazer revisão do modelo de ameaças e aceite formal das limitações de Touch ID, Secure Keyboard Entry e navegador externo.

## Comandos da entrega

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
npm run benchmark:inventory
npm run package
```

Evidência local de 30/09/2026: instalação limpa concluída, `npm run verify` com 77/77 testes aprovados, benchmark de inventário com p95 de 0,20 ms para 10.000 dispositivos e pacote local criado com sucesso, todos sob Node.js 24.21.0.

O lançamento 1.0 só deve ser promovido depois que os itens corporativos e de hardware aplicáveis forem registrados com evidência.
