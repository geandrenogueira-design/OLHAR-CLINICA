# Portal das Óticas — Guia de deploy no Cloudflare (sem R2)

Este documento leva você do zero até o portal funcionando em `olharclinica.pages.dev`.
Faça na ordem. Cada passo tem um "como conferir se deu certo" no fim.

**Tempo total esperado:** 20-30 minutos, se você nunca usou D1 antes.

**Pré-requisitos:** ter a conta do Cloudflare que já hospeda o site
`olharclinica.pages.dev`, e acesso ao repositório do GitHub que aponta pra ela.

**Diferença desta versão:** os PDFs ficam guardados dentro do próprio banco
D1 (em base64), não em um bucket R2 separado. Isso evita cadastrar cartão de
crédito — o R2 pede cartão mesmo dentro do plano gratuito, e o D1 não pede.
A troca custa ~33% de espaço a mais por PDF, sem importância no seu volume.

---

## Passo 1 — Criar o banco de dados (D1)

O D1 é o SQLite gerenciado da Cloudflare. Aqui ficam os cadastros das óticas,
os PINs (hasheados), a lista de PDFs enviados (o PDF em si incluso) e o log
de auditoria.

1. Entre no dash da Cloudflare (dash.cloudflare.com).
2. Na barra lateral, vá em **Workers & Pages → D1 SQL Database**.
3. Clique em **Create database**.
4. Nome: `olhar_portal` (exatamente assim — o binding depende).
5. Localização: **Automatic** está bom.
6. Clique em **Create**.

Depois de criado, entre no banco e vá na aba **Console**. Cole TODO o conteúdo
de `schema.sql` e clique em **Execute**. Se der certo, aparece uma confirmação
de que as tabelas foram criadas.

**Como conferir:** na aba **Tables**, você deve ver `opticas`, `documentos`,
`sessoes`, `auditoria`. Se aparecer só uma ou duas, o script parou no meio —
apague as tabelas parciais (`DROP TABLE nome_da_tabela`) e rode o schema de novo.

---

## Passo 2 — Gerar a chave privada da clínica

O sistema clínico (o `index.html` que você usa) fala com o backend usando um
"segredo compartilhado" no cabeçalho `X-Clinic-Key`. Sem esse segredo, ninguém
consegue enviar PDFs pelo `/api/portal`.

Gere um segredo aleatório longo. No próprio navegador, abra o console (F12,
aba Console) e cole:

```
Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('')
```

Ele vai retornar uma string de 64 caracteres tipo `3f2a1b...`. Copie e guarde
em lugar seguro (num gerenciador de senhas, por exemplo). Se você perder essa
chave, cria outra depois — mas todos os aparelhos que já enviam PDFs vão parar
até você atualizar a chave em todos eles.

---

## Passo 3 — Subir os arquivos ao GitHub

Copie os arquivos deste pacote para dentro do seu repositório
`OLHAR-CLINICA`, mantendo a estrutura:

```
OLHAR-CLINICA/
├── functions/
│   └── api/
│       └── portal.js          (novo)
├── portal-oticas.html         (novo)
├── schema.sql                 (novo, fica só como referência)
├── DEPLOY.md                  (novo, fica só como referência)
├── index.html                 (já existe: o sistema clínico)
├── _headers                   (já existe)
├── sw.js                      (já existe)
└── ... (resto do repo)
```

Importante: a pasta `functions` precisa ficar na raiz do repositório, e o
arquivo precisa estar em `functions/api/portal.js`. É a partir desse caminho
que o Cloudflare Pages cria a rota `/api/portal` automaticamente.

Comite e faça push como você já faz. O Cloudflare Pages vai começar o build
sozinho. Aguarde 1-2 minutos.

**Como conferir:** vá no dash, **Workers & Pages → olharclinica → Deployments**
e veja se o último deployment tem status **Success**. Se der falha, o log de
build diz o que aconteceu.

---

## Passo 4 — Conectar o D1 e a chave ao seu site

Agora o site precisa saber que existem o banco e o segredo. Isso é feito no
painel do próprio projeto Pages.

1. No dash, entre no seu projeto **olharclinica**.
2. Vá em **Settings → Functions**.
3. Role até **Bindings**.

Adicione o D1 binding:
- Variable name: `DB` (exatamente assim, maiúsculo)
- D1 database: selecione `olhar_portal`
- Salve.

Adicione a variável secreta:
- Ainda em **Settings**, vá em **Environment variables**.
- Adicione uma variável em Production:
  - Variable name: `CLINIC_KEY`
  - Value: cole aquela string longa que você gerou no Passo 2
  - Marque a caixa **Encrypt** (importante — sem isso ela aparece em texto no dash).
- Salve.

**Como conferir:** vá em **Deployments** e clique em **Retry deployment** no
mais recente (ou faça um push vazio no GitHub para forçar). Isso garante que o
site novo já sobe com o binding e a variável conectados.

---

## Passo 5 — Configurar a chave dentro do sistema clínico

Abra `olharclinica.pages.dev` como sempre e entre no sistema (PIN de sempre).
O botão do Portal das Óticas já deve aparecer na barra de utilidades. Clique.

Na primeira vez, ele vai pedir a chave privada. Cole a mesma string que você
pôs no `CLINIC_KEY`. Ela fica salva naquele aparelho (no `localStorage`),
não é sincronizada. Se você usar o sistema em outro notebook, precisa
configurar de novo lá.

---

## Passo 6 — Teste ponta a ponta

1. No sistema clínico, abra o Portal das Óticas, aba "Acessos das óticas".
2. Selecione uma ótica cadastrada. O sistema sugere um usuário (slug do nome)
   e um PIN aleatório de 6 dígitos.
3. Clique em "Salvar acesso". Deve aparecer "Acesso criado com sucesso" e
   um cartão com os dados para você entregar à ótica. Imprima ou copie.
4. Abra outra janela anônima e vá em `olharclinica.pages.dev/portal-oticas.html`.
   Faça login com o usuário e PIN que apareceram.
5. Deve entrar na tela "Suas receitas", vazia.
6. Volte ao sistema clínico, Portal das Óticas, aba "Enviar PDF".
7. Escolha uma receita da lista (precisa haver receita cadastrada), escolha
   a ótica, clique em "Disponibilizar no portal".
8. Deve aparecer "PDF disponibilizado para {nome}. Status: NOVO".
9. Volte à janela do portal da ótica, clique em "Atualizar". A receita
   deve aparecer com o badge NOVO.
10. Clique em "Abrir PDF". Ele abre em nova aba.
11. Volte à lista, o badge muda para VISUALIZADO com data/hora.

Se tudo isso funcionar, está pronto.

---

## Quando dá errado — diagnóstico rápido

"CLINIC_KEY não configurada no ambiente" — o Passo 4 não foi feito, ou o
nome da variável tem espaço/erro. Confira exatamente `CLINIC_KEY`, sem
espaços, no ambiente Production.

"Cabeçalho X-Clinic-Key ausente" — o Passo 5 não foi feito, ou você está
usando outro aparelho onde a chave não foi configurada.

"Esta ótica ainda não tem acesso" — você tentou enviar PDF antes de criar
o usuário/PIN da ótica. Faça o Acessos das óticas primeiro.

"Erro 500 no upload" — D1 não bindado, ou nome do binding errado. Volte
ao Passo 4, confira que o nome é exatamente `DB`, e refaça o deploy.

"PDF acima do limite" — o teto é 700 KB por PDF original (vira ~933 KB
em base64 dentro do D1). Receitas A5 normais (30-80 KB) nunca chegam perto
disso; se acontecer, provavelmente o PDF tem imagem pesada embutida.

"O portal da ótica dá 404" — o arquivo `portal-oticas.html` não foi comitado
na raiz do repositório, ou o deploy ainda está em andamento. Aguarde 2 minutos,
verifique em Deployments.

"PIN da ótica travado" — se a ótica errar o PIN 5 vezes, o acesso trava por
15 minutos, depois por 1h, depois por 6h (escalada). Para destravar antes,
você regera o acesso pela aba Acessos das óticas (isso zera o contador e
invalida sessões antigas).

---

## Depois que estiver funcionando: uma coisa que vale saber

Cada visualização de PDF pela ótica fica registrada na tabela `auditoria` do
D1, com data/hora e IP. Se algum dia você precisar responder à LGPD "quem viu
o prontuário do fulano", você abre o D1 e roda:

```
SELECT ts, actor, action, targetId, ip
FROM auditoria
WHERE targetId IN (
  SELECT id FROM documentos WHERE patientName = 'Fulano de Tal'
)
ORDER BY ts DESC;
```

Não é sofisticado, mas é auditável, que é o que importa em processo.

---

## Se um dia você quiser migrar para R2

Se o volume crescer muito (centenas de receitas por mês, PDFs mais pesados
com imagens de exame), migrar de "PDF no D1" para "PDF no R2" é uma mudança
localizada: só as três funções que leem/escrevem o PDF mudam, o resto do
sistema (autenticação, sessões, auditoria) continua igual. Me avise quando
chegar nesse ponto que eu adapto.

## Limites do que foi entregue

Isso não é sofisticado do lado da ótica: a interface é simples, sem app
próprio, sem notificação. Se a ótica não abrir o portal, ela não sabe
que tem receita nova.

A chave da clínica é o mesmo segredo para todos os aparelhos onde você usa
o sistema. Se você suspeitar que vazou (notebook perdido, por exemplo), gera
uma nova no Passo 2, atualiza no Passo 4 e reconfigura em cada aparelho no
Passo 5. Isso invalida a chave antiga.
