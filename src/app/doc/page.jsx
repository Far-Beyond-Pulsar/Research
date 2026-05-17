import { Suspense } from 'react';
import DocViewerClient from '@/components/DocViewerClient';

export const metadata = {
  title: 'Research Reader',
};

export default function DocPage() {
  return (
    <Suspense fallback={<section className="doc-shell"><h1>Loading...</h1></section>}>
      <DocViewerClient />
    </Suspense>
  );
}
