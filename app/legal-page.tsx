import type { ReactNode } from "react";
import Link from "next/link";

type LegalSection = {
  title: string;
  body: ReactNode;
};

export function LegalPage({
  eyebrow,
  title,
  summary,
  updated,
  sections,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  updated: string;
  sections: LegalSection[];
}) {
  return (
    <main className="legal-page">
      <nav aria-label="Reloscope legal navigation">
        <Link className="legal-brand" href="/">
          <span>R</span>
          <strong>RELOSCOPE</strong>
        </Link>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/support">Support</Link>
        </div>
      </nav>

      <article>
        <header>
          <p>{eyebrow}</p>
          <h1>{title}</h1>
          <strong>{summary}</strong>
          <small>Last updated {updated}</small>
        </header>

        {sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            <div>{section.body}</div>
          </section>
        ))}
      </article>
    </main>
  );
}
