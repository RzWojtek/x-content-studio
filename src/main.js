import './style.css'
import { renderComposer } from './tabs/composer.js'
import { renderScheduler } from './tabs/scheduler.js'
import { renderAnalytics } from './tabs/analytics.js'
import { renderAirdrop } from './tabs/airdrop.js'

// ── Router zakładek ──────────────────────────────────────────
const tabRenderers = {
  composer: renderComposer,
  scheduler: renderScheduler,
  analytics: renderAnalytics,
  airdrop: renderAirdrop
}

const rendered = new Set()

function switchTab(tabName) {
  // Ukryj wszystkie panele
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))

  // Pokaż wybrany
  const panel = document.getElementById(`tab-${tabName}`)
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`)
  if (panel) panel.classList.add('active')
  if (btn) btn.classList.add('active')

  // Renderuj jeśli nie był jeszcze renderowany
  if (!rendered.has(tabName) && tabRenderers[tabName]) {
    tabRenderers[tabName]()
    rendered.add(tabName)
  }

  // Zapisz aktywną zakładkę
  sessionStorage.setItem('activeTab', tabName)
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Bind przycisków nawigacji
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  })

  // Przywróć ostatnią zakładkę lub zacznij od Composera
  const lastTab = sessionStorage.getItem('activeTab') || 'composer'
  switchTab(lastTab)
})
