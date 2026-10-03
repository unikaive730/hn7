import { useEffect, useState } from 'react';
import { APP_NAME, API_PREFIX } from '@hn7/shared';

export default function App() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch(`${API_PREFIX}/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  return (
    <main className="shell">
      <h1>{APP_NAME}</h1>
      <p>API: {health === null ? 'checking' : health.ok ? 'connected' : 'not reachable'}</p>
    </main>
  );
}
