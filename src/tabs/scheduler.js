import { db } from '../firebase.js'
import {
  collection, getDocs, doc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp
} from 'firebase/firestore'
import { showToast, copyToClipboard } from '../utils/toast.js'
import { callAI } from '../ai.js'

// ── Formatuj datę ────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
}

// ── Kopiuj wątek ─────────────────────────────────────────────
function threadToText(doc) {
  if (doc.tweets?.length) {
    return doc.tweets.map(t => t.text || t).join('\n\n---\n\n')
  }
  return doc.text || ''
}

// ── Render listy ─────────────────────────────────────────────
function renderQueue(items) {
  const container = document.getElementById('queueList')
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📅</div>
      <div class="empty-state-text">Brak postów w kolejce. Stwórz wątek w Composerze i zapisz go tutaj.</div>
    </div>`
    return
  }

  container.innerHTML = items.map(item => {
    const tweetCount = item.tweets?.length || 1
    const preview = item.tweets?.[0]?.text || item.text || ''
    const previewShort = preview.length > 80 ? preview.slice(0, 80) + '…' : preview

    return `
      <div class="queue-item" id="qitem-${item.id}">
        <div class="queue-item-info">
          <div class="queue-item-title">${item.topic || item.title || 'Bez tytułu'}</div>
          <div class="queue-item-meta" style="margin-bottom:.3rem">${previewShort}</div>
          <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
            <span class="badge badge-${item.status || 'draft'}">${
              item.status === 'published' ? '✓ Opublikowany' :
              item.status === 'scheduled' ? '🕐 Zaplanowany' : '📝 Draft'
            }</span>
            ${tweetCount > 1 ? `<span class="badge badge-draft">🧵 ${tweetCount} tweetów</span>` : ''}
            ${item.scheduledAt ? `<span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">${fmtDate(item.scheduledAt)}</span>` : ''}
          </div>
        </div>
        <div class="queue-item-actions">
          <button class="btn btn-secondary" style="font-size:12px;padding:.3rem .7rem" data-copy="${item.id}">📋 Kopiuj</button>
          ${item.status !== 'published'
            ? `<button class="btn btn-ghost" style="font-size:12px;padding:.3rem .7rem" data-schedule="${item.id}">⏰ Planuj</button>
               <button class="btn btn-ghost" style="font-size:12px;padding:.3rem .7rem;color:var(--success);border-color:rgba(0,230,118,.3)" data-publish="${item.id}">✓ Opublikowany</button>`
            : ''
          }
          <button class="btn btn-danger" style="font-size:12px;padding:.3rem .7rem" data-delete="${item.id}">✕</button>
        </div>
      </div>
    `
  }).join('')

  // Bind events
  container.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = items.find(i => i.id === btn.dataset.copy)
      if (item) copyToClipboard(threadToText(item))
    })
  })

  container.querySelectorAll('[data-schedule]').forEach(btn => {
    btn.addEventListener('click', () => openScheduleModal(btn.dataset.schedule, items))
  })

  container.querySelectorAll('[data-publish]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await updateDoc(doc(db, 'threads', btn.dataset.publish), { status: 'published' })
      showToast('Status zmieniony na: Opublikowany', 'success')
      loadQueue()
    })
  })

  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Usunąć ten post z kolejki?')) return
      await deleteDoc(doc(db, 'threads', btn.dataset.delete))
      showToast('Usunięto', '')
      loadQueue()
    })
  })
}

// ── Modal planowania ─────────────────────────────────────────
function openScheduleModal(id, items) {
  const existing = document.getElementById('scheduleModal')
  if (existing) existing.remove()

  const now = new Date()
  const localISO = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

  const modal = document.createElement('div')
  modal.id = 'scheduleModal'
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;
    display:flex;align-items:center;justify-content:center;padding:1rem`
  modal.innerHTML = `
    <div class="card" style="max-width:400px;width:100%;background:var(--bg-dark)">
      <div class="card-title">Zaplanuj publikację</div>
      <div class="field">
        <label>Data i godzina</label>
        <input type="datetime-local" id="scheduleDateTime" value="${localISO}" />
      </div>
      <div class="btn-row" style="margin-top:.75rem">
        <button class="btn btn-primary" id="btnConfirmSchedule">✓ Zapisz</button>
        <button class="btn btn-ghost" id="btnCloseModal">Anuluj</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)

  document.getElementById('btnCloseModal').addEventListener('click', () => modal.remove())
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove() })

  document.getElementById('btnConfirmSchedule').addEventListener('click', async () => {
    const val = document.getElementById('scheduleDateTime').value
    if (!val) return showToast('Wybierz datę i godzinę', 'error')
    const ts = new Date(val)
    await updateDoc(doc(db, 'threads', id), {
      scheduledAt: ts,
      status: 'scheduled'
    })
    showToast('Zaplanowano!', 'success')
    modal.remove()
    loadQueue()
  })
}

// ── Sugestia godzin publikacji ───────────────────────────────
async function suggestBestTimes() {
  const btn = document.getElementById('btnSuggestTimes')
  if (btn) { btn.disabled = true; btn.textContent = '...' }

  try {
    const result = await callAI(
      `Na podstawie ogólnych danych o aktywności użytkowników X (Twitter) w Polsce:
Podaj 5 najlepszych przedziałów czasowych do publikacji treści krypto po polsku.
Format: każda sugestia w nowej linii, np: "09:00-10:00 — poranny scroll przed pracą"
Krótkie uzasadnienie (max 60 znaków). Uwzględnij strefy czasowe CET/CEST.
Zwróć TYLKO listę, bez wstępu.`,
      'Jesteś ekspertem od content marketingu na X (Twitter) w Polsce.'
    )
    const box = document.getElementById('timeSuggestions')
    if (box) {
      box.innerHTML = `
        <div class="ai-response-header">✦ Sugestie AI — optymalne godziny</div>
        <div style="font-size:13px;line-height:1.8;white-space:pre-wrap">${result.trim()}</div>
      `
      box.style.display = 'block'
    }
  } catch (err) {
    showToast('Błąd sugestii', 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🕐 Sugestia godzin' }
  }
}

// ── Filtrowanie ──────────────────────────────────────────────
let allItems = []

function filterQueue(status) {
  if (status === 'all') renderQueue(allItems)
  else renderQueue(allItems.filter(i => (i.status || 'draft') === status))
}

// ── Ładuj z Firestore ────────────────────────────────────────
async function loadQueue() {
  const container = document.getElementById('queueList')
  container.innerHTML = `<div style="display:flex;align-items:center;gap:.75rem;padding:2rem;color:var(--text-muted)">
    <span class="spinner"></span> Ładowanie kolejki...
  </div>`

  try {
    const q = query(collection(db, 'threads'), orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    allItems = snap.docs.map(d => ({ id: d.id, ...d.data() }))

    const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all'
    filterQueue(activeFilter)

    // Aktualizuj liczniki
    const counts = { all: allItems.length, draft: 0, scheduled: 0, published: 0 }
    allItems.forEach(i => { counts[i.status || 'draft']++ })
    document.querySelectorAll('.filter-btn').forEach(b => {
      const f = b.dataset.filter
      const cnt = document.getElementById(`cnt-${f}`)
      if (cnt) cnt.textContent = counts[f] ?? counts.all
    })

  } catch (err) {
    console.error(err)
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-text">Błąd ładowania. Sprawdź połączenie.</div>
    </div>`
  }
}

// ── Render zakładki ──────────────────────────────────────────
export function renderScheduler() {
  const panel = document.getElementById('tab-scheduler')
  panel.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Scheduler</div>
        <div class="section-sub">Kolejka postów do ręcznej publikacji</div>
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost" id="btnSuggestTimes">🕐 Sugestia godzin</button>
        <button class="btn btn-ghost" id="btnRefreshQueue">↻ Odśwież</button>
      </div>
    </div>

    <div id="timeSuggestions" class="ai-response" style="display:none;margin-bottom:1rem"></div>

    <div style="display:flex;gap:.4rem;margin-bottom:1rem;flex-wrap:wrap">
      <button class="btn btn-secondary filter-btn active" data-filter="all">Wszystkie <span id="cnt-all" class="badge badge-draft" style="margin-left:.25rem">0</span></button>
      <button class="btn btn-ghost filter-btn" data-filter="draft">Drafty <span id="cnt-draft" class="badge badge-draft" style="margin-left:.25rem">0</span></button>
      <button class="btn btn-ghost filter-btn" data-filter="scheduled">Zaplanowane <span id="cnt-scheduled" class="badge badge-scheduled" style="margin-left:.25rem">0</span></button>
      <button class="btn btn-ghost filter-btn" data-filter="published">Opublikowane <span id="cnt-published" class="badge badge-published" style="margin-left:.25rem">0</span></button>
    </div>

    <div id="queueList"></div>
  `

  document.getElementById('btnRefreshQueue')?.addEventListener('click', loadQueue)
  document.getElementById('btnSuggestTimes')?.addEventListener('click', suggestBestTimes)

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active')
        b.className = b.className.replace('btn-secondary', 'btn-ghost')
      })
      btn.classList.add('active')
      btn.className = btn.className.replace('btn-ghost', 'btn-secondary')
      filterQueue(btn.dataset.filter)
    })
  })

  loadQueue()
}
