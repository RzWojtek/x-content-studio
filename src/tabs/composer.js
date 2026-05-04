import { callAI } from '../ai.js'
import { db } from '../firebase.js'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { showToast, copyToClipboard } from '../utils/toast.js'

// ── Prompty systemowe ────────────────────────────────────────
const SYSTEM_THREAD = `Jesteś ekspertem od tworzenia treści krypto na platformie X (Twitter) po polsku.
Tworzysz angażujące, wartościowe wątki dla polskiej społeczności kryptowalutowej.
Styl: bezpośredni, edukacyjny, ale przystępny. Używasz emoji strategicznie (nie przesadzaj).
Pisz zawsze po polsku. Nie używaj hashtagów — chyba że użytkownik wyraźnie prosi.`

const SYSTEM_POST = `Jesteś ekspertem od tworzenia treści krypto na platformie X (Twitter) po polsku.
Tworzysz pojedyncze, angażujące posty. Każdy post max 280 znaków.
Styl: bezpośredni, hook na początku, wartość lub CTA na końcu. Pisz po polsku.`

// ── State ────────────────────────────────────────────────────
let currentTweets = []
let generating = false

// ── Parser wątku z odpowiedzi AI ────────────────────────────
function parseTweets(text) {
  // Próbuj rozdzielić po numeracji: "1.", "2." lub "---" lub podwójny newline
  let parts = []

  // Metoda 1: numerowane tweety
  const numbered = text.match(/(?:^|\n)\s*\d+[.)]\s+(.+?)(?=\n\s*\d+[.)]\s|\n---|\n\n\n|$)/gs)
  if (numbered && numbered.length >= 3) {
    parts = numbered.map(t => t.replace(/^\s*\d+[.)]\s+/, '').trim())
  } else {
    // Metoda 2: separator ---
    parts = text.split(/\n---+\n/).map(t => t.trim()).filter(Boolean)
    if (parts.length < 2) {
      // Metoda 3: podwójny newline
      parts = text.split(/\n\n\n+/).map(t => t.trim()).filter(Boolean)
      if (parts.length < 2) {
        // Fallback: pojedyncze tweety rozdzielone podwójnym newline
        parts = text.split(/\n\n/).map(t => t.trim()).filter(Boolean)
      }
    }
  }

  return parts.filter(p => p.length > 5).slice(0, 15)
}

// ── Render tweeta ────────────────────────────────────────────
function renderTweetCard(text, index, total) {
  const count = text.length
  const countClass = count > 280 ? 'over' : count > 250 ? 'warn' : 'ok'
  return `
    <div class="tweet-card" id="tcard-${index}">
      <div class="tweet-num">TWEET ${index + 1} / ${total}</div>
      <textarea
        id="tweet-${index}"
        class="tweet-textarea"
        rows="3"
        maxlength="400"
        data-index="${index}"
      >${text}</textarea>
      <div class="char-count ${countClass}" id="cc-${index}">${count} / 280</div>
    </div>
  `
}

// ── Aktualizuj licznik znaków ────────────────────────────────
function bindCharCounters() {
  document.querySelectorAll('.tweet-textarea').forEach(ta => {
    const idx = ta.dataset.index
    ta.addEventListener('input', () => {
      const cc = document.getElementById(`cc-${idx}`)
      const len = ta.value.length
      currentTweets[idx] = ta.value
      if (cc) {
        cc.textContent = `${len} / 280`
        cc.className = `char-count ${len > 280 ? 'over' : len > 250 ? 'warn' : 'ok'}`
      }
    })
  })
}

// ── Render panelu wyników ────────────────────────────────────
function renderResults(tweets) {
  const container = document.getElementById('composerResults')
  if (!tweets.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🧵</div>
      <div class="empty-state-text">Wygeneruj wątek lub post używając formularza</div>
    </div>`
    return
  }

  container.innerHTML = `
    <div class="section-header" style="margin-bottom:1rem">
      <div>
        <div class="section-title" style="font-size:16px">Wygenerowany wątek</div>
        <div class="section-sub">${tweets.length} tweetów</div>
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost" id="btnCopyAll">📋 Kopiuj wszystko</button>
        <button class="btn btn-secondary" id="btnSaveQueue">💾 Zapisz do kolejki</button>
        <button class="btn btn-ghost" id="btnClearResult">✕ Wyczyść</button>
      </div>
    </div>
    <div id="tweetList">
      ${tweets.map((t, i) => renderTweetCard(t, i, tweets.length)).join('')}
    </div>
  `

  bindCharCounters()

  document.getElementById('btnCopyAll')?.addEventListener('click', () => {
    const all = currentTweets.join('\n\n---\n\n')
    copyToClipboard(all)
  })

  document.getElementById('btnSaveQueue')?.addEventListener('click', saveToQueue)

  document.getElementById('btnClearResult')?.addEventListener('click', () => {
    currentTweets = []
    renderResults([])
  })
}

// ── Zapisz do Firestore (kolejka) ────────────────────────────
async function saveToQueue() {
  const topic = document.getElementById('composerTopic')?.value || 'Bez tytułu'
  const tweets = [...document.querySelectorAll('.tweet-textarea')].map(t => ({
    text: t.value,
    charCount: t.value.length
  }))

  if (!tweets.length) return showToast('Brak tweetów do zapisania', 'error')

  const btn = document.getElementById('btnSaveQueue')
  if (btn) { btn.disabled = true; btn.textContent = 'Zapisuję...' }

  try {
    await addDoc(collection(db, 'threads'), {
      title: topic,
      topic,
      tweets,
      createdAt: serverTimestamp(),
      scheduledAt: null,
      status: 'draft'
    })
    showToast('Zapisano do kolejki!', 'success')
    // Wyczyść po zapisie
    currentTweets = []
    renderResults([])
    if (document.getElementById('composerTopic')) document.getElementById('composerTopic').value = ''
    if (document.getElementById('composerInput')) document.getElementById('composerInput').value = ''
  } catch (err) {
    console.error(err)
    showToast('Błąd zapisu do Firebase', 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Zapisz do kolejki' }
  }
}

// ── Generuj wątek ────────────────────────────────────────────
async function generateThread() {
  if (generating) return
  const topic = document.getElementById('composerTopic')?.value?.trim()
  const content = document.getElementById('composerInput')?.value?.trim()
  const count = document.getElementById('tweetCount')?.value || '7'
  const mode = document.getElementById('composerMode')?.value || 'thread'

  if (!topic && !content) return showToast('Wpisz temat lub wklej treść do opracowania', 'error')

  generating = true
  const btn = document.getElementById('btnGenerate')
  if (btn) {
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Generuję...'
  }

  const container = document.getElementById('composerResults')
  container.innerHTML = `<div style="display:flex;align-items:center;gap:.75rem;padding:2rem;color:var(--text-muted)">
    <span class="spinner"></span> AI generuje treść, poczekaj chwilę...
  </div>`

  try {
    let prompt = ''

    if (mode === 'thread') {
      prompt = `Stwórz wątek na X (Twitter) po polsku składający się z dokładnie ${count} tweetów.
${topic ? `Temat: ${topic}` : ''}
${content ? `\nMateriał źródłowy (artykuł/whitepaper):\n${content.slice(0, 3000)}` : ''}

ZASADY FORMATOWANIA:
- Każdy tweet oddziel linią zawierającą tylko: ---
- Tweet 1 musi być hookiem (intrygujące pytanie, zaskakujący fakt lub mocna teza)
- Tweety 2-${Number(count) - 1} rozwijają temat z wartością edukacyjną
- Ostatni tweet to CTA (call to action — subskrypcja, komentarz, obserwuj)
- Max 280 znaków na tweet
- Pisz po polsku, styl angażujący i bezpośredni
- Możesz używać emoji strategicznie (1-2 na tweet max)

Zwróć TYLKO tweety oddzielone ---, bez żadnego wstępu ani komentarza.`

    } else {
      prompt = `Napisz pojedynczy post na X (Twitter) po polsku.
${topic ? `Temat: ${topic}` : ''}
${content ? `\nMateriał źródłowy:\n${content.slice(0, 2000)}` : ''}

ZASADY:
- Dokładnie 1 post, max 280 znaków
- Mocny hook na początku
- Wartość lub CTA na końcu
- Pisz po polsku
- Zwróć TYLKO treść posta, bez komentarza`
    }

    const result = await callAI(prompt, mode === 'thread' ? SYSTEM_THREAD : SYSTEM_POST)

    if (mode === 'thread') {
      currentTweets = parseTweets(result)
      if (currentTweets.length < 2) {
        // Fallback — traktuj całość jako jeden tweet
        currentTweets = [result.trim()]
      }
    } else {
      currentTweets = [result.trim().slice(0, 400)]
    }

    renderResults(currentTweets)

  } catch (err) {
    showToast(err.message || 'Błąd generowania', 'error')
    container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-text">${err.message}</div>
    </div>`
  } finally {
    generating = false
    if (btn) {
      btn.disabled = false
      btn.innerHTML = '⚡ Generuj'
    }
  }
}

// ── Sugestie tematów ─────────────────────────────────────────
async function suggestTopics() {
  const btn = document.getElementById('btnSuggest')
  if (btn) { btn.disabled = true; btn.textContent = '...' }

  try {
    const result = await callAI(
      `Zaproponuj 6 tematów na wątki krypto na X po polsku. Aktualne i angażujące.
Format: każdy temat w nowej linii, bez numeracji, bez punktów, bez komentarzy.
Tylko sam temat (do 80 znaków). Różnorodne: edukacja, analiza, DeFi, NFT, makro.`,
      'Jesteś ekspertem od content marketingu w krypto. Odpowiadaj po polsku.'
    )
    const topics = result.split('\n').map(t => t.trim()).filter(t => t.length > 5).slice(0, 6)

    const box = document.getElementById('suggestBox')
    if (box) {
      box.innerHTML = topics.map(t =>
        `<button class="btn btn-ghost" style="font-size:12px;padding:.3rem .7rem;text-align:left" data-topic="${t}">${t}</button>`
      ).join('')
      box.style.display = 'flex'
      box.querySelectorAll('[data-topic]').forEach(b => {
        b.addEventListener('click', () => {
          const inp = document.getElementById('composerTopic')
          if (inp) inp.value = b.dataset.topic
          box.style.display = 'none'
        })
      })
    }
  } catch (err) {
    showToast('Błąd sugestii tematów', 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💡 Zasugeruj tematy' }
  }
}

// ── Render zakładki ──────────────────────────────────────────
export function renderComposer() {
  const panel = document.getElementById('tab-composer')
  panel.innerHTML = `
    <div class="two-col" style="align-items:start">

      <!-- LEWA: Formularz -->
      <div>
        <div class="section-header">
          <div>
            <div class="section-title">Composer</div>
            <div class="section-sub">Generator wątków i postów krypto po polsku</div>
          </div>
        </div>

        <div class="card" style="margin-bottom:1rem">
          <div class="card-title">Ustawienia</div>

          <div class="field">
            <label for="composerMode">Typ treści</label>
            <select id="composerMode">
              <option value="thread">🧵 Wątek (multi-tweet)</option>
              <option value="post">📝 Pojedynczy post</option>
            </select>
          </div>

          <div class="field" id="tweetCountField">
            <label for="tweetCount">Liczba tweetów w wątku</label>
            <select id="tweetCount">
              <option value="5">5 tweetów</option>
              <option value="7" selected>7 tweetów</option>
              <option value="10">10 tweetów</option>
              <option value="12">12 tweetów</option>
              <option value="15">15 tweetów</option>
            </select>
          </div>

          <div class="field">
            <label for="composerTopic">Temat</label>
            <input type="text" id="composerTopic" placeholder="np. Dlaczego Bitcoin jest cyfrowym złotem?" />
          </div>

          <div id="suggestBox" style="display:none;flex-wrap:wrap;gap:.4rem;margin-bottom:.75rem"></div>

          <div class="field">
            <label for="composerInput">Artykuł / whitepaper (opcjonalnie)</label>
            <textarea id="composerInput" rows="5"
              placeholder="Wklej tutaj artykuł, whitepaper lub notatki do opracowania..."></textarea>
          </div>

          <div class="btn-row">
            <button class="btn btn-primary" id="btnGenerate">⚡ Generuj</button>
            <button class="btn btn-ghost" id="btnSuggest">💡 Zasugeruj tematy</button>
          </div>
        </div>
      </div>

      <!-- PRAWA: Wyniki -->
      <div>
        <div id="composerResults">
          <div class="empty-state" style="padding:4rem 1rem">
            <div class="empty-state-icon">🧵</div>
            <div class="empty-state-text">Wygeneruj wątek lub post używając formularza</div>
          </div>
        </div>
      </div>

    </div>
  `

  // Pokaż/ukryj pole liczby tweetów
  document.getElementById('composerMode')?.addEventListener('change', (e) => {
    const field = document.getElementById('tweetCountField')
    if (field) field.style.display = e.target.value === 'thread' ? '' : 'none'
  })

  document.getElementById('btnGenerate')?.addEventListener('click', generateThread)
  document.getElementById('btnSuggest')?.addEventListener('click', suggestTopics)
}
