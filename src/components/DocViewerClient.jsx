'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Markdown from '@/components/Markdown';
import TableOfContents from '@/components/TableOfContents';

export default function DocViewerClient() {
  const params = useSearchParams();
  const section = params.get('section') || '';
  const slug = params.get('slug') || '';

  const [docs, setDocs] = useState([]);

  useEffect(() => {
    const basePath = process.env.NEXT_PUBLIC_CUSTOM_BASE_PATH || '';
    fetch(`${basePath}/content-index.json`)
      .then((res) => res.json())
      .then((data) => setDocs(data.docs || []))
      .catch(() => setDocs([]));
  }, []);

  const doc = useMemo(() => {
    return docs.find((item) => item.section === section && item.slug === slug) || null;
  }, [docs, section, slug]);

  if (!section || !slug) {
    return (
      <section className="doc-shell">
        <h1>No document selected</h1>
        <p className="meta">Open a document from Published, Drafts, or Search.</p>
      </section>
    );
  }

  if (!doc) {
    return (
      <section className="doc-shell">
        <h1>Loading document...</h1>
        <p className="meta">If this message persists, the document may be missing from the static index.</p>
      </section>
    );
  }

  return (
    <>
      <TableOfContents markdown={doc.markdown} />
      <article className="doc-shell">
        <div className="doc-head">
          <span className="badge">{doc.section === 'drafts' ? 'Draft' : 'Published'}</span>
          <h1>{doc.title}</h1>
          <p className="meta">{doc.dateLabel}</p>
          <p className="doc-summary">{doc.description}</p>
          <div className="doc-actions">
            <Link href={`/${doc.section}`}>Back to {doc.section === 'drafts' ? 'Drafts' : 'Published'}</Link>
            <Link href="/search">Search</Link>
          </div>
        </div>
        <div className="doc-prose">
          <Markdown content={doc.markdown} />
        </div>
      </article>
    </>
  );
}
