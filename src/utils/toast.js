export function showToast(msg, type = '') {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.className = `toast ${type} show`
  clearTimeout(t._timer)
  t._timer = setTimeout(() => { t.className = 'toast' }, 3200)
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    showToast('Skopiowano do schowka!', 'success')
    return true
  } catch {
    showToast('Błąd kopiowania', 'error')
    return false
  }
}
