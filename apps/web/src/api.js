/** Talks to the lab. Every call runs the real computation on the server. */

const BASE = import.meta.env.VITE_LAB_API ?? '';

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

export const getFacts = (cutoffYear = 2000) =>
  request(`/api/facts?cutoff_year=${cutoffYear}`);

export const runExperiment = (body) =>
  request('/api/run', { method: 'POST', body: JSON.stringify(body) });

export const getMolecule = (cid, cutoffYear = 2000) =>
  request(`/api/molecule/${cid}?cutoff_year=${cutoffYear}`);

export const searchEvidence = (query, limit = 4) =>
  request(`/api/evidence?query=${encodeURIComponent(query)}&limit=${limit}`);
