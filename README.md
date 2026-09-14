# Pokédex

## Autor
Samuel Maciel Fonseca — Matrícula 22506931

## Descrição
Aplicação web que busca e exibe Pokémon utilizando a PokeAPI. Desenvolvida com Node.js e HTML + CSS + JavaScript, com consumo assíncrono da API para carregar dados em tempo real.

## API utilizada
- **Nome:** PokeAPI
- **Documentação:** https://pokeapi.co/docs/v2
- **Endpoints consumidos:**
  - `GET /api/v2/pokemon/{id ou nome}` — dados do Pokémon (nome, tipos, stats, habilidades, altura, peso, imagem)
  - `GET /api/v2/pokemon-species/{id}` — dados de espécie (descrição, geração, cor)

## Funcionalidades
- **Busca por nome ou número:** campo de busca com pesquisa em tempo real e busca por Enter ou botão.
- **Filtros por geração:** botões para filtrar Pokémon da Gen 1 até a Gen 9.
- **Cards com informações básicas:** imagem oficial, nome, número e tipos do Pokémon.
- **Modal de detalhes:** ao clicar em um card, exibe estatísticas (HP, ATK, DEF, SP.ATK, SP.DEF, SPEED), altura, peso, experiência base, movimentos e habilidades.
- **Paginação:** botão "Carregar mais Pokémon" para carregar mais 24 a cada vez.
- **Tratamento de erros:** mensagens amigáveis para Pokémon não encontrado ou erros de rede.
- **Loading:** animação de carregamento durante requisições à API.
- **Design responsivo:** layout adaptável para desktop, tablet e mobile.

## Como executar localmente
1. Clone o repositório: `git clone https://github.com/samuelmfonseca/pokedex`
2. Acesse a pasta: `cd pokedex`
3. Instale dependências (opcional — não há dependências externas): `npm install`
4. Execute o servidor: `npm start`
5. Acesse no navegador: `http://localhost:3000`

## Estrutura do projeto
```
pokedex/
├── package.json    # Configuração do projeto (npm start)
├── server.js       # Servidor Node.js estático (porta 3000)
├── index.html      # Estrutura HTML da Pokédex
├── style.css       # Estilos CSS responsivos e cores por tipo
└── script.js       # Lógica JavaScript (fetch, busca, filtros, modal)
```

## Links
- **Aplicação no ar (GitHub Pages):** https://seu-usuario.github.io/bootcamp2-app/
- **Repositório:** https://github.com/samuelmfonseca/pokedex