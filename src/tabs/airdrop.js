import { callAI } from '../ai.js'
import { db } from '../firebase.js'
import {
  collection, addDoc, getDocs, doc, deleteDoc,
  query, orderBy, serverTimestamp, updateDoc
} from 'firebase/firestore'
import { showToast, copyToClipboard } from '../utils/toast.js'

// ── Znane airdropy (seed data — aktualizuj ręcznie) ──────────
const KNOWN_AIRDROPS = [
  { name: 'MegaETH', chain: 'Ethereum L2', status: 'ongoing', type: 'mainnet', actions: 'Bridge do mainnet, interakcje z dApps', url: 'https://airdrops.io/megaeth/', hot: true },
  { name: 'Polymarket', chain: 'Polygon', status: 'ongoing', type: 'confirmed', actions: 'Deposit i robienie predykcji', url: 'https://airdrops.io/polymarket/', hot: true },
  { name: 'Ink Chain', chain: 'Ethereum L2', status: 'ongoing', type: 'confirmed', actions: 'Trade na Kraken Pro, interakcje z Dapps', url: 'https://airdrops.io/ink-chain/', hot: false },
  { name: 'Monad', chain: 'Monad', status: 'testnet', type: 'potential', actions: 'Testnet — transakcje, bridging', url: 'https://airdrops.io/speculative/monad/', hot: false },
  { name: 'MegaETH Testnet', chain: 'MegaETH', status: 'testnet', type: 'potential', actions: 'Testnet — deploy kontraktów, swappy', url: 'https://airdrops.io/speculative/megaeth/', hot: true },
]

// ── Fetch z DeFiLlama API (publiczne, bez klucza) ────────────
async function fetchDeFiLlamaProtocols() {
  try {
    const res = await fetch('https://api.llama.fi/protocols')
    if (!res.ok) throw new Error('DeFiLlama API error')
    const data = await res.json()
    // Filtruj protokoły bez tokena (potencjalne airdropy)
    return data
      .filter(p => !p.symbol || p.symbol === '' || p.symbol === null)
      .filter(p => p.tvl > 1000000) // min 1M TVL
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 20)
      .map(p => ({
        name: p.name,
        chain: p.chain || p.chains?.[0] || '?',
        tvl: p.tvl,
        category: p.category,
        url: p.url,
        logo: p.logo,
        fromLlama: true
      }))
  } catch (err) {
    console.warn('DeFiLlama fetch failed:', err.message)
    return []
  }
}

// ── Formatuj TVL ─────────────────────────────────────────────
function fmtTVL(val) {
  if (!val) return '—'
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`
  return `$${Math.round(val).toLocaleString('pl-PL')}`
}

// ── Render karty airdropu ────────────────────────────────────
function renderAirdropCard(a) {
  const statusColor = a.status === 'ongoing' ? 'var(--success)' : a.status === 'testnet' ? 'var(--warning)' : 'var(--accent)'
  const statusLabel = a.status === 'ongoing' ? '🟢 Aktywny' : a.status === 'testnet' ? '🟡 Testnet' : '🔵 Potencjalny'
  const typeLabel = a.type === 'confirmed' ? 'Confirmed' : a.type === 'mainnet' ? 'Mainnet' : 'Potential'
  const typeBadge = a.type === 'confirmed' ? 'badge-published' : a.type === 'mainnet' ? 'badge-scheduled' : 'badge-draft'

  return `
    <div class="airdrop-card" data-name="${a.name}">
      <div class="airdrop-card-header">
        <div style="display:flex;align-items:center;gap:.6rem;flex:1;min-width:0">
          ${a.logo ? `<img src="${a.logo}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">` : `<div style="width:28px;height:28px;border-radius:50%;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">✦</div>`}
          <div style="min-width:0">
            <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.name}</div>
            <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">${a.chain || '?'}${a.category ? ` · ${a.category}` : ''}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.3rem;flex-shrink:0">
          <span class="badge ${typeBadge}">${typeLabel}</span>
          ${a.hot ? `<span style="font-size:10px;color:var(--warning);font-family:var(--font-mono)">🔥 HOT</span>` : ''}
        </div>
      </div>

      <div style="margin:.6rem 0;font-size:12px;color:var(--text-muted)">
        <span style="color:${statusColor};font-weight:600">${statusLabel}</span>
        ${a.tvl ? `<span style="margin-left:.75rem">TVL: <strong style="color:var(--accent)">${fmtTVL(a.tvl)}</strong></span>` : ''}
      </div>

      ${a.actions ? `<div style="font-size:12px;color:var(--text);background:var(--bg-darker);border-radius:var(--radius-sm);padding:.4rem .6rem;margin-bottom:.6rem">
        <span style="color:var(--text-muted)">Actions: </span>${a.actions}
      </div>` : ''}

      <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem">
        <button class="btn btn-primary" style="font-size:11px;padding:.3rem .65rem" data-gen-thread="${a.name}" data-airdrop='${JSON.stringify(a).replace(/'/g, "&#39;")}'>
          ⚡ Generuj wątek
        </button>
        ${a.url ? `<a href="${a.url}" target="_blank" rel="noopener" class="btn btn-ghost" style="font-size:11px;padding:.3rem .65rem">🔗 Szczegóły</a>` : ''}
        ${!a.fromLlama ? `<button class="btn btn-danger" style="font-size:11px;padding:.3rem .65rem" data-del-airdrop="${a.id || a.name}">✕</button>` : ''}
      </div>
    </div>
  `
}

// ── Render sekcji DeFiLlama ──────────────────────────────────
function renderLlamaCard(p) {
  return `
    <div class="airdrop-card">
      <div class="airdrop-card-header">
        <div style="display:flex;align-items:center;gap:.6rem;flex:1;min-width:0">
          ${p.logo ? `<img src="${p.logo}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display='none'">` : `<div style="width:24px;height:24px;border-radius:50%;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;font-size:10px">✦</div>`}
          <div style="min-width:0">
            <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
            <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">${p.chain} · ${p.category || 'DeFi'}</div>
          </div>
        </div>
        <div style="font-family:var(--font-mono);font-size:12px;color:var(--accent);font-weight:700;flex-shrink:0">${fmtTVL(p.tvl)}</div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin:.4rem 0">Brak tokena → potencjalny airdrop</div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.4rem">
        <button class="btn btn-secondary" style="font-size:11px;padding:.25rem .6rem" data-gen-thread="${p.name}" data-airdrop='${JSON.stringify(p).replace(/'/g, "&#39;")}'>
          ⚡ Generuj wątek
        </button>
        ${p.url ? `<a href="${p.url}" target="_blank" rel="noopener" class="btn btn-ghost" style="font-size:11px;padding:.25rem .6rem">🔗 Strona</a>` : ''}
      </div>
    </div>
  `
}

// ── Generuj wątek o airdropie ────────────────────────────────
async function generateAirdropThread(airdrop, outputEl) {
  outputEl.innerHTML = `<div style="display:flex;align-items:center;gap:.75rem;padding:1.5rem;color:var(--text-muted)">
    <span class="spinner"></span> AI generuje wątek o ${airdrop.name}...
  </div>`

  const prompt = `Stwórz wątek na X (Twitter) po polsku (7 tweetów) o airdropie/projekcie krypto.

DANE O PROJEKCIE:
- Nazwa: ${airdrop.name}
- Sieć/Chain: ${airdrop.chain || '?'}
- Status: ${airdrop.status || 'aktywny'}
- Kategoria: ${airdrop.category || 'DeFi'}
${airdrop.tvl ? `- TVL: ${fmtTVL(airdrop.tvl)}` : ''}
${airdrop.actions ? `- Wymagane działania: ${airdrop.actions}` : ''}
${airdrop.url ? `- Link: ${airdrop.url}` : ''}

STRUKTURA WĄTKU (7 tweetów oddzielonych ---):
1. Hook — co to jest i dlaczego warto (intryga, liczby jeśli dostępne)
2. Co to jest ${airdrop.name} — opis projektu i jego cel
3. Dlaczego może być wartościowy airdrop (TVL, backing, aktywność)
4. Jak się zakwalifikować — co trzeba zrobić krok po kroku
5. Szczegóły działań (bridge, swappy, interakcje z dApp etc)
6. Ryzyka i na co uważać (DYOR, nie gwarantowany airdrop)
7. CTA — obserwuj mnie po więcej takich info, link jeśli dostępny

ZASADY:
- Pisz po polsku
- Max 280 znaków na tweet
- Każdy tweet oddziel ---
- Używaj emoji strategicznie
- Ton: pomocny ekspert, nie hype
- Zaznacz że to nie jest porada finansowa (tweet 6 lub 7)

Zwróć TYLKO tweety oddzielone ---, bez wstępu.`

  try {
    const result = await callAI(prompt, `Jesteś ekspertem od krypto airdrops i tworzysz edukacyjne wątki po polsku dla polskiej społeczności.
Zawsze zaznaczasz DYOR i brak gwarancji. Piszesz rzetelnie i pomocnie.`)

    const tweets = result.split(/\n---+\n|---\n/).map(t => t.trim()).filter(t => t.length > 5)

    if (!tweets.length) throw new Error('Nie udało się sparsować tweetów')

    outputEl.innerHTML = `
      <div class="ai-response-header" style="margin-bottom:.75rem">✦ Wątek o ${airdrop.name} — ${tweets.length} tweetów</div>
      ${tweets.map((t, i) => `
        <div class="tweet-card" style="margin-bottom:.5rem">
          <div class="tweet-num">TWEET ${i + 1} / ${tweets.length}</div>
          <textarea class="airdrop-tweet-ta" data-index="${i}" rows="3" style="width:100%;background:var(--bg-input);border:1px solid var(--border-dim);border-radius:var(--radius-sm);color:var(--text);font-size:13px;padding:.5rem;resize:vertical;outline:none;font-family:var(--font-main)">${t}</textarea>
          <div class="char-count ${t.length > 280 ? 'over' : t.length > 250 ? 'warn' : 'ok'}" id="acc-${i}">${t.length} / 280</div>
        </div>
      `).join('')}
      <div class="btn-row" style="margin-top:.75rem">
        <button class="btn btn-primary" id="btnSaveAirdropThread">💾 Zapisz do kolejki</button>
        <button class="btn btn-ghost" id="btnCopyAirdropThread">📋 Kopiuj wszystko</button>
      </div>
    `

    // Bind char counters
    outputEl.querySelectorAll('.airdrop-tweet-ta').forEach(ta => {
      const idx = ta.dataset.index
      ta.addEventListener('input', () => {
        const cc = outputEl.querySelector(`#acc-${idx}`)
        const len = ta.value.length
        if (cc) {
          cc.textContent = `${len} / 280`
          cc.className = `char-count ${len > 280 ? 'over' : len > 250 ? 'warn' : 'ok'}`
        }
      })
      // Focus style
      ta.addEventListener('focus', () => { ta.style.borderColor = 'var(--accent)'; ta.style.boxShadow = '0 0 0 3px var(--accent-dim)' })
      ta.addEventListener('blur', () => { ta.style.borderColor = 'var(--border-dim)'; ta.style.boxShadow = 'none' })
    })

    outputEl.querySelector('#btnCopyAirdropThread')?.addEventListener('click', () => {
      const all = [...outputEl.querySelectorAll('.airdrop-tweet-ta')].map(t => t.value).join('\n\n---\n\n')
      copyToClipboard(all)
    })

    outputEl.querySelector('#btnSaveAirdropThread')?.addEventListener('click', async () => {
      const tweetsToSave = [...outputEl.querySelectorAll('.airdrop-tweet-ta')].map(t => ({
        text: t.value, charCount: t.value.length
      }))
      try {
        await addDoc(collection(db, 'threads'), {
          title: `Airdrop: ${airdrop.name}`,
          topic: `Airdrop ${airdrop.name}`,
          tweets: tweetsToSave,
          createdAt: serverTimestamp(),
          scheduledAt: null,
          status: 'draft'
        })
        showToast('Zapisano do kolejki!', 'success')
      } catch (err) {
        showToast('Błąd zapisu', 'error')
      }
    })

  } catch (err) {
    outputEl.innerHTML = `<div style="color:var(--danger);font-size:13px;padding:1rem">⚠ ${err.message}</div>`
  }
}

// ── Wczytaj custom airdropy z Firestore ──────────────────────
async function loadCustomAirdrops() {
  try {
    const q = query(collection(db, 'airdrops'), orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data(), fromFirestore: true }))
  } catch {
    return []
  }
}

// ── Zapisz własny airdrop ────────────────────────────────────
async function saveCustomAirdrop() {
  const name = document.getElementById('adName')?.value?.trim()
  const chain = document.getElementById('adChain')?.value?.trim()
  const status = document.getElementById('adStatus')?.value
  const type = document.getElementById('adType')?.value
  const actions = document.getElementById('adActions')?.value?.trim()
  const url = document.getElementById('adUrl')?.value?.trim()
  const notes = document.getElementById('adNotes')?.value?.trim()

  if (!name) return showToast('Wpisz nazwę projektu', 'error')

  const btn = document.getElementById('btnSaveAirdrop')
  if (btn) { btn.disabled = true; btn.textContent = 'Zapisuję...' }

  try {
    await addDoc(collection(db, 'airdrops'), {
      name, chain, status, type, actions, url, notes,
      hot: false, createdAt: serverTimestamp()
    })
    showToast('Airdrop dodany!', 'success')
    ;['adName', 'adChain', 'adActions', 'adUrl', 'adNotes'].forEach(id => {
      const el = document.getElementById(id)
      if (el) el.value = ''
    })
    loadAndRenderAll()
  } catch (err) {
    showToast('Błąd zapisu', 'error')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '+ Dodaj do listy' }
  }
}

// ── Główny render ────────────────────────────────────────────
async function loadAndRenderAll() {
  const hotSection = document.getElementById('hotAirdrops')
  const llamaSection = document.getElementById('llamaAirdrops')
  const customSection = document.getElementById('customAirdrops')

  // Sekcja HOT (hardcoded)
  hotSection.innerHTML = KNOWN_AIRDROPS.filter(a => a.hot).map(renderAirdropCard).join('')
  // Wszystkie znane
  customSection.innerHTML = `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:1rem"><span class="spinner"></span> Ładowanie...</div>`

  // DeFiLlama
  llamaSection.innerHTML = `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:1rem"><span class="spinner"></span> Pobieram z DeFiLlama...</div>`
  const llamaData = await fetchDeFiLlamaProtocols()
  if (llamaData.length) {
    llamaSection.innerHTML = llamaData.map(renderLlamaCard).join('')
  } else {
    llamaSection.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:1rem">Nie udało się załadować danych DeFiLlama. Sprawdź połączenie.</div>`
  }

  // Custom z Firestore
  const customData = await loadCustomAirdrops()
  const allKnown = [...KNOWN_AIRDROPS.filter(a => !a.hot), ...customData]
  customSection.innerHTML = allKnown.length
    ? allKnown.map(renderAirdropCard).join('')
    : `<div class="empty-state-text" style="padding:1rem;color:var(--text-muted);font-size:13px">Dodaj własne airdropy używając formularza poniżej</div>`

  bindAirdropButtons()
}

// ── Bind przycisków kart ─────────────────────────────────────
function bindAirdropButtons() {
  const outputEl = document.getElementById('threadOutput')

  document.querySelectorAll('[data-gen-thread]').forEach(btn => {
    btn.addEventListener('click', () => {
      try {
        const airdrop = JSON.parse(btn.dataset.airdrop.replace(/&#39;/g, "'"))
        outputEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
        generateAirdropThread(airdrop, outputEl)
      } catch (err) {
        showToast('Błąd parsowania danych airdropu', 'error')
      }
    })
  })

  document.querySelectorAll('[data-del-airdrop]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delAirdrop
      if (!confirm('Usunąć ten airdrop z listy?')) return
      try {
        await deleteDoc(doc(db, 'airdrops', id))
        showToast('Usunięto', '')
        loadAndRenderAll()
      } catch {
        showToast('Błąd usuwania', 'error')
      }
    })
  })
}

// ── Render zakładki ──────────────────────────────────────────
export function renderAirdrop() {
  const panel = document.getElementById('tab-airdrop')
  panel.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Airdrop Radar</div>
        <div class="section-sub">Śledź airdropy i generuj wątki krok po kroku</div>
      </div>
      <button class="btn btn-ghost" id="btnRefreshAirdrops">↻ Odśwież</button>
    </div>

    <!-- GENERATOR OUTPUT — widoczny na górze -->
    <div class="card" style="margin-bottom:1.5rem;display:none" id="threadOutputCard">
      <div class="card-title">⚡ Wygenerowany wątek</div>
      <div id="threadOutput"></div>
    </div>

    <div class="two-col" style="align-items:start;gap:1.25rem">

      <!-- LEWA kolumna: listy airdropów -->
      <div>

        <!-- HOT airdropy -->
        <div class="card" style="margin-bottom:1rem">
          <div class="card-title">🔥 HOT — Najpopularniejsze teraz</div>
          <div id="hotAirdrops" style="display:grid;gap:.6rem">
            <div style="color:var(--text-muted);font-size:12px"><span class="spinner"></span></div>
          </div>
        </div>

        <!-- DeFiLlama — bez tokena -->
        <div class="card" style="margin-bottom:1rem">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
            <div class="card-title" style="margin:0">📊 DeFiLlama — Projekty bez tokena</div>
            <a href="https://defillama.com/airdrops" target="_blank" class="btn btn-ghost" style="font-size:11px;padding:.2rem .5rem">defillama.com ↗</a>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:.75rem">Protokoły z dużym TVL ale bez własnego tokena — klasyczne kandydaty na airdrop</div>
          <div id="llamaAirdrops" style="display:grid;gap:.5rem"></div>
        </div>

        <!-- Wszystkie znane + custom -->
        <div class="card">
          <div class="card-title">📋 Inne airdropy i Twoje własne</div>
          <div id="customAirdrops" style="display:grid;gap:.5rem"></div>
        </div>

      </div>

      <!-- PRAWA kolumna: wątek output + dodaj własny -->
      <div>

        <!-- Output wątku (sticky) -->
        <div class="card" style="margin-bottom:1rem">
          <div class="card-title">⚡ Generator wątku</div>
          <div id="threadOutput">
            <div class="empty-state" style="padding:2rem 1rem">
              <div class="empty-state-icon">✦</div>
              <div class="empty-state-text">Kliknij "Generuj wątek" przy dowolnym airdropie</div>
            </div>
          </div>
        </div>

        <!-- Dodaj własny airdrop -->
        <div class="card">
          <div class="card-title">+ Dodaj własny airdrop</div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:1rem">Znalazłeś ciekawy projekt na airdrops.io lub watchoor.xyz? Dodaj go tutaj ręcznie.</div>

          <div class="field">
            <label for="adName">Nazwa projektu *</label>
            <input type="text" id="adName" placeholder="np. LayerZero, Monad..." />
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
            <div class="field" style="margin:0">
              <label for="adChain">Chain / Sieć</label>
              <input type="text" id="adChain" placeholder="np. Ethereum, Solana" />
            </div>
            <div class="field" style="margin:0">
              <label for="adStatus">Status</label>
              <select id="adStatus">
                <option value="ongoing">🟢 Aktywny</option>
                <option value="testnet">🟡 Testnet</option>
                <option value="potential">🔵 Potencjalny</option>
              </select>
            </div>
          </div>

          <div class="field" style="margin-top:.75rem">
            <label for="adType">Typ airdropu</label>
            <select id="adType">
              <option value="potential">Potential</option>
              <option value="confirmed">Confirmed</option>
              <option value="mainnet">Mainnet</option>
            </select>
          </div>

          <div class="field">
            <label for="adActions">Co trzeba zrobić (actions)</label>
            <textarea id="adActions" rows="2" placeholder="np. Bridge ETH, swap na dEx, deposit do protokołu..."></textarea>
          </div>

          <div class="field">
            <label for="adUrl">Link (airdrops.io, watchoor.xyz itp.)</label>
            <input type="url" id="adUrl" placeholder="https://airdrops.io/..." />
          </div>

          <div class="field">
            <label for="adNotes">Notatki własne</label>
            <textarea id="adNotes" rows="2" placeholder="Twoje obserwacje, stan farmienia..."></textarea>
          </div>

          <button class="btn btn-primary" id="btnSaveAirdrop" style="width:100%">+ Dodaj do listy</button>
        </div>

        <!-- Linki do źródeł -->
        <div class="card" style="margin-top:1rem">
          <div class="card-title">🔗 Źródła — sprawdź samemu</div>
          <div style="display:flex;flex-direction:column;gap:.4rem">
            ${[
              ['airdrops.io/hot', 'https://airdrops.io/hot/'],
              ['airdrops.io/latest', 'https://airdrops.io/latest/'],
              ['airdrops.io/speculative', 'https://airdrops.io/speculative/'],
              ['watchoor.xyz/guides', 'https://watchoor.xyz/guides'],
              ['defillama.com/airdrops', 'https://defillama.com/airdrops'],
              ['earndrop.io', 'https://earndrop.io'],
              ['alphaseek.io', 'https://alphaseek.io'],
            ].map(([label, url]) =>
              `<a href="${url}" target="_blank" rel="noopener" class="btn btn-ghost" style="font-size:12px;padding:.3rem .75rem;justify-content:space-between">
                <span>${label}</span><span>↗</span>
              </a>`
            ).join('')}
          </div>
        </div>

      </div>
    </div>
  `

  document.getElementById('btnRefreshAirdrops')?.addEventListener('click', loadAndRenderAll)
  document.getElementById('btnSaveAirdrop')?.addEventListener('click', saveCustomAirdrop)

  // CSS dla airdrop cards (dodane inline żeby nie edytować style.css)
  if (!document.getElementById('airdropStyles')) {
    const style = document.createElement('style')
    style.id = 'airdropStyles'
    style.textContent = `
      .airdrop-card {
        background: var(--bg-darker);
        border: 1px solid var(--border-dim);
        border-radius: var(--radius);
        padding: .85rem;
        transition: border-color .2s;
      }
      .airdrop-card:hover { border-color: var(--border); }
      .airdrop-card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: .5rem;
        margin-bottom: .4rem;
      }
    `
    document.head.appendChild(style)
  }

  loadAndRenderAll()
}
