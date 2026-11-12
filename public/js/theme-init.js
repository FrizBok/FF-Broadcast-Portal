// Gespeichertes Design sofort setzen (vor dem ersten Zeichnen, damit es nicht flackert)
try { document.documentElement.dataset.theme = localStorage.getItem('ffp.theme') || 'dark'; } catch { /* */ }
