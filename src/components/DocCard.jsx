import Link from 'next/link';

export default function DocCard({ doc }) {
  const href = `/doc?section=${encodeURIComponent(doc.section)}&slug=${encodeURIComponent(doc.slug)}`;

  return (
    <Link href={href} className="card">
      <span className="badge">{doc.section === 'drafts' ? 'Draft' : 'Published'}</span>
      <h3>{doc.title}</h3>
      <p>{doc.description}</p>
      <div className="meta">{doc.dateLabel} • {doc.section}</div>
    </Link>
  );
}
