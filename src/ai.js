// ──────────────────────────────────────────────────────────────
// AI Fallback Chain: Groq → Cerebras → SambaNova → OpenRouter
// Każda funkcja provider zwraca { text } lub rzuca błąd 429
// callAI(prompt, systemPrompt?) → string
// ──────────────────────────────────────────────────────────────

const setAIStatus = (state, label) => {
  const dot = document.getElementById('aiDot')
  const lbl = document.getElementById('aiLabel')
  if (dot) dot.className = `ai-dot ${state}`
  if (lbl) lbl.textContent = label
}

async function callGroq(prompt, systemPrompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_GROQ_API_KEY}`
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
  if (!res.ok) throw new Error(`Groq error: ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

async function callCerebras(prompt, systemPrompt) {
  const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_CEREBRAS_API_KEY}`
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
  if (!res.ok) throw new Error(`Cerebras error: ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

async function callSambaNova(prompt, systemPrompt) {
  const res = await fetch('https://api.sambanova.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SAMBANOVA_API_KEY}`
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
  if (!res.ok) throw new Error(`SambaNova error: ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

async function callOpenRouter(prompt, systemPrompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_OPENROUTER_API_KEY}`,
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
  if (!res.ok) throw new Error(`OpenRouter error: ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

// ── Główna funkcja ──────────────────────────────────────────
export async function callAI(prompt, systemPrompt = null) {
  const providers = [
    { name: 'Groq', fn: callGroq },
    { name: 'Cerebras', fn: callCerebras },
    { name: 'SambaNova', fn: callSambaNova },
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
      if (err.is429 || err.message?.includes('429')) {
        console.warn(`[AI] ${name} → 429, próbuję następny...`)
        if (i === providers.length - 1) {
          setAIStatus('error', 'Limit API')
          throw new Error('Wszystkie modele AI osiągnęły limit. Spróbuj za chwilę.')
        }
        continue
      }
      // Inny błąd — też próbuj dalej
      console.warn(`[AI] ${name} → błąd: ${err.message}, próbuję następny...`)
      if (i === providers.length - 1) {
        setAIStatus('error', 'Błąd AI')
        throw new Error('Błąd połączenia z AI. Sprawdź klucze API.')
      }
    }
  }
}
