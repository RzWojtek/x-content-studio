// ──────────────────────────────────────────────────────────────
// AI Fallback Chain: Groq → Cerebras → SambaNova → OpenRouter
//
// Logika przeskoku do następnego providera:
//  - 429 (rate limit)  → przeskocz, następny provider
//  - brak klucza       → przeskocz cicho, następny provider
//  - 401/403 (zły klucz) → przeskocz z ostrzeżeniem w konsoli
//  - inny błąd sieciowy  → przeskocz, następny provider
// ──────────────────────────────────────────────────────────────

const setAIStatus = (state, label) => {
  const dot = document.getElementById('aiDot')
  const lbl = document.getElementById('aiLabel')
  if (dot) dot.className = `ai-dot ${state}`
  if (lbl) lbl.textContent = label
}

async function callGroq(prompt, systemPrompt) {
  const key = import.meta.env.VITE_GROQ_API_KEY
  if (!key) throw { noKey: true }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 4096
    })
  })
  if (res.status === 429) throw { is429: true }
  if (res.status === 401 || res.status === 403) throw { authError: true, provider: 'Groq' }
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

async function callCerebras(prompt, systemPrompt) {
  const key = import.meta.env.VITE_CEREBRAS_API_KEY
  if (!key) throw { noKey: true }

  const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 4096
    })
  })
  if (res.status === 429) throw { is429: true }
  if (res.status === 401 || res.status === 403) throw { authError: true, provider: 'Cerebras' }
  if (!res.ok) throw new Error(`Cerebras HTTP ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

async function callSambaNova(prompt, systemPrompt) {
  const key = import.meta.env.VITE_SAMBANOVA_API_KEY
  if (!key) throw { noKey: true }

  const res = await fetch('https://api.sambanova.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: 'Meta-Llama-3.3-70B-Instruct',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 4096
    })
  })
  if (res.status === 429) throw { is429: true }
  if (res.status === 401 || res.status === 403) throw { authError: true, provider: 'SambaNova' }
  if (!res.ok) throw new Error(`SambaNova HTTP ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

async function callOpenRouter(prompt, systemPrompt) {
  const key = import.meta.env.VITE_OPENROUTER_API_KEY
  if (!key) throw { noKey: true }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'X Content Studio'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 4096
    })
  })
  if (res.status === 429) throw { is429: true }
  if (res.status === 401 || res.status === 403) throw { authError: true, provider: 'OpenRouter' }
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

// ── Główna funkcja ──────────────────────────────────────────
export async function callAI(prompt, systemPrompt = null) {
  const providers = [
    { name: 'Groq',       fn: callGroq },
    { name: 'Cerebras',   fn: callCerebras },
    { name: 'SambaNova',  fn: callSambaNova },
    { name: 'OpenRouter', fn: callOpenRouter }
  ]

  setAIStatus('busy', 'AI myśli...')

  for (let i = 0; i < providers.length; i++) {
    const { name, fn } = providers[i]
    try {
      setAIStatus('busy', `${name}...`)
      const result = await fn(prompt, systemPrompt)
      setAIStatus('', `${name} ✓`)
      setTimeout(() => setAIStatus('', 'AI ready'), 3000)
      return result

    } catch (err) {
      const isLast = i === providers.length - 1

      if (err.noKey) {
        // Brak klucza — przeskocz cicho
        console.info(`[AI] ${name} → brak klucza, pomijam`)
      } else if (err.is429) {
        // Limit requestów — przeskocz
        console.warn(`[AI] ${name} → 429 rate limit, przeskakuję`)
      } else if (err.authError) {
        // Zły klucz — przeskocz z ostrzeżeniem
        console.warn(`[AI] ${name} → błąd autoryzacji (401/403) — sprawdź klucz VITE_${name.toUpperCase().replace('SAMBANOVA','SAMBANOVA')}_API_KEY w Vercel`)
      } else {
        // Inny błąd sieciowy — przeskocz
        console.warn(`[AI] ${name} → błąd: ${err.message}`)
      }

      if (isLast) {
        setAIStatus('error', 'Brak AI')
        throw new Error('Żaden model AI nie odpowiedział. Sprawdź klucze API w ustawieniach Vercel.')
      }
      // kontynuuj do następnego providera
    }
  }
}
