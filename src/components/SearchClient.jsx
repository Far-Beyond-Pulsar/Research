'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

function score(query, doc) {
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  const title = (doc.title || '').toLowerCase();
  const desc = (doc.description || '').toLowerCase();
  const tags = (doc.tags || []).join(' ').toLowerCase();
  const body = (doc.content || '').toLowerCase();

  let total = 0;
  if (title.includes(q)) total += 8;
  if (desc.includes(q)) total += 5;
  if (tags.includes(q)) total += 3;
  if (body.includes(q)) total += 2;

  return total;
}

export default function SearchClient() {
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    const basePath = process.env.NEXT_PUBLIC_CUSTOM_BASE_PATH || '';
    fetch(`${basePath}/search-index.json`)
      .then((res) => res.json())
      .then((data) => setDocs(data.docs || []))
      .catch(() => setDocs([]));
  }, []);

  const results = useMemo(() => {
    if (!query.trim()) {
      return docs.slice(0, 24);
    }

    return docs
      .map((doc) => ({ doc, rank: score(query, doc) }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 40)
      .map((entry) => entry.doc);
  }, [docs, query]);

  return (
    <section>
      <div className="hero">
        <h1>Search</h1>
        <p>Full-text lookup across published and draft research documents.</p>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <input
          className="search-box"
          type="search"
          placeholder="Try: hierarchical light-field, SceneDB, occlusion..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div style={{ marginTop: '0.8rem' }} className="meta">
        {results.length} result{results.length === 1 ? '' : 's'}
      </div>

      <section className="section-shell" style={{ marginTop: '10px' }}>
      <div>
        {results.map((doc) => (
          <Link
            key={`${doc.section}-${doc.slug}`}
            href={`/doc?section=${encodeURIComponent(doc.section)}&slug=${encodeURIComponent(doc.slug)}`}
            className="search-result"
          >
            <h3>{doc.title}</h3>
            <p>{doc.description}</p>
            <div className="meta">{doc.section} • {doc.dateLabel}</div>
          </Link>
        ))}
      </div>
      </section>
    </section>
  );
}
