import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'ChessRiot', description: 'Async chess between friends.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><main className="shell">{children}</main></body></html>;
}
