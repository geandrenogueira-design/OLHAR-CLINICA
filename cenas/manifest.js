/* ==========================================================================
   OLHAR — manifesto de cenas
   --------------------------------------------------------------------------
   Cada cena declara:
     arquivo  imagem em cenas/ — o carregador aceita .jpg .jpeg .png .webp
              e extensão dupla ("avenida-dia.jpg.png"). Se o arquivo faltar,
              o app cai na cena desenhada de reserva e avisa no painel.
     fov      campo horizontal do QUADRO INTEIRO, em graus. É o número que
              torna o desfoque fisicamente correto — confira com a tecla A.
     dist     distância do objeto em metros. 0 = longe (sem demanda acomodativa).
     pupila   diâmetro pupilar sugerido em mm (maior no escuro).
     glare    true nas cenas noturnas: acende o halo em torno das luzes.
     reserva  id da cena desenhada usada enquanto a foto não existe.

   O texto das placas vem gravado na própria imagem. Depois de gerar cada foto,
   abra a cena, tecla A, e calibre: o campo angular é o que define quantos
   minutos de arco a letra da placa mede de verdade para o paciente. O painel
   de ajuste mostra "letra 20/20 = N px" para você comparar na tela.
   ========================================================================== */

window.CENAS_OLHAR = [

  { id:'avenida',  nome:'Avenida de dia',        sub:'placa, ônibus e pedestres · 65°',
    arquivo:'avenida-dia.jpg',       fov:65, dist:0,    pupila:3.4, reserva:'rua' },

  { id:'noite',    nome:'Direção noturna',       sub:'faróis, halos e glare · 65°',
    arquivo:'estrada-noite.jpg',     fov:65, dist:0,    pupila:5.6, reserva:'noite', glare:true },

  { id:'fachada',  nome:'Fachada comercial',     sub:'letreiro a 15 m · 48°',
    arquivo:'fachada-comercial.jpg', fov:48, dist:0,    pupila:3.4, reserva:'rua' },

  { id:'mercado',  nome:'Prateleira do mercado', sub:'etiquetas de preço · 60 cm',
    arquivo:'supermercado.jpg',      fov:40, dist:0.60, pupila:3.2, reserva:'rua' },

  { id:'quadro',   nome:'Quadro da reunião',     sub:'4 m · 45°',
    arquivo:'quadro-reuniao.jpg',    fov:45, dist:4.0,  pupila:3.8, reserva:'quadro' },

  { id:'rosto',    nome:'Rosto a 1 metro',       sub:'reconhecimento facial · 28°',
    arquivo:'rosto-1m.jpg',          fov:28, dist:1.0,  pupila:3.4, reserva:'rosto' },

  { id:'leitura',  nome:'Página impressa',       sub:'corpo N8 a 40 cm · 26°',
    arquivo:'pagina-livro.jpg',      fov:26, dist:0.40, pupila:3.2, reserva:'leitura' },

  { id:'bula',     nome:'Bula de remédio',       sub:'corpo miúdo a 30 cm · 18°',
    arquivo:'bula-remedio.jpg',      fov:18, dist:0.30, pupila:3.2, reserva:'leitura' },

  { id:'celular',  nome:'Tela do celular',       sub:'33 cm · 14°',
    arquivo:'celular-mao.jpg',       fov:14, dist:0.33, pupila:3.2, reserva:'celular' },

  { id:'cozinha',  nome:'Cozinha de casa',       sub:'obstáculos na periferia · 60°',
    arquivo:'cozinha-casa.jpg',      fov:60, dist:0,    pupila:3.6, reserva:'rua' },

  /* gerada por código: a geometria angular precisa ser exata, foto introduz erro */
  { id:'optotipos', nome:'Tabela de optotipos',  sub:'6 m · 6° · desenhada',
    arquivo:null,                    fov:6,  dist:0,    pupila:4.0, reserva:'optotipos' }
];
