import './globals.css';

export const metadata = {
  title: 'Fundraising Copilot — CEO Syndicate',
  description: 'Turn your CEO Syndicate report into VC application answers.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
            <a href="/" className="text-lg font-bold tracking-tight">
              Fundraising <span className="text-blue-700">Copilot</span>
            </a>
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              CEO Syndicate
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
