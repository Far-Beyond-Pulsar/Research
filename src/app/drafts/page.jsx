import DocCard from '@/components/DocCard';
import { getSectionDocs } from '@/lib/content';

export const metadata = {
  title: 'Draft Research',
};

export default async function DraftsPage() {
  const docs = await getSectionDocs('drafts');

  return (
    <section>
      <div className="hero">
        <h1>Draft Lab</h1>
        <p>Work in progress notes, proposals, and active experiments.</p>
      </div>
      <h2 className="section-title">All Draft Documents</h2>
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
