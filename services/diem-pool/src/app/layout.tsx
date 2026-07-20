import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'WoCC DIEM Pool',
  description:
    'Delegate your staked-DIEM Venice compute to World of ClaudeCraft, earn Claudium.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <span className="brand">⚔️ WoCC DIEM Pool</span>
          <nav>
            <Link href="/">Provider</Link>
            <Link href="/leaderboard">Leaderboard</Link>
            <Link href="/admin">Admin</Link>
          </nav>
        </header>
        <main className="page">{children}</main>
        <footer className="footer">
          Non-custodial: you keep your DIEM, you can revoke your key anytime. Rewards settle daily
          at 00:00 UTC in Claudium.
        </footer>
      </body>
    </html>
  );
}
