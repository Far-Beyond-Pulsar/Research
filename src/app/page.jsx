import Link from 'next/link';
import { getAllDocs, getSectionDocs } from '@/lib/content';
import DocCard from '@/components/DocCard';

export default async function HomePage() {
  const [published, drafts, allDocs] = await Promise.all([
    getSectionDocs('published'),
    getSectionDocs('drafts'),
    getAllDocs(),
  ]);

  return (
    <>
      <section className="hero">
        <h1>Research Archive</h1>
        <p>
          Pulsar engine papers, architecture notes, and rendering experiments.
          Published and draft material live in one index for fast lookup.
        </p>
        <div className="hero-actions">
          <Link href="/search">Open Search</Link>
          <Link href="/published">Browse Published</Link>
        </div>
        <div className="kpis">
          <div className="kpi">
            <strong>{allDocs.length}</strong>
            <span>Total Documents</span>
          </div>
          <div className="kpi">
            <strong>{published.length}</strong>
            <span>Published</span>
          </div>
          <div className="kpi">
            <strong>{drafts.length}</strong>
            <span>Active Drafts</span>
          </div>
        </div>
      </section>

      <h2 className="section-title">Recent Drafts</h2>
      <section className="section-shell">
      <div className="grid">
        {drafts.slice(0, 6).map((doc) => (
          <DocCard key={`${doc.section}-${doc.slug}`} doc={doc} />
        ))}
      </div>
      </section>

      <h2 className="section-title">Published Research</h2>
      <section className="section-shell">
      <div className="grid">
        {published.slice(0, 6).map((doc) => (
          <DocCard key={`${doc.section}-${doc.slug}`} doc={doc} />
        ))}
      </div>
      </section>

      <div className="meta" style={{ marginTop: '1.5rem' }}>
        View all in <Link href="/published">Published</Link> or <Link href="/drafts">Drafts</Link>.
      </div>
    </>
  );
}
