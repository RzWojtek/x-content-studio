import { db } from '../firebase.js'
import {
  collection, addDoc, getDocs, doc, deleteDoc,
  query, orderBy, serverTimestamp
} from 'firebase/firestore'
import { showToast } from '../utils/toast.js'
import { callAI } from '../ai.js'

// ── Oblicz engagement rate ───────────────────────────────────
function calcER(views, likes, rts, replies) {
  if (!views || views === 0) return 0
  return (((likes + rts + replies) / views) * 100)
}

// ── Formatuj datę ────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('pl-PL')
}

// ── Render tabeli wyników ────────────────────────────────────
function renderTable(entries) {
  const tbody = document.getElementById('analyticsTableBody')
  if (!tbody) return

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:2rem">Brak wpisów. Zaloguj pierwsze wyniki.</td></tr>`
    return
  }

  tbody.innerHTML = entries.map(e => {
    const er = calcER(e.views, e.likes, e.retweets, e.replies)
    const erColor = er >= 5 ? 'var(--success)' : er >= 2 ? 'var(--accent)' : 'var(--text-muted)'
    return `<tr>
      <td style="font-size:12px">${fmtDate(e.publishedAt)}</td>
      <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.topic || '—'}</td>
      <td><span class="badge badge-${e.format === 'thread' ? 'scheduled' : 'draft'}">${e.format === 'thread' ? '🧵' : '📝'}</span></td>
      <td>${(e.views || 0).toLocaleString('pl-PL')}</td>
      <td>${e.likes || 0}</td>
      <td>${e.retweets || 0}</td>
      <td>${e.replies || 0}</td>
      <td style="color:${erColor};font-weight:700">${er.toFixed(2)}%</td>
      <td><button class="btn btn-danger" style="font-size:11px;padding:.2rem .5rem" data-del="${e.id}">✕</button></td>
    </tr>`
  }).join('')

  tbody.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Usunąć ten wpis?')) return
      await deleteDoc(doc(db, 'analytics', btn.dataset.del))
      showToast('Usunięto wpis', '')
      loadAnalytics()
    })
  })
}

// ── Render statystyk agregowanych ───────────────────────────
function renderStats(entries) {
  if (!entries.length) return

  const totalViews = entries.reduce((s, e) => s + (e.views || 0), 0)
  const totalLikes = entries.reduce((s, e) => s + (e.likes || 0), 0)
  const totalRts = entries.reduce((s, e) => s + (e.retweets || 0), 0)
  const avgER = entries.reduce((s, e) => s + calcER(e.views, e.likes, e.retweets, e.replies), 0) / entries.length

  // Najlepszy temat
  const topEntry = [...entries].sort((a, b) => calcER(b.views, b.likes, b.retweets, b.replies) - calcER(a.views, a.likes, a.retweets, a.replies))[0]

  // Najlepsza godzina
  const byHour = {}
  entries.forEach(e => {
    if (e.publishedAt) {
      const h = (e.publishedAt.toDate ? e.publishedAt.toDate() : new Date(e.publishedAt)).getHours()
      if (!byHour[h]) byHour[h] = []
      byHour[h].push(calcER(e.views, e.likes, e.retweets, e.replies))
    }
  })
  const bestHour = Object.entries(byHour)
    .map(([h, ers]) => ({ h, avg: ers.reduce((a, b) => a + b) / ers.length }))
    .sort((a, b) => b.avg - a.avg)[0]

  document.getElementById('statViews').textContent = totalViews.toLocaleString('pl-PL')
  document.getElementById('statLikes').textContent = totalLikes.toLocaleString('pl-PL')
  document.getElementById('statRts').textContent = totalRts.toLocaleString('pl-PL')
  document.getElementById('statER').textContent = avgER.toFixed(2) + '%'
  document.getElementById('statPosts').textContent = entries.length
  document.getElementById('statBestHour').textContent = bestHour ? `${bestHour.h}:00` : '—'
  document.getElementById('statTopTopic').textContent = topEntry?.topic?.slice(0, 30) || '—'
}

// ── Analiza AI ───────────────────────────────────────────────
async function generateAIAnalysis(entries) {
  const btn = document.getElementById('btnAnalyze')
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Analizuję...' }

  const box = document.getElementById('aiAnalysisBox')
  if (box) {
    box.style.display = 'block'
    box.innerHTML = `<div class="ai-response-header">✦ Analiza AI</div>
    <div style="display:flex;gap:.5rem;align-items:center;color:var(--text-muted);font-size:13px">
      <span class="spinner"></span> Generuję rekomendacje na następny tydzień...
    </div>`
  }

  const dataStr = entries.slice(0, 30).map(e => ({
    temat: e.topic,
    format: e.format,
    godzina: e.publishedAt ? (e.publishedAt.toDate ? e.publishedAt.toDate() : new Date(e.publishedAt)).getHours() + ':00' : '?',
    wyswietlenia: e.views,
    lajki: e.likes,
    rt: e.retweets,
    replies: e.replies,
    er: calcER(e.views, e.likes, e.retweets, e.replies).toFixed(2) + '%'
  }))

  try {
    const result = await callAI(
      `Przeanalizuj poniższe dane o postach na X (Twitter) polskiego twórcy treści krypto.
Dane:
${JSON.stringify(dataStr, null, 2)}

Napisz po polsku:
1. Które tematy/formaty generują najlepszy engagement?
2. Jakie godziny publikacji działają najlepiej?
3. Co należy poprawić lub zmienić?
4. Konkretny plan na następny tydzień (3-5 postów z tematami i godzinami)

Bądź konkretny i praktyczny. Max 400 słów.`,
      'Jesteś ekspertem od analityki mediów społecznościowych i krypto content marketingu. Odpowiadaj po polsku.'
    )

    if (box) {
      box.innerHTML = `
        <div class="ai-response-header">✦ Rekomendacje AI na następny tydzień</div>
        <div style="font-size:14px;line-height:1.7;white-space:pre-wrap">${result.trim()}</div>
      `
    }
  } catch (err) {
    if (box) {
      box.innerHTML = `<div class="ai-response-header" style="color:var(--danger)">⚠ Błąd analizy</div>
      <div style="font-size:13px;color:var(--text-muted)">${err.message}</div>`
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '✦ Analiza AI' }
  }
}

// ── Zapis wpisu ──────────────────────────────────────────────
async function saveEntry() {
  const topic = document.getElementById('aTopic')?.value?.trim()
  const format = document.getElementById('aFormat')?.value
  const views = parseInt(document.getElementById('aViews')?.value) || 0
  const likes = parseInt(document.getElementById('aLikes')?.value) || 0
  const rts = parseInt(document.getElementById('aRts')?.value) || 0
  const replies = parseInt(document.getElementById('aReplies')?.value) || 0
  const dateVal = document.getElementById('aDate')?.value
  const notes = document.getElementById('aNotes')?.value?.trim()

  if (!topic) return showToast('Wpisz temat posta', 'error')
  if (!dateVal) return showToast('Wybierz datę publikacji', 'error')

  const btn = document.getElementById('btnSaveEntry')
  if (btn) { btn.disabled = true; btn.textContent = 'Zapisuję...' }

  try {
    await addDoc(collection(db, 'analytics'), {
      topic,
      format,
      views,
      likes,
      retweets: rts,
      replies,
      publishedAt: new Date(dateVal),
      engagementRate: calcER(views, likes, rts, replies),
      notes: notes || '',
      createdAt: serverTimestamp()
    })
    showToast('Wyniki zapisane!', 'success')
    // Wyczyść formularz
    ;['aTopic', 'aViews', 'aLikes', 'aRts', 'aReplies', 'aNotes'].forEach(id => {
      const el = document.getElementById(id)
      if (el) el.value = ''
    })
    loadAnalytics()
  } catch (err) {
    console.error(err)
    showToast('Błąd zapisu', 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '+ Zapisz wyniki' }
  }
}

// ── Ładuj dane ───────────────────────────────────────────────
let allEntries = []

async function loadAnalytics() {
  const tbody = document.getElementById('analyticsTableBody')
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem"><span class="spinner"></span></td></tr>`

  try {
    const q = query(collection(db, 'analytics'), orderBy('publishedAt', 'desc'))
    const snap = await getDocs(q)
    allEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    renderStats(allEntries)
    renderTable(allEntries)
  } catch (err) {
    console.error(err)
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--danger)">Błąd ładowania danych</td></tr>`
  }
}

// ── Render zakładki ──────────────────────────────────────────
export function renderAnalytics() {
  const now = new Date()
  const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

  const panel = document.getElementById('tab-analytics')
  panel.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Analytics</div>
        <div class="section-sub">Ręczne logowanie i analiza wyników postów</div>
      </div>
      <button class="btn btn-primary" id="btnAnalyze">✦ Analiza AI</button>
    </div>

    <!-- Statystyki zbiorcze -->
    <div class="stat-grid" style="margin-bottom:1.5rem">
      <div class="stat-card">
        <div class="stat-value" id="statPosts">0</div>
        <div class="stat-label">Posty</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="statViews">0</div>
        <div class="stat-label">Wyświetlenia</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="statLikes">0</div>
        <div class="stat-label">Lajki</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="statRts">0</div>
        <div class="stat-label">Retweets</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="statER">0%</div>
        <div class="stat-label">Śr. ER</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="statBestHour">—</div>
        <div class="stat-label">Najlepsza godz.</div>
      </div>
    </div>
    <div class="stat-card" style="margin-bottom:1.5rem;display:flex;gap:1rem;align-items:center;border-radius:var(--radius)">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;white-space:nowrap">Top temat</div>
      <div id="statTopTopic" style="font-size:14px;font-weight:600;color:var(--accent)">—</div>
    </div>

    <!-- AI analiza -->
    <div id="aiAnalysisBox" class="ai-response" style="display:none;margin-bottom:1.5rem"></div>

    <div class="two-col" style="align-items:start">

      <!-- Formularz logowania -->
      <div class="card">
        <div class="card-title">Zaloguj wyniki posta</div>

        <div class="field">
          <label for="aTopic">Temat / tytuł posta</label>
          <input type="text" id="aTopic" placeholder="np. Dlaczego Bitcoin rośnie w 2025?" />
        </div>

        <div class="field">
          <label for="aFormat">Format</label>
          <select id="aFormat">
            <option value="thread">🧵 Wątek</option>
            <option value="post">📝 Pojedynczy post</option>
          </select>
        </div>

        <div class="field">
          <label for="aDate">Data publikacji</label>
          <input type="datetime-local" id="aDate" value="${localISO}" />
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem">
          <div class="field" style="margin:0">
            <label for="aViews">👁 Wyświetlenia</label>
            <input type="number" id="aViews" placeholder="0" min="0" />
          </div>
          <div class="field" style="margin:0">
            <label for="aLikes">❤ Lajki</label>
            <input type="number" id="aLikes" placeholder="0" min="0" />
          </div>
          <div class="field" style="margin:0">
            <label for="aRts">🔁 Retweets</label>
            <input type="number" id="aRts" placeholder="0" min="0" />
          </div>
          <div class="field" style="margin:0">
            <label for="aReplies">💬 Replies</label>
            <input type="number" id="aReplies" placeholder="0" min="0" />
          </div>
        </div>

        <div class="field">
          <label for="aNotes">Notatki</label>
          <textarea id="aNotes" rows="2" placeholder="Obserwacje, co działało, co nie..."></textarea>
        </div>

        <button class="btn btn-primary" id="btnSaveEntry" style="width:100%">+ Zapisz wyniki</button>
      </div>

      <!-- Tabela wyników -->
      <div>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Temat</th>
                <th>Typ</th>
                <th>Views</th>
                <th>Lajki</th>
                <th>RT</th>
                <th>Reply</th>
                <th>ER%</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="analyticsTableBody">
              <tr><td colspan="9" style="text-align:center;padding:2rem"><span class="spinner"></span></td></tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>
  `

  document.getElementById('btnSaveEntry')?.addEventListener('click', saveEntry)
  document.getElementById('btnAnalyze')?.addEventListener('click', () => generateAIAnalysis(allEntries))

  loadAnalytics()
}
