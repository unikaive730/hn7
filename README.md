# hn7 (name to be decided)

Built during the Hack-Nation 7th Global AI Hackathon (October 3-4, 2026). Challenge: _to be filled after the briefs are released_.

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Front end: Vite + React |
| `apps/api` | Back end: Node + Hono. In production it also serves the built front end |
| `packages/shared` | Code used by both sides |

## Run locally

```bash
cp .env.example .env      # keys are optional
npm install
npm run dev               # web http://localhost:5173 (proxies /api), API http://localhost:8977
npm test
```

Production: `npm run build && npm start` runs one Node process on `PORT` that serves the API and the built web app.

## License

MIT
