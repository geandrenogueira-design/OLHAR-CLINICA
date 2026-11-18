# DESIGN.md · Olhar — Sistema Clínico (Instituto do Olhar)

> Se este arquivo e o código discordarem, o código vence até Geandré decidir. Registre o conflito em Perguntas abertas.
> Vale só para o sistema clínico do Instituto do Olhar (Garanhuns). Nunca misturar com a Ótica São Geraldo (Lajedo).

## Produto
PWA clínico em HTML único (`index.html`), publicado no Cloudflare Pages e instalado no Edge. Dois perfis entram pela mesma
tela: Secretaria (agenda, pacientes, caixa, CRM) e Optometria (prontuário, receitas, documentos, simuladores). Uso em
notebook no consultório, com saída HDMI para TV em momentos de demonstração ao paciente (assumed: tablet também aparece no texto do PIN).
Tarefa principal da tela de login: entrar no perfil certo, com PIN, em poucos segundos.

## Público e voz
Usuários internos: Geandré (optometrista) e a secretária. Português do Brasil, linguagem clínica, frases curtas.
Datas 18/11/2026, horas 14h30, dinheiro R$ 1.250,00.

## Clima
Palavras: premium. Nunca como: (a definir — Perguntas abertas).

## Marca
Fonte do design system: `index.html` › bloco `:root` (tokens `--pri`, `--o`, `--gold`, `--cyan`, `--bg*`, `--tx*`, `--bdr*`,
`--red/--wn/--grn`, `--sh/--sh2`, `--r/--r2/--r3`, `--font*`) e o tema escuro em `[data-theme="dark"]`.
Nome no app: Instituto do Olhar.
Paleta da identidade: azul #1e2d68, marrom suave #c4966e, ciano #cde7f1, cinza #cfd5d9, branco.
Símbolo: dial em C de Landolt. Assinatura verbal: "Cuidado humano para a sua visão". Tipografia da marca: Outfit.
Ícones: Phosphor Bold (um só conjunto).

## Referências
- (nenhuma informada — Perguntas abertas)

## Restrições
Desktop/notebook primeiro (1280 px) no Edge como PWA; deve funcionar em tablet (assumed). Fonte Outfit servida localmente (`/fonts`), sem depender de CDN. Temas claro (padrão) e escuro.
Modo "conforto" ativado por padrão (classe `conforto` no `<html>`). WCAG AA. Movimento só em confirmações (assumed).

## Registro de decisões
- 2026-11-18 — Setup feito em modo "skip" a pedido de Geandré — ele quis ir direto ao redesenho do login.
- 2026-11-18 — Primeira tela a redesenhar: tela de login (escolha de perfil + PIN) — escolha de Geandré.
- 2026-11-18 — Guia do design system adiado; desenhar direto com os tokens do `:root` — aprovado por Geandré ("SIM").
- 2026-11-18 — Login em tela dividida: painel da marca em `--io-navy` (símbolo, assinatura, frase do dia) + painel de ação claro — a marca fica presente sem disputar com a escolha de perfil. Quadros em `design/1-login/`.
- 2026-11-18 — Saudação neutra até escolher o perfil; nome só depois — a secretária era saudada como Geandré.
- 2026-11-18 — PIN, primeiro acesso, código de recuperação e sessão bloqueada no próprio painel, não em pop-up — menos camadas; o bloqueio cobre o prontuário aberto.
- 2026-11-18 — Fonte Outfit e ícones Phosphor Bold embutidos (sem CDN) no login — é o que os tokens pedem e a tela não muda sem internet.
- 2026-11-18 — Mensagens de erro com altura reservada (2 linhas) e botões de largura fixa — nada pula ao errar o PIN ou ao verificar.
- 2026-11-18 — Nome da marca no app: "Instituto do Olhar" — decisão de Geandré; é o que o código já usa.
- 2026-11-18 — Perfil da optometria aparece como "Geandré", sem "Dr." — decisão de Geandré; alinha com as peças do consultório.
- 2026-11-18 — Fonte do app: Outfit (como nos tokens) — decisão de Geandré; corrigir o carregamento, que hoje só traz Inter.
- 2026-11-18 — Paleta única: `--io-navy/--io-gold/--io-sky` passam a #1e2d68/#c4966e/#cde7f1 (iguais a `--pri/--gold/--cyan`), `--io-navy-dark` = #152150 (= `--prid`), theme-color #1e2d68 — decisão de Geandré ("a nova cor"); afeta login, logo da barra lateral, títulos de página no tema claro e tela de chamada.
- 2026-11-18 — Login v2 aplicado no app (`index.html`, build v46; service worker v34; Outfit local em `/fonts`) — aprovado por Geandré para a `main`.
- 2026-11-18 — Cartão de perfil sem animação de subida no hover; só a borda escurece — movimento só onde ajuda.

## Perguntas abertas
- O que a tela nunca deve parecer? (o "nunca como" do clima)
- Referências de que ele gosta, com o que pegar e o que evitar de cada uma.
- O design system não tem tokens de tipo nem de espaçamento: os tamanhos em px do login seguem o padrão do app. Criar a escala via craft-system.
- Não há tabela de estados (hover, foco, desativado…) no design system: os estados do login estão na folha `1.1-login-states-interaction.html` até virarem regra do sistema.
- O texto do código de recuperação fala em "tablet": o sistema também roda em tablet?
