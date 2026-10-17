// ===== Constants =====
const API_BASE = 'https://pokeapi.co/api/v2';
const POKEMON_PER_PAGE = 24;
const TOTAL_POKEMON = 1025;

const GENERATIONS = {
  1: [1, 151],
  2: [152, 251],
  3: [252, 386],
  4: [387, 493],
  5: [494, 649],
  6: [650, 721],
  7: [722, 809],
  8: [810, 905],
  9: [906, 1025],
};

const TYPE_COLORS = {
  normal: '#a8a878',
  fire: '#f08030',
  water: '#6890f0',
  electric: '#f8d030',
  grass: '#78c850',
  ice: '#98d8d8',
  fighting: '#c03028',
  poison: '#a040a0',
  ground: '#e0c068',
  flying: '#a890f0',
  psychic: '#f85888',
  bug: '#a8b820',
  rock: '#b8a038',
  ghost: '#705898',
  dragon: '#7038f8',
  dark: '#705848',
  steel: '#b8b8d0',
  fairy: '#ee99ac',
};

const STAT_NAMES = {
  hp: 'HP',
  attack: 'ATK',
  defense: 'DEF',
  'special-attack': 'SP.ATK',
  'special-defense': 'SP.DEF',
  speed: 'SPEED',
};

const STAT_KEYS = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];

// Backend próprio (Rust + Axum + SQLite). Quando a página é servida pelo
// próprio backend, a API fica na mesma origem; no GitHub Pages ou abrindo o
// arquivo direto, aponta para o backend local.
const TEAM_API = (location.protocol === 'file:' || location.hostname.endsWith('github.io')
  ? 'http://localhost:8080'
  : '') + '/api/team';
const MAX_TEAM_SIZE = 6;

// ===== State =====
let team = [];
let allPokemon = [];
let currentList = [];
let currentPage = 0;
let currentGeneration = 'all';
let isLoading = false;
let searchTimeout = null;

// ===== DOM Elements =====
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const pokemonGrid = document.getElementById('pokemon-grid');
const loading = document.getElementById('loading');
const errorMessage = document.getElementById('error-message');
const errorText = document.getElementById('error-text');
const loadMoreContainer = document.getElementById('load-more-container');
const loadMoreBtn = document.getElementById('load-more-btn');
const modalOverlay = document.getElementById('modal-overlay');
const modalContent = document.getElementById('modal-content');
const modalClose = document.getElementById('modal-close');
const filterBtns = document.querySelectorAll('.filter-btn');
const teamSlots = document.getElementById('team-slots');
const teamCount = document.getElementById('team-count');
const teamStatus = document.getElementById('team-status');

// ===== Utility Functions =====
function formatId(id) {
  return '#' + String(id).padStart(3, '0');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getTypeColor(type) {
  return TYPE_COLORS[type] || '#888';
}

function getPokemonImage(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

function getPokemonSprite(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

function getOfficialArtwork(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

function getShinySprite(id) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${id}.png`;
}

// ===== UI Helpers =====
function showLoading() {
  loading.classList.remove('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
}

function showError(msg) {
  errorText.textContent = msg;
  errorMessage.classList.remove('hidden');
}

function hideError() {
  errorMessage.classList.add('hidden');
}

function showLoadMore() {
  loadMoreContainer.classList.remove('hidden');
}

function hideLoadMore() {
  loadMoreContainer.classList.add('hidden');
}

// ===== API Functions =====
async function fetchPokemonBasic(id) {
  const res = await fetch(`${API_BASE}/pokemon/${id}`);
  if (!res.ok) throw new Error(`Pokémon ${id} não encontrado`);
  const data = await res.json();
  return {
    id: data.id,
    name: data.name,
    types: data.types.map(t => t.type.name),
    sprite: data.sprites.front_default,
    officialArtwork: data.sprites.other['official-artwork'].front_default,
    stats: data.stats.map(s => ({
      name: s.stat.name,
      value: s.base_stat,
    })),
    abilities: data.abilities.map(a => ({
      name: a.ability.name,
      isHidden: a.is_hidden,
    })),
    height: data.height,
    weight: data.weight,
    baseExperience: data.base_experience,
    moves: data.moves.length,
    species: data.species.name,
  };
}

async function fetchPokemonSpecies(id) {
  const res = await fetch(`${API_BASE}/pokemon-species/${id}`);
  if (!res.ok) return null;
  const data = await res.json();
  const flavorEntry = data.flavor_text_entries.find(
    e => e.language.name === 'pt' || e.language.name === 'en'
  );
  const generation = data.generation ? data.generation.name : '';
  const color = data.color ? data.color.name : '';
  const habitat = data.habitat ? data.habitat.name : '';
  const shape = data.shape ? data.shape.name : '';
  return {
    description: flavorEntry ? flavorEntry.flavor_text.replace(/[\n\f]/g, ' ') : '',
    generation,
    color,
    habitat,
    shape,
  };
}

async function loadPokemonList(rangeStart, rangeEnd) {
  const promises = [];
  for (let i = rangeStart; i <= rangeEnd; i++) {
    promises.push(fetchPokemonBasic(i).catch(() => null));
  }
  const results = await Promise.all(promises);
  return results.filter(Boolean);
}

// ===== Team (CRUD no backend) =====
async function teamRequest(path, options = {}) {
  const res = await fetch(TEAM_API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erro ${res.status} ao falar com o servidor`);
  }
  return res.status === 204 ? null : res.json();
}

function setTeamStatus(msg, isError = false) {
  teamStatus.textContent = msg;
  teamStatus.classList.toggle('team-status-error', isError);
}

// READ
async function loadTeam() {
  try {
    team = await teamRequest('');
    setTeamStatus(team.length ? 'Clique em um Pokémon para ver detalhes.' : 'Seu time está vazio. Abra um Pokémon e clique em "Adicionar ao time".');
  } catch (err) {
    team = [];
    setTeamStatus('Não foi possível carregar o time: backend indisponível.', true);
  }
  renderTeam();
}

// CREATE
async function addToTeam(pokemon) {
  try {
    await teamRequest('', {
      method: 'POST',
      body: JSON.stringify({
        pokemon_id: pokemon.id,
        name: pokemon.name,
        types: pokemon.types,
        sprite: pokemon.officialArtwork || getPokemonSprite(pokemon.id),
      }),
    });
    await loadTeam();
    setTeamStatus(`${capitalize(pokemon.name)} entrou para o time!`);
    return true;
  } catch (err) {
    setTeamStatus(err.message, true);
    return false;
  }
}

// UPDATE (bônus)
async function renameMember(member) {
  const input = document.querySelector(`.team-nickname[data-id="${member.id}"]`);
  const nickname = input.value.trim();
  if (nickname === (member.nickname || '')) return;
  try {
    await teamRequest(`/${member.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ nickname: nickname || null }),
    });
    await loadTeam();
    setTeamStatus('Apelido salvo.');
  } catch (err) {
    setTeamStatus(err.message, true);
  }
}

// DELETE
async function removeFromTeam(member) {
  try {
    await teamRequest(`/${member.id}`, { method: 'DELETE' });
    await loadTeam();
    setTeamStatus(`${capitalize(member.name)} saiu do time.`);
  } catch (err) {
    setTeamStatus(err.message, true);
  }
}

function createTeamSlot(member) {
  const slot = document.createElement('div');
  slot.className = 'team-slot filled';
  const bgColor = getTypeColor(member.types[0]);
  slot.style.setProperty('--slot-color', bgColor);

  slot.innerHTML = `
    <button class="team-remove" title="Remover do time" aria-label="Remover do time">&times;</button>
    <img class="team-image" src="${member.sprite || getPokemonSprite(member.pokemon_id)}" alt="">
    <div class="team-name"></div>
    <input class="team-nickname" data-id="${member.id}" maxlength="20" placeholder="Apelido">
    <div class="card-types">
      ${member.types.map(t => `<span class="type-badge" style="background: ${getTypeColor(t)}">${t}</span>`).join('')}
    </div>
  `;
  slot.querySelector('.team-name').textContent = `${formatId(member.pokemon_id)} ${capitalize(member.name)}`;

  const nicknameInput = slot.querySelector('.team-nickname');
  nicknameInput.value = member.nickname || '';
  nicknameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nicknameInput.blur();
  });
  nicknameInput.addEventListener('blur', () => renameMember(member));

  slot.querySelector('.team-remove').addEventListener('click', () => removeFromTeam(member));
  slot.querySelector('.team-image').addEventListener('click', async () => {
    try {
      openModal(await fetchPokemonBasic(member.pokemon_id));
    } catch (err) {
      setTeamStatus(err.message, true);
    }
  });
  return slot;
}

function renderTeam() {
  teamSlots.innerHTML = '';
  team.forEach(member => teamSlots.appendChild(createTeamSlot(member)));
  for (let i = team.length; i < MAX_TEAM_SIZE; i++) {
    const empty = document.createElement('div');
    empty.className = 'team-slot empty';
    empty.innerHTML = '<div class="pokeball-icon team-empty-ball"><div class="pokeball-top"></div><div class="pokeball-band"></div><div class="pokeball-bottom"></div><div class="pokeball-center"></div></div><span>Vazio</span>';
    teamSlots.appendChild(empty);
  }
  teamCount.textContent = `${team.length}/${MAX_TEAM_SIZE}`;
}

// ===== Card Rendering =====
function createPokemonCard(pokemon) {
  const card = document.createElement('div');
  card.className = 'pokemon-card';
  card.dataset.id = pokemon.id;

  const primaryType = pokemon.types[0];
  const bgColor = getTypeColor(primaryType);

  const imageSrc = pokemon.officialArtwork || getPokemonSprite(pokemon.id);

  card.innerHTML = `
    <div class="card-bg" style="background: radial-gradient(circle at 50% 30%, ${bgColor}, transparent 70%);"></div>
    <div class="card-header">
      <span class="card-number">${formatId(pokemon.id)}</span>
      <div class="card-image-container">
        <img class="card-image" src="${imageSrc}" alt="${pokemon.name}" loading="lazy">
      </div>
    </div>
    <div class="card-info">
      <div class="card-name">${capitalize(pokemon.name)}</div>
      <div class="card-types">
        ${pokemon.types.map(t => `
          <span class="type-badge" style="background: ${getTypeColor(t)}">${t}</span>
        `).join('')}
      </div>
    </div>
  `;

  card.addEventListener('click', () => openModal(pokemon));
  return card;
}

// ===== Grid Rendering =====
function clearGrid() {
  pokemonGrid.innerHTML = '';
}

function renderPokemonGrid(pokemonList) {
  clearGrid();
  if (pokemonList.length === 0) {
    showError('Nenhum Pokémon encontrado.');
    hideLoading();
    return;
  }
  pokemonList.forEach(pokemon => {
    const card = createPokemonCard(pokemon);
    pokemonGrid.appendChild(card);
  });
}

function appendPokemonGrid(pokemonList) {
  pokemonList.forEach(pokemon => {
    const card = createPokemonCard(pokemon);
    pokemonGrid.appendChild(card);
  });
}

// ===== Modal =====
function openModal(pokemon) {
  const primaryType = pokemon.types[0];
  const bgColor = getTypeColor(primaryType);
  const imageSrc = pokemon.officialArtwork || getPokemonSprite(pokemon.id);

  const statsHTML = pokemon.stats.map(s => {
    const pct = Math.min((s.value / 255) * 100, 100);
    const key = s.name.replace('special-', '');
    return `
      <div class="stat-row">
        <span class="stat-label">${STAT_NAMES[s.name] || s.name}</span>
        <span class="stat-value">${s.value}</span>
        <div class="stat-bar-container">
          <div class="stat-bar stat-bar-${key}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');

  const abilitiesHTML = pokemon.abilities.map(a =>
    `<span class="ability-badge ${a.isHidden ? 'hidden-ability' : ''}">${capitalize(a.name.replace('-', ' '))}${a.isHidden ? ' (OCULTA)' : ''}</span>`
  ).join('');

  const heightM = (pokemon.height / 10).toFixed(1);
  const weightKg = (pokemon.weight / 10).toFixed(1);

  modalContent.innerHTML = `
    <div class="modal-hero">
      <div class="modal-hero-bg" style="background: radial-gradient(circle at 50% 40%, ${bgColor}, transparent 70%);"></div>
      <div class="modal-number">${formatId(pokemon.id)}</div>
      <img class="modal-image" src="${imageSrc}" alt="${pokemon.name}">
      <div class="modal-name">${capitalize(pokemon.name)}</div>
      <div class="modal-types">
        ${pokemon.types.map(t => `
          <span class="type-badge" style="background: ${getTypeColor(t)}">${t}</span>
        `).join('')}
      </div>
      <button id="add-team-btn" class="add-team-btn"></button>
    </div>
    <div class="modal-details">
      <div class="modal-section">
        <div class="modal-section-title">Estatísticas Base</div>
        ${statsHTML}
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Informações</div>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Altura</div>
            <div class="info-value">${heightM} m</div>
          </div>
          <div class="info-item">
            <div class="info-label">Peso</div>
            <div class="info-value">${weightKg} kg</div>
          </div>
          <div class="info-item">
            <div class="info-label">Experiência</div>
            <div class="info-value">${pokemon.baseExperience || '—'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Movimentos</div>
            <div class="info-value">${pokemon.moves}</div>
          </div>
        </div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Habilidades</div>
        <div class="abilities-list">${abilitiesHTML}</div>
      </div>
      ${pokemon.description ? `
        <div class="modal-section">
          <div class="modal-section-title">Descrição</div>
          <div class="modal-description">${pokemon.description}</div>
        </div>
      ` : ''}
    </div>
  `;

  const addTeamBtn = document.getElementById('add-team-btn');
  const teamFull = team.length >= MAX_TEAM_SIZE;
  addTeamBtn.textContent = teamFull ? 'Time completo (6/6)' : '+ Adicionar ao time';
  addTeamBtn.disabled = teamFull;
  addTeamBtn.addEventListener('click', async () => {
    addTeamBtn.disabled = true;
    addTeamBtn.textContent = 'Salvando...';
    const ok = await addToTeam(pokemon);
    addTeamBtn.textContent = ok ? '✓ No time!' : 'Erro — veja o status do time';
  });

  modalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

// ===== Search =====
async function searchPokemon(query) {
  query = query.trim().toLowerCase();
  if (!query) {
    currentGeneration = 'all';
    setActiveFilter('all');
    await loadInitial();
    return;
  }

  hideError();
  showLoading();
  pokemonGrid.innerHTML = '';
  hideLoadMore();
  currentList = [];

  try {
    let pokemon;
    if (/^\d+$/.test(query)) {
      pokemon = await fetchPokemonBasic(parseInt(query));
      currentList = [pokemon];
    } else {
      const res = await fetch(`${API_BASE}/pokemon/${query}`);
      if (!res.ok) throw new Error(`Pokémon "${query}" não encontrado`);
      const data = await res.json();
      pokemon = await fetchPokemonBasic(data.id);
      currentList = [pokemon];
    }
    renderPokemonGrid(currentList);
  } catch (err) {
    showError(err.message);
  } finally {
    hideLoading();
  }
}

// ===== Filtering =====
function setActiveFilter(gen) {
  filterBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.generation === gen);
  });
}

async function filterByGeneration(gen) {
  if (gen === currentGeneration) return;
  currentGeneration = gen;
  setActiveFilter(gen);

  hideError();
  searchInput.value = '';

  if (gen === 'all') {
    await loadInitial();
  } else {
    const [start, end] = GENERATIONS[gen];
    currentList = [];
    currentPage = 0;
    showLoading();
    clearGrid();
    hideLoadMore();

    try {
      currentList = await loadPokemonList(start, end);
      renderPokemonGrid(currentList);
    } catch (err) {
      showError(err.message);
    } finally {
      hideLoading();
    }
  }
}

// ===== Pagination / Load More =====
async function loadInitial() {
  showLoading();
  hideError();
  clearGrid();
  hideLoadMore();

  currentList = [];
  currentPage = 0;

  try {
    const start = 1;
    const end = Math.min(POKEMON_PER_PAGE, TOTAL_POKEMON);
    currentList = await loadPokemonList(start, end);
    renderPokemonGrid(currentList);
    if (currentList.length < TOTAL_POKEMON) {
      showLoadMore();
    }
  } catch (err) {
    showError(err.message);
  } finally {
    hideLoading();
  }
}

async function loadMore() {
  if (isLoading) return;
  isLoading = true;
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = 'Carregando...';

  try {
    const start = currentList.length + 1;
    const end = Math.min(currentList.length + POKEMON_PER_PAGE, TOTAL_POKEMON);

    if (start > TOTAL_POKEMON) {
      hideLoadMore();
      return;
    }

    const newPokemon = await loadPokemonList(start, end);
    currentList = currentList.concat(newPokemon);
    appendPokemonGrid(newPokemon);

    if (currentList.length >= TOTAL_POKEMON) {
      hideLoadMore();
    }
  } catch (err) {
    showError(err.message);
  } finally {
    isLoading = false;
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = 'Carregar mais Pokémon';
  }
}

// ===== Event Listeners =====
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    searchPokemon(searchInput.value);
  }
});

searchBtn.addEventListener('click', () => {
  searchPokemon(searchInput.value);
});

// Debounced live search
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchPokemon(searchInput.value);
  }, 500);
});

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterByGeneration(btn.dataset.generation);
  });
});

loadMoreBtn.addEventListener('click', loadMore);

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  loadTeam();
  loadInitial();
});