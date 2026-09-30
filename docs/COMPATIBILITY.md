# Compatibilidade

## Legenda

- **Planejado:** baseado na especificação, ainda sem teste executado.
- **Simulado:** validado contra servidor ou fixture automatizada.
- **Hardware:** validado em equipamento real e versão documentada.

O projeto está no Marco 6, candidato v0.6.0. Os fluxos genéricos foram validados com servidores `ssh2.Server` simulados, fixtures de normalização e probes TLS simulados; isso não equivale a validação em hardware ou firmware de fabricante.

| Fabricante/plataforma | Autenticação planejada | Paginação planejada | Estado |
|---|---|---|---|
| Fortinet FortiOS | password e keyboard-interactive | sem comando automático global | Fluxo genérico simulado |
| Huawei VRP | password e keyboard-interactive | `screen-length 0 temporary` | Fluxo genérico simulado |
| Cisco Catalyst 9200/9300/9500 · IOS-XE | password e keyboard-interactive | `terminal length 0` | Runbook simulado |
| Ruckus ICX7150/7550/8200 · FastIron | password | `skip` | Runbook simulado |
| Ruckus AP/Unleashed | login dentro do shell | dependente da plataforma | Login no shell simulado |
| Juniper EX3300/4100/4300/4400 · Junos | keyboard-interactive e password | `set cli screen-length 0` | Runbook simulado |
| Aruba AP303/375/505/515/535/635/655 | Aruba Central | não aplicável | Catálogo cloud; sem SSH local |
| Mist AP43/AP63 | Mist Cloud | não aplicável | Catálogo cloud; sem SSH local |
| Huawei AirEngine 6776-58TI | iMaster | não aplicável | Catálogo cloud; sem SSH local |

Foram simulados: servidor moderno, servidor limitado a KEX SHA-1/CBC/HMAC-SHA1, senha, 2FA, `none` + login no shell, banner, TOFU, host key alterada, tentativa única, 20 sessões, 10 MB de saída, gravação sem senha, recuperação inesperada e verificação SHA-256. Fixtures de Cisco, Huawei, Juniper, Ruckus, Fortinet e Aruba cobrem ANSI, backspace e paginação comum. Testes simulados não são apresentados como validação em hardware.

No Marco 5, a política HTTPS foi validada com probes simulados para cadeia pública, certificado autoassinado, primeira fixação, mudança bloqueada, substituição explícita, URL IPv6 personalizada e registro no Histórico. Nenhuma interface HTTPS de hardware ou portal de fabricante foi validada nesta etapa.

No Marco 6, configurações, desconexão por inatividade, gestão de confianças, backup e restauração foram cobertos por testes automatizados. A interface recebeu contrato estático de acessibilidade e navegação por teclado, mas ainda requer inspeção manual com VoiceOver e nos navegadores corporativos suportados.

O painel de saúde foi validado com probes injetados e endpoints locais simulados. ICMP depende do utilitário `ping` do sistema no macOS ou Linux; em outras plataformas, ou quando o binário não está disponível, aparece como indisponível sem alterar o estado geral. Nenhum resultado desta etapa equivale a validação em hardware.

Snapshots manuais, captura de seleção do terminal, normalização, redação de padrões sensíveis, SHA-256 e comparação por linhas foram validados com configurações simuladas.

Os runbooks de switches foram validados com catálogo imutável, resolução por fabricante/tipo, API autenticada e servidor SSH simulado. A coleta usa `show running-config` no FastIron/IOS-XE, `show configuration` no Junos e `show version` nas três famílias. A paginação usa apenas estado temporário da sessão. Ainda é obrigatório validar comandos, prompts e redação em hardware e versões reais antes de uso amplo.
