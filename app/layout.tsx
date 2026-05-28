/**
 * Nexus AI — Root Layout
 *
 * @author Harman Hanjra <https://github.com/harmanhanjra>
 * @license MIT
 */

import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Nexus AI — Agent OS by Harman Hanjra',
  description: 'Your Mind, Multiplied. Multi-agent AI workspace powered by Gemini. Built by Harman Hanjra.',
  authors: [{ name: 'Harman Hanjra', url: 'https://github.com/harmanhanjra' }],
  creator: 'Harman Hanjra',
  openGraph: {
    title: 'Nexus AI — Next-Gen AI Agent Operating System',
    description: 'A unified AI operating system where humans and autonomous AI agents work side-by-side.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
