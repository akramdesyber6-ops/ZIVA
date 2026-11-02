const movieData = [
  {id:"horizon",title:"The Last Horizon",year:2026,genre:"Sci-Fi",rating:"8.9",type:"Movie",description:"A crew on a distant mission discovers a mysterious signal that challenges everything humanity believes about its place in the universe.",image:"https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=700&q=85"},
  {id:"protocol",title:"Shadow Protocol",year:2025,genre:"Action",rating:"8.2",type:"Movie",description:"An elite operative is pulled into a high-stakes conspiracy where every ally seems to have a secret.",image:"https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=700&q=85"},
  {id:"deep",title:"Beyond the Deep",year:2026,genre:"Drama",rating:"8.5",type:"Movie",description:"A moving story of courage, family and second chances set against the vastness of the ocean.",image:"https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=700&q=85"},
  {id:"neon",title:"Neon City",year:2025,genre:"Thriller",rating:"7.9",type:"Series",description:"In a city that never sleeps, one detective follows a trail of clues into a dangerous underworld.",image:"https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=700&q=85"},
  {id:"kingdom",title:"Kingdom of Ash",year:2026,genre:"Action",rating:"8.7",type:"Movie",description:"A forgotten heir must unite rival kingdoms before an ancient threat rises again.",image:"https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=700&q=85"},
  {id:"little",title:"Little Big World",year:2025,genre:"Animation",rating:"8.4",type:"Movie",description:"An unlikely friendship takes two tiny adventurers on the biggest journey of their lives.",image:"https://images.unsplash.com/photo-1478720568477-152d9b164e26?auto=format&fit=crop&w=700&q=85"},
  {id:"silent",title:"The Silent Hour",year:2024,genre:"Thriller",rating:"7.8",type:"Movie",description:"A witness and a detective race against time when a quiet night turns into a mystery.",image:"https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=700&q=85"},
  {id:"summer",title:"Summer Again",year:2025,genre:"Comedy",rating:"7.6",type:"Series",description:"One unexpected summer brings old friends together and changes the plans they thought they had.",image:"https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=700&q=85"},
  {id:"storm",title:"After the Storm",year:2026,genre:"Drama",rating:"8.1",type:"Movie",description:"A family rebuilds its life and discovers that hope can arrive from the most unexpected places.",image:"https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=700&q=85"},
  {id:"velocity",title:"Velocity",year:2025,genre:"Action",rating:"8.0",type:"Movie",description:"A street racer gets one final chance to settle a score and protect the people he loves.",image:"https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=700&q=85"},
  {id:"parallel",title:"Parallel",year:2024,genre:"Sci-Fi",rating:"8.3",type:"Series",description:"Two strangers in different realities discover that their lives are connected by one impossible choice.",image:"https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=700&q=85"},
  {id:"wild",title:"Wild Hearts",year:2025,genre:"Animation",rating:"8.6",type:"Movie",description:"A young explorer sets out to protect a magical forest and the creatures who call it home.",image:"https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=700&q=85"}
];

const $ = selector => document.querySelector(selector);
const watchlistKey = "justwatch-demo-watchlist";
let activeGenre = "All", searchTerm = "", currentMovie = null;
let watchlist = loadWatchlist();

function loadWatchlist() {
  try { const saved = JSON.parse(localStorage.getItem(watchlistKey) || "[]"); return Array.isArray(saved) ? saved.filter(id => movieData.some(movie => movie.id === id)) : []; }
  catch { return []; }
}
function saveWatchlist() {
  try { localStorage.setItem(watchlistKey, JSON.stringify(watchlist)); }
  catch { showToast("Browser storage is unavailable in this session."); }
  updateWatchlistCount();
}
function updateWatchlistCount() { $("#watchlist-count").textContent = watchlist.length; }
function makeCard(movie) {
  const saved = watchlist.includes(movie.id);
  return `<article class="movie-card" data-movie-id="${movie.id}" tabindex="0" aria-label="View ${movie.title} details"><div class="poster"><img src="${movie.image}" alt="" loading="lazy" onerror="this.style.opacity='.15'"><span class="rating">★ ${movie.rating}</span><div class="card-actions"><button class="save-button ${saved ? "saved" : ""}" data-save="${movie.id}" aria-label="${saved ? "Remove from" : "Add to"} watchlist" title="${saved ? "Remove from" : "Add to"} my list">${saved ? "✓" : "+"}</button></div><span class="poster-label">${movie.type}</span></div><h3>${movie.title}</h3><small>${movie.year} &nbsp;·&nbsp; ${movie.genre}</small></article>`;
}
function renderGrid(target, items, emptyMessage) {
  const grid = $(target);
  grid.innerHTML = items.length ? items.map(makeCard).join("") : `<p class="empty-state">${emptyMessage}</p>`;
}
function filteredMovies() {
  return movieData.filter(movie => (activeGenre === "All" || movie.genre === activeGenre) && `${movie.title} ${movie.genre} ${movie.year} ${movie.type}`.toLowerCase().includes(searchTerm));
}
function render() {
  renderGrid("#trending-grid", filteredMovies().slice(0, 6), "No titles match that search. Try another keyword or genre.");
  renderGrid("#popular-grid", movieData.slice(6), "More titles are coming soon.");
  renderGrid("#watchlist-grid", watchlist.map(id => movieData.find(movie => movie.id === id)).filter(Boolean), "Your list is empty. Add a title using the + button on any movie.");
  updateWatchlistCount();
}
function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("show");
  window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}
function openMovie(movie) {
  if (!movie) return;
  currentMovie = movie;
  $("#dialog-art").style.backgroundImage = `url("${movie.image}")`;
  $("#dialog-genre").textContent = `${movie.genre.toUpperCase()} · ${movie.type.toUpperCase()}`;
  $("#dialog-title").textContent = movie.title;
  $("#dialog-meta").textContent = `★ ${movie.rating} · ${movie.year}`;
  $("#dialog-description").textContent = movie.description;
  $("#dialog-save").textContent = watchlist.includes(movie.id) ? "✓ In my list" : "＋ Add to my list";
  $("#movie-dialog").showModal();
}
function toggleWatchlist(id) {
  const movie = movieData.find(item => item.id === id); if (!movie) return;
  if (watchlist.includes(id)) { watchlist = watchlist.filter(item => item !== id); showToast(`Removed ${movie.title} from your list.`); }
  else { watchlist.push(id); showToast(`Added ${movie.title} to your list.`); }
  saveWatchlist(); render();
  if (currentMovie?.id === id) $("#dialog-save").textContent = watchlist.includes(id) ? "✓ In my list" : "＋ Add to my list";
}

document.addEventListener("click", event => {
  const saveButton = event.target.closest("[data-save]");
  if (saveButton) { event.stopPropagation(); toggleWatchlist(saveButton.dataset.save); return; }
  const card = event.target.closest("[data-movie-id]");
  if (card) openMovie(movieData.find(movie => movie.id === card.dataset.movieId));
});
document.addEventListener("keydown", event => {
  const card = event.target.closest?.("[data-movie-id]");
  if (card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openMovie(movieData.find(movie => movie.id === card.dataset.movieId)); }
  if (event.key === "Escape") $("#search-strip").classList.remove("open");
});
$("#genres").addEventListener("click", event => {
  const chip = event.target.closest("[data-genre]"); if (!chip) return;
  activeGenre = chip.dataset.genre;
  document.querySelectorAll(".genre-chip").forEach(button => button.classList.toggle("selected", button === chip)); render();
});
$("#search-toggle").addEventListener("click", () => {
  $("#search-strip").classList.toggle("open"); if ($("#search-strip").classList.contains("open")) $("#search-input").focus();
});
$("#search-input").addEventListener("input", event => { searchTerm = event.target.value.trim().toLowerCase(); render(); });
$("#menu-toggle").addEventListener("click", () => $("#navigation").classList.toggle("open"));
$("#navigation").addEventListener("click", event => { if (event.target.closest("a")) $("#navigation").classList.remove("open"); });
$("#dialog-close").addEventListener("click", () => $("#movie-dialog").close());
$("#movie-dialog").addEventListener("click", event => { if (event.target === $("#movie-dialog")) $("#movie-dialog").close(); });
$("#dialog-save").addEventListener("click", () => { if (currentMovie) toggleWatchlist(currentMovie.id); });
$("#dialog-watch").addEventListener("click", () => showToast("Connect a licensed streaming provider to add real watch options."));
$("#featured-button").addEventListener("click", () => openMovie(movieData[0]));
$("#sign-in").addEventListener("click", () => showToast("Sign-in is a demo action. Add an authentication provider to enable accounts."));
render();
