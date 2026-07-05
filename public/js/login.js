if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

// Si ja hi ha sessió, cap al panell
fetch('/api/auth/me')
  .then((r) => { if (r.ok) window.location.href = '/'; })
  .catch(() => {});

const form = document.getElementById('login-form');
const errorEl = document.getElementById('login-error');
const btn = document.getElementById('login-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Entrant…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Error d\'accés');
    }
    window.location.href = '/';
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Entra';
  }
});
