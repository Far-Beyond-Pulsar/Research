import './globals.css';
import { JetBrains_Mono, Inter } from 'next/font/google';
import Link from 'next/link';
import AccessibilityMenu from '@/components/AccessibilityMenu';

const uiFont = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-ui',
  weight: ['400', '500', '600', '700'],
});

const proseFont = Inter({
  subsets: ['latin'],
  variable: '--font-prose',
  weight: ['400', '500', '600', '700'],
});

export const metadata = {
  title: 'Pulsar Research Atlas',
  description: 'Index and search site for Pulsar engine research projects.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${uiFont.variable} ${proseFont.variable}`}>
      <body>
        <div className="aurora" aria-hidden="true" />
        <header className="site-header">
          <div className="brand-wrap">
            <Link href="/" className="brand">Pulsar</Link>
            <span className="brand-divider">/</span>
            <span className="brand-sub">Research Portal</span>
          </div>
          <nav className="nav-links">
            <Link href="/published">Published</Link>
            <Link href="/drafts">Drafts</Link>
            <Link href="/search">Search</Link>
          </nav>
        </header>
        <main className="page-wrap">{children}</main>
        <AccessibilityMenu />
      </body>
    </html>
  );
}
