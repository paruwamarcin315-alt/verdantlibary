const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const params = new URLSearchParams(location.search);

function escapeHtml(v){
  return String(v ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}
function safeText(v){ return String(v ?? '').trim(); }
function stars(rating){
  const rounded = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  let out = '';
  for(let i=1;i<=5;i++) out += i <= rounded ? '★' : '☆';
  return out;
}
function formatDate(v){
  try{
    return new Intl.DateTimeFormat('pl-PL',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v));
  }catch{ return v; }
}
function showToast(message, type='success'){
  const stack = $('#toastStack');
  if(!stack) return;
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  stack.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(10px)';
    setTimeout(() => item.remove(), 220);
  }, 2500);
}
async function api(url, options={}){
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if(!response.ok) throw new Error(data.error || 'Błąd żądania.');
  return data;
}
async function apiForm(url, formData){
  const response = await fetch(url, { method: 'POST', body: formData });
  const data = await response.json().catch(() => ({}));
  if(!response.ok) throw new Error(data.error || 'Błąd żądania.');
  return data;
}
async function loadMe(){
  try{
    const data = await api('/api/me', { method: 'GET' });
    return data.user;
  }catch{
    return null;
  }
}
async function renderNavUser(){
  const userBox = $('#navUserBox');
  if(!userBox) return;
  const user = await loadMe();
  if(user){
    userBox.innerHTML = `
      <a class="nav-link" href="profile.html?id=${encodeURIComponent(user.id)}">${escapeHtml(user.username)}</a>
      <button class="nav-link" id="logoutBtn" type="button">Wyloguj</button>
    `;
    $('#logoutBtn')?.addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' });
      location.href = 'index.html';
    });
  }else{
    userBox.innerHTML = `
      <a class="nav-link" href="login.html">Logowanie</a>
      <a class="nav-link" href="register.html">Rejestracja</a>
    `;
  }
}

async function pageHome(){
  const homeStats = $('#homeStats');
  const featuredWrap = $('#featuredWrap');
  if(!homeStats && !featuredWrap) return;

  const list = await api('/api/novels', { method: 'GET' });
  const novels = list.novels || [];
  const reviews = novels.reduce((s, n) => s + (n.reviews_count || 0), 0);
  const comments = novels.reduce((s, n) => s + (n.comments_count || 0), 0);
  const chapters = novels.reduce((s, n) => s + (n.chapters_count || 0), 0);

  if(homeStats){
    homeStats.innerHTML = `
      <article class="hub-card card">
        <div><div class="icon">📚</div><h3>${novels.length}</h3><p>Łączna liczba zapisanych light novelek.</p></div>
        <a class="btn" href="library.html">Przejdź do listy</a>
      </article>
      <article class="hub-card card">
        <div><div class="icon">⭐</div><h3>${reviews}</h3><p>Wszystkie recenzje użytkowników.</p></div>
        <a class="btn" href="dashboard.html">Zobacz ranking</a>
      </article>
      <article class="hub-card card">
        <div><div class="icon">💬</div><h3>${comments}</h3><p>Komentarze dodane przez czytelników.</p></div>
        <a class="btn" href="library.html">Otwórz bibliotekę</a>
      </article>
      <article class="hub-card card">
        <div><div class="icon">🧩</div><h3>${chapters}</h3><p>Rozdziały dodane do wszystkich tytułów.</p></div>
        <a class="btn" href="creator.html">Dodaj nowy tytuł</a>
      </article>
    `;
  }

  if(featuredWrap){
    const featured = novels.filter(n => Number(n.featured) === 1).slice(0, 3);
    featuredWrap.innerHTML = featured.length ? featured.map(item => `
      <article class="hub-card card">
        <div><div class="icon">🌴</div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(safeText(item.description).slice(0, 120))}${safeText(item.description).length > 120 ? '...' : ''}</p></div>
        <a class="btn" href="novel.html?id=${encodeURIComponent(item.id)}">Otwórz tytuł</a>
      </article>
    `).join('') : `
      <article class="hub-card card">
        <div><div class="icon">🌴</div><h3>Wyróżnione tytuły</h3><p>Nie ma jeszcze wyróżnionych novel. Możesz ustawić to w creatorze.</p></div>
        <a class="btn" href="creator.html">Dodaj light novelkę</a>
      </article>
    `;
  }
}

async function pageLibrary(){
  const grid = $('#novelsGrid');
  if(!grid) return;

  const searchInput = $('#searchInput');
  const genreFilter = $('#genreFilter');
  const sortFilter = $('#sortFilter');
  const statusFilter = $('#statusFilter');
  const showAllBtn = $('#showAllBtn');
  const showFeaturedBtn = $('#showFeaturedBtn');
  const countText = $('#libraryCountText');
  const empty = $('#libraryEmpty');
  let featuredOnly = false;
  let allNovels = [];

  function buildGenres(){
    const current = genreFilter.value || 'all';
    const genres = [...new Set(allNovels.map(item => safeText(item.genre)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pl'));
    genreFilter.innerHTML = '<option value="all">Wszystkie</option>' + genres.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    if([...genreFilter.options].some(option => option.value === current)) genreFilter.value = current;
  }

  function render(){
    buildGenres();
    const search = safeText(searchInput.value).toLowerCase();
    const genre = genreFilter.value;
    const sort = sortFilter.value;
    const status = statusFilter.value;

    let items = [...allNovels];
    if(featuredOnly) items = items.filter(item => Number(item.featured) === 1);
    if(search){
      items = items.filter(item => {
        const source = [item.title,item.author,item.genre,item.description,item.link,item.tags || ''].join(' ').toLowerCase();
        return source.includes(search);
      });
    }
    if(genre !== 'all') items = items.filter(item => item.genre === genre);
    if(status !== 'all') items = items.filter(item => item.status === status);

    items.sort((a,b) => {
      switch(sort){
        case 'oldest': return new Date(a.created_at) - new Date(b.created_at);
        case 'title-asc': return a.title.localeCompare(b.title, 'pl');
        case 'title-desc': return b.title.localeCompare(a.title, 'pl');
        case 'rating-desc': return Number(b.avg_rating || 0) - Number(a.avg_rating || 0);
        case 'reviews-desc': return Number(b.reviews_count || 0) - Number(a.reviews_count || 0);
        case 'chapters-desc': return Number(b.chapters_count || 0) - Number(a.chapters_count || 0);
        default: return new Date(b.updated_at) - new Date(a.updated_at);
      }
    });

    countText.textContent = `Wyświetlane tytuły: ${items.length}`;
    empty.style.display = items.length ? 'none' : 'block';
    showAllBtn.classList.toggle('active', !featuredOnly);
    showFeaturedBtn.classList.toggle('active', featuredOnly);

    grid.innerHTML = items.map(item => `
      <article class="novel-card">
        <div class="cover"><strong>${item.cover_url ? '' : '📖'} ${escapeHtml(item.genre || 'Light Novel')}</strong></div>
        <h4>${escapeHtml(item.title)}</h4>
        <div class="badges">
          <span class="badge">Autor: ${escapeHtml(item.author)}</span>
          <span class="badge">${escapeHtml(item.status)}</span>
          ${Number(item.featured) === 1 ? '<span class="badge">Wyróżniona</span>' : ''}
        </div>
        <div class="badges">
          <span class="badge">Ocena: ${Number(item.avg_rating || 0) ? Number(item.avg_rating).toFixed(2) : 'Brak'}</span>
          <span class="badge">Recenzje: ${item.reviews_count || 0}</span>
          <span class="badge">Rozdziały: ${item.chapters_count || 0}</span>
        </div>
        <div class="meta">${escapeHtml(safeText(item.description).slice(0, 150))}${safeText(item.description).length > 150 ? '...' : ''}</div>
        <div class="badges">${String(item.tags || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 4).map(tag => `<span class="badge">#${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="actions">
          <a class="btn" href="novel.html?id=${encodeURIComponent(item.id)}">Otwórz</a>
          <a class="tiny-btn" href="creator.html?edit=${encodeURIComponent(item.id)}">Edytuj</a>
        </div>
      </article>
    `).join('');
  }

  const res = await api('/api/novels', { method: 'GET' });
  allNovels = res.novels || [];
  searchInput?.addEventListener('input', render);
  genreFilter?.addEventListener('change', render);
  sortFilter?.addEventListener('change', render);
  statusFilter?.addEventListener('change', render);
  $('#clearFiltersBtn')?.addEventListener('click', function(){
    searchInput.value = '';
    genreFilter.value = 'all';
    sortFilter.value = 'newest';
    statusFilter.value = 'all';
    featuredOnly = false;
    render();
    showToast('Wyczyszczono filtry.');
  });
  showAllBtn?.addEventListener('click', () => { featuredOnly = false; render(); });
  showFeaturedBtn?.addEventListener('click', () => { featuredOnly = true; render(); });
  render();
}

function makeChapterEditorRow(data = {}){
  const div = document.createElement('div');
  div.className = 'chapter-card';
  div.innerHTML = `
    <div class="topbar">
      <h4>Rozdział</h4>
      <button type="button" class="tiny-btn remove-chapter">Usuń</button>
    </div>
    <div class="form-grid">
      <div>
        <label class="label">Numer</label>
        <input type="number" class="chapter-number" value="${escapeHtml(data.chapter_number || '')}" placeholder="Np. 1">
      </div>
      <div>
        <label class="label">Tytuł rozdziału</label>
        <input type="text" class="chapter-title" value="${escapeHtml(data.title || '')}" placeholder="Np. Początek końca">
      </div>
      <div class="full">
        <label class="label">Treść rozdziału</label>
        <textarea class="chapter-content" placeholder="Treść albo opis rozdziału...">${escapeHtml(data.content || '')}</textarea>
      </div>
    </div>
  `;
  div.querySelector('.remove-chapter')?.addEventListener('click', () => div.remove());
  return div;
}

function collectChapterRows(){
  return $$('#chaptersEditor .chapter-card').map(card => ({
    chapter_number: Number(card.querySelector('.chapter-number')?.value || 0),
    title: safeText(card.querySelector('.chapter-title')?.value),
    content: safeText(card.querySelector('.chapter-content')?.value)
  })).filter(ch => ch.chapter_number || ch.title || ch.content);
}

async function pageCreator(){
  const form = $('#novelForm');
  if(!form) return;

  const me = await loadMe();
  if(!me){
    location.href = 'login.html';
    return;
  }

  const id = params.get('edit');
  let editingNovel = null;

  if(id){
    const data = await api(`/api/novels/${id}`, { method: 'GET' });
    editingNovel = data.novel;
    $('#pageHeading').textContent = 'Edytuj light novelkę';
    $('#saveNovelBtn').textContent = 'Zapisz zmiany';
    $('#editingId').value = editingNovel.id;
    $('#title').value = editingNovel.title;
    $('#author').value = editingNovel.author;
    $('#genre').value = editingNovel.genre;
    $('#status').value = editingNovel.status;
    $('#tags').value = editingNovel.tags || '';
    $('#link').value = editingNovel.link || '';
    $('#cover_url').value = editingNovel.cover_url || '';
    $('#featured').checked = Number(editingNovel.featured) === 1;
    $('#description').value = editingNovel.description || '';
    const editor = $('#chaptersEditor');
    editor.innerHTML = '';
    (editingNovel.chapters || []).forEach(ch => editor.appendChild(makeChapterEditorRow(ch)));
    if (!(editingNovel.chapters || []).length) editor.appendChild(makeChapterEditorRow());
  } else {
    $('#chaptersEditor').appendChild(makeChapterEditorRow());
  }

  $('#addChapterBtn')?.addEventListener('click', () => {
    $('#chaptersEditor').appendChild(makeChapterEditorRow());
  });

  $('#coverUpload')?.addEventListener('change', async function(){
    const file = this.files?.[0];
    if(!file) return;
    const formData = new FormData();
    formData.append('cover', file);
    try{
      const res = await apiForm('/api/upload-cover', formData);
      $('#cover_url').value = res.url;
      $('#coverPreview').innerHTML = `<img src="${escapeHtml(res.url)}" style="max-width:180px;border-radius:18px;border:1px solid #efd1bc">`;
      showToast('Przesłano okładkę.');
    }catch(error){
      showToast(error.message, 'error');
    }
  });

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    const payload = {
      title: $('#title').value,
      author: $('#author').value,
      genre: $('#genre').value,
      status: $('#status').value,
      tags: $('#tags').value,
      link: $('#link').value,
      cover_url: $('#cover_url').value,
      featured: $('#featured').checked,
      description: $('#description').value,
      chapters: collectChapterRows()
    };

    try{
      if(id){
        await api(`/api/novels/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Zapisano zmiany.');
      }else{
        await api('/api/novels', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Dodano nową light novelkę.');
      }
      setTimeout(() => location.href = 'library.html', 300);
    }catch(error){
      showToast(error.message, 'error');
    }
  });

  $('#resetNovelBtn')?.addEventListener('click', function(){
    form.reset();
    $('#chaptersEditor').innerHTML = '';
    $('#chaptersEditor').appendChild(makeChapterEditorRow());
    $('#coverPreview').innerHTML = '';
  });
}

async function pageNovel(){
  const container = $('#detailContainer');
  if(!container) return;

  const id = params.get('id');
  if(!id) return;
  const me = await loadMe();
  const data = await api(`/api/novels/${id}`, { method: 'GET' });
  const item = data.novel;

  function renderNovel(item){
    const reviewsHtml = (item.reviews || []).length ? item.reviews.map(review => `
      <div class="review-card">
        <div class="row-top">
          <div class="username">${escapeHtml(review.username)}</div>
          <div class="date">${escapeHtml(formatDate(review.created_at))}</div>
        </div>
        <div class="review-title">${escapeHtml(review.title)}</div>
        <div class="rating-line"><span class="stars">${stars(review.rating)}</span><span>${Number(review.rating).toFixed(1)}/5</span></div>
        <div class="review-text">${escapeHtml(review.text)}</div>
      </div>
    `).join('') : '<div class="empty-card"><p>Na razie brak recenzji.</p></div>';

    const commentsHtml = (item.comments || []).length ? item.comments.map(comment => `
      <div class="comment-card">
        <div class="row-top">
          <div class="username">${escapeHtml(comment.username)}</div>
          <div class="date">${escapeHtml(formatDate(comment.created_at))}</div>
        </div>
        <div class="comment-text">${escapeHtml(comment.text)}</div>
      </div>
    `).join('') : '<div class="empty-card"><p>Na razie brak komentarzy.</p></div>';

    const chaptersHtml = (item.chapters || []).length ? item.chapters.map(ch => `
      <div class="chapter-card">
        <div class="row-top">
          <div class="username">Rozdział ${escapeHtml(ch.chapter_number)}</div>
          <div class="date">${escapeHtml(ch.title)}</div>
        </div>
        <div class="chapter-text">${escapeHtml(ch.content || '')}</div>
      </div>
    `).join('') : '<div class="empty-card"><p>Nie dodano jeszcze rozdziałów.</p></div>';

    container.innerHTML = `
      <div class="detail-panel">
        <div class="detail-header">
          <div class="detail-cover">
            <div class="badges">
              <span class="badge">${escapeHtml(item.genre)}</span>
              <span class="badge">${escapeHtml(item.status)}</span>
              ${Number(item.featured) === 1 ? '<span class="badge">Wyróżniona</span>' : ''}
            </div>
            <h2>${escapeHtml(item.title)}</h2>
          </div>
          <div>
            <div class="badges" style="margin-bottom:12px">
              <span class="badge">Autor: ${escapeHtml(item.author)}</span>
              <span class="badge">Właściciel: ${escapeHtml(item.username)}</span>
              <span class="badge">Rozdziały: ${(item.chapters || []).length}</span>
            </div>
            <div class="rating-line" style="margin-bottom:14px">
              <span class="stars">${stars(item.avg_rating)}</span>
              <strong>${Number(item.avg_rating || 0) ? Number(item.avg_rating).toFixed(2) : 'Brak ocen'}</strong>
              <span>(${(item.reviews || []).length} recenzji)</span>
              <span>•</span>
              <span>${(item.comments || []).length} komentarzy</span>
            </div>
            <div class="detail-text">${escapeHtml(item.description || 'Brak opisu.')}</div>
            <div class="badges" style="margin-top:12px;margin-bottom:12px">
              ${String(item.tags || '').split(',').map(t => t.trim()).filter(Boolean).map(tag => `<span class="badge">#${escapeHtml(tag)}</span>`).join('') || '<span class="badge">Brak tagów</span>'}
            </div>
            <div class="link-box">${item.link ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">Przejdź do linku light novelki / mangi</a>` : 'Brak dodanego linku.'}</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
              <a class="btn-soft" href="library.html">Wróć do listy</a>
              ${me ? `<a class="btn" href="creator.html?edit=${encodeURIComponent(item.id)}">Edytuj wpis</a>` : ''}
              ${me ? `<button class="btn-danger" id="deleteNovelBtn" type="button">Usuń wpis</button>` : ''}
              <a class="tiny-btn" href="profile.html?id=${encodeURIComponent(item.owner_id)}">Profil autora</a>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-panel">
        <div class="topbar">
          <h3>Rozdziały</h3>
          <div class="helper">System rozdziałów w stylu portalowym.</div>
        </div>
        <div class="chapters-grid">${chaptersHtml}</div>
      </div>

      <div class="dual">
        <div class="form-panel">
          <h3>Dodaj recenzję</h3>
          ${me ? `
          <form id="reviewForm">
            <div class="field"><label class="label" for="reviewTitle">Tytuł recenzji</label><input id="reviewTitle" type="text" required></div>
            <div class="field"><label class="label" for="reviewRating">Ocena</label>
              <select id="reviewRating"><option value="5">5 / 5</option><option value="4">4 / 5</option><option value="3">3 / 5</option><option value="2">2 / 5</option><option value="1">1 / 5</option></select>
            </div>
            <div class="field"><label class="label" for="reviewText">Treść recenzji</label><textarea id="reviewText" required></textarea></div>
            <button class="btn" type="submit">Zapisz recenzję</button>
          </form>
          ` : `<div class="empty-card"><p>Musisz się zalogować, żeby dodać recenzję.</p><a class="btn" href="login.html">Zaloguj się</a></div>`}
        </div>

        <div class="form-panel">
          <h3>Dodaj komentarz</h3>
          ${me ? `
          <form id="commentForm">
            <div class="field"><label class="label" for="commentText">Komentarz</label><textarea id="commentText" required></textarea></div>
            <button class="btn" type="submit">Zapisz komentarz</button>
          </form>
          ` : `<div class="empty-card"><p>Musisz się zalogować, żeby dodać komentarz.</p><a class="btn" href="login.html">Zaloguj się</a></div>`}
        </div>
      </div>

      <div class="columns">
        <div class="column"><h3>Recenzje</h3>${reviewsHtml}</div>
        <div class="column"><h3>Komentarze</h3>${commentsHtml}</div>
      </div>
    `;

    $('#reviewForm')?.addEventListener('submit', async function(e){
      e.preventDefault();
      try{
        await api(`/api/novels/${item.id}/reviews`, {
          method: 'POST',
          body: JSON.stringify({
            title: $('#reviewTitle').value,
            rating: $('#reviewRating').value,
            text: $('#reviewText').value
          })
        });
        showToast('Dodano recenzję.');
        location.reload();
      }catch(error){
        showToast(error.message, 'error');
      }
    });

    $('#commentForm')?.addEventListener('submit', async function(e){
      e.preventDefault();
      try{
        await api(`/api/novels/${item.id}/comments`, {
          method: 'POST',
          body: JSON.stringify({ text: $('#commentText').value })
        });
        showToast('Dodano komentarz.');
        location.reload();
      }catch(error){
        showToast(error.message, 'error');
      }
    });

    $('#deleteNovelBtn')?.addEventListener('click', function(){
      $('#confirmModal')?.classList.add('open');
    });
  }

  renderNovel(item);

  $('#confirmCancelBtn')?.addEventListener('click', function(){
    $('#confirmModal')?.classList.remove('open');
  });
  $('#confirmAcceptBtn')?.addEventListener('click', async function(){
    try{
      await api(`/api/novels/${id}`, { method: 'DELETE' });
      location.href = 'library.html';
    }catch(error){
      showToast(error.message, 'error');
    }
  });
  $('#confirmModal')?.addEventListener('click', function(e){
    if(e.target === this) this.classList.remove('open');
  });
}

async function pageDashboard(){
  const dashboardWrap = $('#dashboardWrap');
  if(!dashboardWrap) return;

  const [weekly, monthly, allTime] = await Promise.all([
    api('/api/rankings?period=weekly', { method: 'GET' }),
    api('/api/rankings?period=monthly', { method: 'GET' }),
    api('/api/rankings?period=all', { method: 'GET' })
  ]);

  function renderRanking(items){
    return items.slice(0, 5).map(item => `
      <div class="rank-item">
        <div>
          <div class="rank-title">${escapeHtml(item.title)}</div>
          <div class="rank-meta">Score: ${item.score} • Ocena: ${item.avg_rating || 0} • Recenzje: ${item.reviews_count}</div>
        </div>
        <a class="tiny-btn" href="novel.html?id=${encodeURIComponent(item.id)}">Otwórz</a>
      </div>
    `).join('') || '<div class="empty-card">Brak danych.</div>';
  }

  dashboardWrap.innerHTML = `
    <section class="dashboard-grid">
      <div class="dashboard-panel panel"><h3>Ranking tygodniowy</h3><div class="rank-list">${renderRanking(weekly.items || [])}</div></div>
      <div class="dashboard-panel panel"><h3>Ranking miesięczny</h3><div class="rank-list">${renderRanking(monthly.items || [])}</div></div>
      <div class="dashboard-panel panel"><h3>Ranking all time</h3><div class="rank-list">${renderRanking(allTime.items || [])}</div></div>
    </section>
  `;
}

async function pageAdmin(){
  const adminWrap = $('#adminWrap');
  if(!adminWrap) return;

  try{
    const data = await api('/api/admin/stats', { method: 'GET' });
    adminWrap.innerHTML = `
      <section class="dashboard-grid">
        <div class="dashboard-panel panel"><h3>Użytkownicy</h3><div class="big-number">${data.totals.users}</div><div class="helper">Wszystkie konta.</div></div>
        <div class="dashboard-panel panel"><h3>Novelki</h3><div class="big-number">${data.totals.novels}</div><div class="helper">Wszystkie wpisy.</div></div>
        <div class="dashboard-panel panel"><h3>Rozdziały</h3><div class="big-number">${data.totals.chapters}</div><div class="helper">Łączna liczba rozdziałów.</div></div>
      </section>
      <section class="dashboard-grid" style="margin-top:18px">
        <div class="dashboard-panel panel">
          <h3>Ostatni użytkownicy</h3>
          <div class="rank-list">
            ${data.latestUsers.map(user => `
              <div class="rank-item">
                <div><div class="rank-title">${escapeHtml(user.username)}</div><div class="rank-meta">${escapeHtml(user.email)} • ${escapeHtml(user.role)}</div></div>
                <a class="tiny-btn" href="profile.html?id=${encodeURIComponent(user.id)}">Profil</a>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="dashboard-panel panel">
          <h3>Ostatnie tytuły</h3>
          <div class="rank-list">
            ${data.latestNovels.map(novel => `
              <div class="rank-item">
                <div><div class="rank-title">${escapeHtml(novel.title)}</div><div class="rank-meta">${escapeHtml(novel.status)} • Featured: ${Number(novel.featured) === 1 ? 'tak' : 'nie'}</div></div>
                <a class="tiny-btn" href="novel.html?id=${encodeURIComponent(novel.id)}">Otwórz</a>
              </div>
            `).join('')}
          </div>
        </div>
      </section>
    `;
  }catch(error){
    adminWrap.innerHTML = `<div class="empty-card"><h3>Brak dostępu</h3><p>${escapeHtml(error.message)}</p><p>Zaloguj się jako admin.</p></div>`;
  }
}

async function pageLogin(){
  const form = $('#loginForm');
  if(!form) return;
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    try{
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({
          email: $('#email').value,
          password: $('#password').value
        })
      });
      location.href = 'index.html';
    }catch(error){
      showToast(error.message, 'error');
    }
  });
}

async function pageRegister(){
  const form = $('#registerForm');
  if(!form) return;
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    try{
      await api('/api/register', {
        method: 'POST',
        body: JSON.stringify({
          username: $('#username').value,
          email: $('#email').value,
          password: $('#password').value
        })
      });
      location.href = 'index.html';
    }catch(error){
      showToast(error.message, 'error');
    }
  });
}

async function pageProfile(){
  const profileWrap = $('#profileWrap');
  if(!profileWrap) return;
  const id = params.get('id');
  const me = await loadMe();

  if(!id && !me){
    location.href = 'login.html';
    return;
  }

  const userId = id || me.id;
  try{
    const data = await api(`/api/users/${userId}`, { method: 'GET' });
    const user = data.user;
    profileWrap.innerHTML = `
      <div class="profile-grid">
        <section class="profile-panel panel">
          <div class="profile-header">
            ${user.avatar_url ? `<img class="avatar" src="${escapeHtml(user.avatar_url)}">` : `<div class="avatar"></div>`}
            <div>
              <h3>${escapeHtml(user.username)}</h3>
              <div class="helper">${escapeHtml(user.email)}</div>
              <div class="helper">Rola: ${escapeHtml(user.role)}</div>
            </div>
          </div>
          <div class="detail-text" style="margin-top:16px">${escapeHtml(user.bio || 'Brak bio.')}</div>
          ${me && String(me.id) === String(user.id) ? `
            <form id="profileForm" style="margin-top:16px">
              <div class="field"><label class="label" for="bio">Bio</label><textarea id="bio">${escapeHtml(user.bio || '')}</textarea></div>
              <div class="field"><label class="label" for="avatar_url">Link do avatara</label><input id="avatar_url" value="${escapeHtml(user.avatar_url || '')}"></div>
              <button class="btn" type="submit">Zapisz profil</button>
            </form>
          ` : ''}
        </section>
        <section class="profile-panel panel">
          <h3>Tytuły użytkownika</h3>
          <div class="rank-list">
            ${data.novels.length ? data.novels.map(novel => `
              <div class="rank-item">
                <div><div class="rank-title">${escapeHtml(novel.title)}</div><div class="rank-meta">${escapeHtml(novel.genre)} • ${escapeHtml(novel.status)}</div></div>
                <a class="tiny-btn" href="novel.html?id=${encodeURIComponent(novel.id)}">Otwórz</a>
              </div>
            `).join('') : '<div class="empty-card">Brak dodanych tytułów.</div>'}
          </div>
        </section>
      </div>
    `;

    $('#profileForm')?.addEventListener('submit', async function(e){
      e.preventDefault();
      try{
        await api('/api/profile', {
          method: 'PUT',
          body: JSON.stringify({
            bio: $('#bio').value,
            avatar_url: $('#avatar_url').value
          })
        });
        showToast('Zapisano profil.');
        setTimeout(() => location.reload(), 300);
      }catch(error){
        showToast(error.message, 'error');
      }
    });
  }catch(error){
    profileWrap.innerHTML = `<div class="empty-card"><h3>Błąd</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

document.addEventListener('DOMContentLoaded', async function(){
  await renderNavUser();
  await pageHome();
  await pageLibrary();
  await pageCreator();
  await pageNovel();
  await pageDashboard();
  await pageAdmin();
  await pageLogin();
  await pageRegister();
  await pageProfile();
});
