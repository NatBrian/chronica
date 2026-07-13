# Deploying Chronica

Chronica is a **static bundle** : no server, no database, no headers required
(no SharedArrayBuffer). Any static host works.

```bash
npm run build          # → dist/
```

Then any ONE of:

```bash
# Cloudflare Pages
npx wrangler pages deploy dist --project-name chronica

# Vercel
npx vercel deploy dist --prod

# Netlify
npx netlify deploy --dir dist --prod

# GitHub Pages : push dist/ to a gh-pages branch
# (vite.config.ts already uses relative base './')

# Or literally any web server
python3 -m http.server -d dist 8080
```

Post-deploy verification checklist (all verified locally against `vite preview`):
- [x] cold load < 5s (measured 28ms local; bundle ~84 KB gzipped total)
- [x] LLM-less mode fully playable (kings rule by instinct; template chronicle)
- [x] ollama detection + one-line setup hint on landing
- [x] BYO-key flow (landing link; key in localStorage only)
- [x] journal export/import round-trips bit-identically (hash-verified)

Note: visitors' browsers reach THEIR OWN `localhost:11434` for ollama : the
host serves only files. Nothing to configure server-side.
