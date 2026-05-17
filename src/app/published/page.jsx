import DocCard from '@/components/DocCard';
import { getSectionDocs } from '@/lib/content';

export const metadata = {
  title: 'Published Research',
};

export default async function PublishedPage() {
  const docs = await getSectionDocs('published');

  return (
    <section>
      <div className="hero">
        <h1>Published Research</h1>
        <p>Finalized documents intended as stable references.</p>
      </div>
      <h2 className="section-title">All Published Documents</h2>
      <section className="section-shell">
      <div className="grid">
        {docs.map((doc) => (
          <DocCard key={doc.slug} doc={doc} />
        ))}
      </div>
      </section>
    </section>
  );
}
