import { callAI } from '../ai.js'
import { db } from '../firebase.js'
import {
  collection, addDoc, getDocs, doc, deleteDoc,
  query, orderBy, serverTimestamp, getCountFromServer
} from 'firebase/firestore'
import { showToast, copyToClipboard } from '../utils/toast.js'

// ── Dane startowe — wgrywane do Firestore TYLKO raz (gdy baza pusta) ──
const SEED_AIRDROPS = [
  { name: 'MegaETH', chain: 'Ethereum L2', status: 'ongoing', type: 'confirmed', actions: 'Bridge do mainnet, interakcje z dApps', url: 'https://airdrops.io/megaeth/', hot: true },
  { name: 'MegaETH Testnet', chain: 'MegaETH', status: 'testnet', type: 'potential', actions: 'Testnet — deploy kontraktów, swappy', url: 'https://airdrops.io/speculative/megaeth/', hot: true },
  { name: 'Polymarket', chain: 'Polygon', status: 'ongoing', type: 'confirmed', actions: 'Deposit i robienie predykcji', url: 'https://airdrops.io/polymarket/', hot: true },
  { name: 'Ink Chain', chain: 'Ethereum L2', status: 'ongoing', type: 'confirmed', actions: 'Trade na Kraken Pro, interakcje z Dapps', url: 'https://airdrops.io/ink-chain/', hot: false },
  { name: 'Monad', chain: 'Monad', status: 'testnet', type: 'potential', actions: 'Testnet — transakcje, bridging', url: 'https://airdrops.io/speculative/monad/', hot: false },
]

async function seedIfEmpty() {
  try {
    const snap = await getCountFromServer(collection(db, 'airdrops'))
    if (snap.data().count > 0) return
    for (const a of SEED_AIRDROPS) {
      await addDoc(collection(db, 'airdrops'), { ...a, createdAt: serverTimestamp() })
    }
  } catch (err) {
    console.warn('[Airdrop] Seed failed:', err.message)
  }
}

async function fetchDeFiLlamaProtocols() {
  try {
    const res = await fetch('https://api.llama.fi/protocols')
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    return data
      .filter(p => !p.symbol || p.symbol === '' || p.symbol === null)
      .filter(p => p.tvl > 1000000)
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 20)
      .map(p => ({ name: p.name, chain: p.chain || p.chains?.[0] || '?', tvl: p.tvl, category: p.category, url: p.url, logo: p.logo, fromLlama: true }))
  } catch (err) {
    console.warn('[Airdrop] DeFiLlama:', err.message)
    return []
  }
}

function fmtTVL(val) {
  if (!val) return '—'
  if (val >= 1e9) return '$' + (val / 1e9).toFixed(2) + 'B'
  if (val >= 1e6) return '$' + (val / 1e6).toFixed(1) + 'M'
  return '$' + Math.round(val).toLocaleString('pl-PL')
}

function renderAirdropCard(a) {
  const statusColor = a.status === 'ongoing' ? 'var(--success)' : a.status === 'testnet' ? 'var(--warning)' : 'var(--accent)'
  const statusLabel = a.status === 'ongoing' ? '🟢 Aktywny' : a.status === 'testnet' ? '🟡 Testnet' : '🔵 Potencjalny'
  const typeBadge   = a.type === 'confirmed' ? 'badge-published' : a.type === 'mainnet' ? 'badge-scheduled' : 'badge-draft'
  const typeLabel   = a.type === 'confirmed' ? 'Confirmed' : a.type === 'mainnet' ? 'Mainnet' : 'Potential'
  const encoded     = encodeURIComponent(JSON.stringify(a))
  return `
    <div class="airdrop-card">
      <div class="airdrop-card-header">
        <div style="display:flex;align-items:center;gap:.6rem;flex:1;min-width:0">
          <div style="width:28px;height:28px;border-radius:50%;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">✦</div>
          <div style="min-width:0">
            <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.name}</div>
            <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">${a.chain || '?'}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.3rem;flex-shrink:0">
          <span class="badge ${typeBadge}">${typeLabel}</span>
          ${a.hot ? '<span style="font-size:10px;color:var(--warning);font-family:var(--font-mono)">🔥 HOT</span>' : ''}
        </div>
      </div>
      <div style="margin:.4rem 0;font-size:12px"><span style="color:${statusColor};font-weight:600">${statusLabel}</span></div>
      ${a.actions ? '<div style="font-size:12px;color:var(--text);background:var(--bg-darker);border-radius:var(--radius-sm);padding:.4rem .6rem;margin-bottom:.5rem"><span style="color:var(--text-muted)">Actions: </span>' + a.actions + '</div>' : ''}
      ${a.notes ? '<div style="font-size:11px;color:var(--text-muted);padding:.3rem .6rem;margin-bottom:.4rem;border-left:2px solid var(--border)">' + a.notes + '</div>' : ''}
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem">
        <button class="btn btn-primary" style="font-size:11px;padding:.3rem .65rem" data-gen="${encoded}">⚡ Generuj wątek</button>
        ${a.url ? '<a href="' + a.url + '" target="_blank" rel="noopener" class="btn btn-ghost" style="font-size:11px;padding:.3rem .65rem">🔗 Szczegóły</a>' : ''}
        <button class="btn btn-danger" style="font-size:11px;padding:.3rem .65rem" data-del="${a.id}">✕ Usuń</button>
      </div>
    </div>`
}

function renderLlamaCard(p) {
  const encoded = encodeURIComponent(JSON.stringify(p))
  return `
    <div class="airdrop-card">
      <div class="airdrop-card-header">
        <div style="display:flex;align-items:center;gap:.6rem;flex:1;min-width:0">
          ${p.logo ? '<img src="' + p.logo + '" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display=\'none\'">' : '<div style="width:24px;height:24px;border-radius:50%;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0">✦</div>'}
          <div style="min-width:0">
            <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</div>
            <div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">${p.chain} · ${p.category || 'DeFi'}</div>
          </div>
        </div>
        <div style="font-family:var(--font-mono);font-size:12px;color:var(--accent);font-weight:700;flex-shrink:0">${fmtTVL(p.tvl)}</div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin:.3rem 0">Brak tokena → potencjalny airdrop</div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.4rem">
        <button class="btn btn-secondary" style="font-size:11px;padding:.25rem .6rem" data-gen="${encoded}">⚡ Generuj wątek</button>
        ${p.url ? '<a href="' + p.url + '" target="_blank" rel="noopener" class="btn btn-ghost" style="font-size:11px;padding:.25rem .6rem">🔗 Strona</a>' : ''}
      </div>
    </div>`
}

async function generateAirdropThread(airdrop) {
  const outputEl = document.getElementById('airdropThreadOutput')
  if (!outputEl) return
  outputEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
  outputEl.innerHTML = '<div style="display:flex;align-items:center;gap:.75rem;padding:1.5rem;color:var(--text-muted)"><span class="spinner"></span> AI generuje wątek o ' + airdrop.name + '...</div>'

  const prompt = `Stwórz wątek na X (Twitter) po polsku składający się z dokładnie 7 tweetów o airdropie/projekcie krypto.

DANE O PROJEKCIE:
- Nazwa: ${airdrop.name}
- Sieć/Chain: ${airdrop.chain || '?'}
- Status: ${airdrop.status || 'aktywny'}
- Kategoria: ${airdrop.category || 'DeFi'}
${airdrop.tvl ? '- TVL: ' + fmtTVL(airdrop.tvl) : ''}
${airdrop.actions ? '- Co trzeba zrobić: ' + airdrop.actions : ''}
${airdrop.url ? '- Link: ' + airdrop.url : ''}

STRUKTURA (7 tweetów):
1. Hook — co to i dlaczego warto
2. Czym jest ${airdrop.name} — opis w prostych słowach
3. Dlaczego może być wartościowy airdrop
4. Krok po kroku — co zrobić żeby się zakwalifikować
5. Szczegóły techniczne działań
6. Ryzyka i DYOR — to nie jest porada finansowa
7. CTA — obserwuj po więcej takich info

ZASADY:
- Pisz po polsku
- Max 280 znaków na tweet
- Każdy tweet oddziel linią zawierającą TYLKO: ---
- Zwróć TYLKO tweety oddzielone ---, zero wstępu`

  try {
    const result = await callAI(prompt, 'Jesteś ekspertem od krypto airdrops. Tworzysz edukacyjne wątki po polsku. Zawsze zaznaczasz DYOR i brak gwarancji airdropu.')
    const tweets = result.split(/\n---\n|---\n|\n---/).map(t => t.trim()).filter(t => t.length > 5).slice(0, 10)
    if (!tweets.length) throw new Error('AI zwróciło pustą odpowiedź — spróbuj ponownie')

    outputEl.innerHTML = '<div class="ai-response-header" style="margin-bottom:.75rem">✦ Wątek: ' + airdrop.name + ' — ' + tweets.length + ' tweetów</div>' +
      tweets.map((t, i) => `
        <div class="tweet-card" style="margin-bottom:.5rem">
          <div class="tweet-num">TWEET ${i + 1} / ${tweets.length}</div>
          <textarea id="atw-${i}" rows="3"
            style="width:100%;background:var(--bg-input);border:1px solid var(--border-dim);border-radius:var(--radius-sm);color:var(--text);font-size:13px;padding:.5rem;resize:vertical;outline:none;font-family:var(--font-main);line-height:1.5;transition:border-color .2s,box-shadow .2s"
          >${t}</textarea>
          <div class="char-count ${t.length > 280 ? 'over' : t.length > 250 ? 'warn' : 'ok'}" id="atc-${i}">${t.length} / 280</div>
        </div>`).join('') +
      '<div class="btn-row" style="margin-top:.75rem"><button class="btn btn-primary" id="btnSaveAirdropWatek">💾 Zapisz do Schedulera</button><button class="btn btn-ghost" id="btnCopyAirdropWatek">📋 Kopiuj wszystko</button></div>'

    tweets.forEach((_, i) => {
      const ta = document.getElementById('atw-' + i)
      const cc = document.getElementById('atc-' + i)
      if (!ta || !cc) return
      ta.addEventListener('input', () => {
        const len = ta.value.length
        cc.textContent = len + ' / 280'
        cc.className = 'char-count ' + (len > 280 ? 'over' : len > 250 ? 'warn' : 'ok')
      })
      ta.addEventListener('focus', () => { ta.style.borderColor = 'var(--accent)'; ta.style.boxShadow = '0 0 0 3px var(--accent-dim)' })
      ta.addEventListener('blur',  () => { ta.style.borderColor = 'var(--border-dim)'; ta.style.boxShadow = 'none' })
    })

    document.getElementById('btnCopyAirdropWatek')?.addEventListener('click', () => {
      const all = tweets.map((_, i) => document.getElementById('atw-' + i)?.value || '').join('\n\n---\n\n')
      copyToClipboard(all)
    })

    document.getElementById('btnSaveAirdropWatek')?.addEventListener('click', async () => {
      const tweetsToSave = tweets.map((_, i) => { const val = document.getElementById('atw-' + i)?.value || ''; return { text: val, charCount: val.length } })
      const btn = document.getElementById('btnSaveAirdropWatek')
      if (btn) { btn.disabled = true; btn.textContent = 'Zapisuję...' }
      try {
        await addDoc(collection(db, 'threads'), { title: 'Airdrop: ' + airdrop.name, topic: 'Airdrop ' + airdrop.name, tweets: tweetsToSave, createdAt: serverTimestamp(), scheduledAt: null, status: 'draft' })
        showToast('Zapisano do Schedulera!', 'success')
        if (btn) { btn.disabled = false; btn.textContent = '✓ Zapisano!' }
      } catch {
        showToast('Błąd zapisu do Firebase', 'error')
        if (btn) { btn.disabled = false; btn.textContent = '💾 Zapisz do Schedulera' }
      }
    })
  } catch (err) {
    outputEl.innerHTML = '<div style="color:var(--danger);font-size:13px;padding:1rem;background:rgba(255,82,82,.08);border-radius:var(--radius-sm)">⚠ ' + err.message + '</div>'
  }
}

async function loadAllAirdrops() {
  try {
    const q = query(collection(db, 'airdrops'), orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch { return [] }
}

async function saveCustomAirdrop() {
  const name    = document.getElementById('adName')?.value?.trim()
  const chain   = document.getElementById('adChain')?.value?.trim()
  const status  = document.getElementById('adStatus')?.value
  const type    = document.getElementById('adType')?.value
  const actions = document.getElementById('adActions')?.value?.trim()
  const url     = document.getElementById('adUrl')?.value?.trim()
  const notes   = document.getElementById('adNotes')?.value?.trim()
  if (!name) return showToast('Wpisz nazwę projektu', 'error')
  const btn = document.getElementById('btnSaveAirdrop')
  if (btn) { btn.disabled = true; btn.textContent = 'Zapisuję...' }
  try {
    await addDoc(collection(db, 'airdrops'), { name, chain: chain || '?', status, type, actions: actions || '', url: url || '', notes: notes || '', hot: false, createdAt: serverTimestamp() })
    showToast('Airdrop dodany!', 'success')
    ;['adName','adChain','adActions','adUrl','adNotes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '' })
    await loadAndRenderAll()
  } catch { showToast('Błąd zapisu do Firebase', 'error') }
  finally { if (btn) { btn.disabled = false; btn.textContent = '+ Dodaj do listy' } }
}

function bindCardButtons() {
  document.querySelectorAll('[data-gen]').forEach(btn => {
    const fresh = btn.cloneNode(true); btn.replaceWith(fresh)
    fresh.addEventListener('click', () => {
      try { generateAirdropThread(JSON.parse(decodeURIComponent(fresh.dataset.gen))) }
      catch (err) { showToast('Błąd odczytu danych', 'error'); console.error(err) }
    })
  })
  document.querySelectorAll('[data-del]').forEach(btn => {
    const fresh = btn.cloneNode(true); btn.replaceWith(fresh)
    fresh.addEventListener('click', async () => {
      const id = fresh.dataset.del
      if (!id || id === 'undefined') return showToast('Brak ID — nie można usunąć', 'error')
      if (!confirm('Usunąć ' + (fresh.closest('.airdrop-card')?.querySelector('[style*="font-weight:700"]')?.textContent || 'ten airdrop') + ' z listy?')) return
      try { await deleteDoc(doc(db, 'airdrops', id)); showToast('Usunięto', ''); await loadAndRenderAll() }
      catch { showToast('Błąd usuwania', 'error') }
    })
  })
}

async function loadAndRenderAll() {
  const hotSection   = document.getElementById('hotAirdrops')
  const allSection   = document.getElementById('allAirdrops')
  const llamaSection = document.getElementById('llamaAirdrops')
  if (!hotSection) return

  allSection.innerHTML   = '<div style="color:var(--text-muted);font-size:12px;display:flex;align-items:center;gap:.5rem;padding:.5rem"><span class="spinner"></span> Ładowanie...</div>'
  llamaSection.innerHTML = '<div style="color:var(--text-muted);font-size:12px;display:flex;align-items:center;gap:.5rem;padding:.5rem"><span class="spinner"></span> Pobieram z DeFiLlama...</div>'

  const [allAirdrops, llamaData] = await Promise.all([loadAllAirdrops(), fetchDeFiLlamaProtocols()])

  const hotOnes  = allAirdrops.filter(a => a.hot)
  const restOnes = allAirdrops.filter(a => !a.hot)

  hotSection.innerHTML  = hotOnes.length  ? hotOnes.map(renderAirdropCard).join('')  : '<div style="color:var(--text-muted);font-size:12px;padding:.5rem">Brak HOT airdropów</div>'
  allSection.innerHTML  = restOnes.length ? restOnes.map(renderAirdropCard).join('') : '<div style="color:var(--text-muted);font-size:13px;padding:.75rem">Dodaj własne airdropy formularzem →</div>'
  llamaSection.innerHTML = llamaData.length ? llamaData.map(renderLlamaCard).join('') : '<div style="color:var(--text-muted);font-size:12px;padding:.75rem">Nie udało się załadować — sprawdź połączenie</div>'

  bindCardButtons()
}

export function renderAirdrop() {
  if (!document.getElementById('airdropStyles')) {
    const style = document.createElement('style')
    style.id = 'airdropStyles'
    style.textContent = '.airdrop-card{background:var(--bg-darker);border:1px solid var(--border-dim);border-radius:var(--radius);padding:.85rem;transition:border-color .2s}.airdrop-card:hover{border-color:var(--border)}.airdrop-card-header{display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem;margin-bottom:.4rem}'
    document.head.appendChild(style)
  }

  const panel = document.getElementById('tab-airdrop')
  panel.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-title">Airdrop Radar</div>
        <div class="section-sub">Śledź airdropy i generuj wątki step by step</div>
      </div>
      <button class="btn btn-ghost" id="btnRefreshAirdrops">↻ Odśwież</button>
    </div>
    <div class="two-col" style="align-items:start;gap:1.25rem">
      <div>
        <div class="card" style="margin-bottom:1rem">
          <div class="card-title">🔥 HOT — Najpopularniejsze teraz</div>
          <div id="hotAirdrops" style="display:grid;gap:.6rem"><div style="color:var(--text-muted);font-size:12px"><span class="spinner"></span></div></div>
        </div>
        <div class="card" style="margin-bottom:1rem">
          <div class="card-title">📋 Wszystkie Twoje airdropy</div>
          <div id="allAirdrops" style="display:grid;gap:.5rem"></div>
        </div>
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem">
            <div class="card-title" style="margin:0">📊 DeFiLlama — Bez tokena</div>
            <a href="https://defillama.com/airdrops" target="_blank" class="btn btn-ghost" style="font-size:11px;padding:.2rem .5rem">↗</a>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:.6rem">Duże TVL + brak tokena = klasyczny kandydat na airdrop</div>
          <div id="llamaAirdrops" style="display:grid;gap:.5rem"></div>
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:1rem">
          <div class="card-title">⚡ Wygenerowany wątek</div>
          <div id="airdropThreadOutput">
            <div class="empty-state" style="padding:2rem 1rem">
              <div class="empty-state-icon">✦</div>
              <div class="empty-state-text">Kliknij "Generuj wątek" przy dowolnym airdropie po lewej</div>
            </div>
          </div>
        </div>
        <div class="card" style="margin-bottom:1rem">
          <div class="card-title">+ Dodaj własny airdrop</div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:.85rem">Znalazłeś coś na airdrops.io lub watchoor.xyz? Dodaj ręcznie.</div>
          <div class="field"><label for="adName">Nazwa projektu *</label><input type="text" id="adName" placeholder="np. LayerZero, Monad..." /></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
            <div class="field" style="margin:0"><label for="adChain">Chain / Sieć</label><input type="text" id="adChain" placeholder="np. Ethereum, Solana" /></div>
            <div class="field" style="margin:0"><label for="adStatus">Status</label><select id="adStatus"><option value="ongoing">🟢 Aktywny</option><option value="testnet">🟡 Testnet</option><option value="potential">🔵 Potencjalny</option></select></div>
          </div>
          <div class="field" style="margin-top:.75rem"><label for="adType">Typ airdropu</label><select id="adType"><option value="potential">Potential</option><option value="confirmed">Confirmed</option><option value="mainnet">Mainnet</option></select></div>
          <div class="field"><label for="adActions">Co trzeba zrobić</label><textarea id="adActions" rows="2" placeholder="np. Bridge ETH, swap na DEX..."></textarea></div>
          <div class="field"><label for="adUrl">Link</label><input type="url" id="adUrl" placeholder="https://airdrops.io/..." /></div>
          <div class="field"><label for="adNotes">Notatki własne</label><textarea id="adNotes" rows="2" placeholder="Twoje obserwacje, postęp farmienia..."></textarea></div>
          <button class="btn btn-primary" id="btnSaveAirdrop" style="width:100%">+ Dodaj do listy</button>
        </div>
        <div class="card">
          <div class="card-title">🔗 Źródła</div>
          <div style="display:flex;flex-direction:column;gap:.35rem">
            ${[['airdrops.io/hot','https://airdrops.io/hot/'],['airdrops.io/latest','https://airdrops.io/latest/'],['airdrops.io/speculative','https://airdrops.io/speculative/'],['watchoor.xyz/guides','https://watchoor.xyz/guides'],['defillama.com/airdrops','https://defillama.com/airdrops'],['earndrop.io','https://earndrop.io']].map(([l,u]) => '<a href="'+u+'" target="_blank" rel="noopener" class="btn btn-ghost" style="font-size:12px;padding:.3rem .75rem;justify-content:space-between"><span>'+l+'</span><span>↗</span></a>').join('')}
          </div>
        </div>
      </div>
    </div>`

  document.getElementById('btnRefreshAirdrops')?.addEventListener('click', loadAndRenderAll)
  document.getElementById('btnSaveAirdrop')?.addEventListener('click', saveCustomAirdrop)
  seedIfEmpty().then(() => loadAndRenderAll())
}
