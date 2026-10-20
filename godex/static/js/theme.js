// Runs before first paint (a normal script, so no flash of the wrong theme). Dark unless you chose light.
try { const t = localStorage.getItem('dex-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) { /* private mode */ }
