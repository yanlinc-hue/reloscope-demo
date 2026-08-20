import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Terms of Use | Reloscope",
  description: "Terms for the Reloscope relationship intelligence preview.",
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="PRODUCT / RESPONSIBLE USE"
      title="Terms of Use"
      summary="Reloscope is an evidence-navigation aid. It does not replace professional judgment or source verification."
      updated="August 20, 2026"
      sections={[
        {
          title: "Preview service",
          body: <p>Reloscope currently provides an experimental, read-only relationship visualization. The deployed preview uses synthetic data; a developer build may also render bounded structured graph data supplied through a tool call. Features may change as the product moves toward production readiness.</p>,
        },
        {
          title: "Permitted use",
          body: <p>You may use Reloscope to explore authorized business data and evaluate relationship evidence. You must have the right to provide any data you submit and must comply with applicable law and contractual restrictions. Do not provide confidential, regulated, or sensitive personal data to the unauthenticated developer preview.</p>,
        },
        {
          title: "Prohibited use",
          body: <p>Do not use Reloscope to create public dossiers about private individuals, infer sensitive personal traits, automate high-impact decisions, conduct unlawful surveillance, or present model-generated suggestions as verified facts.</p>,
        },
        {
          title: "Evidence and decisions",
          body: <p>Graph relationships, confidence indicators, and generated explanations may be incomplete or incorrect. Review the underlying evidence and use qualified human judgment before publishing findings or making a consequential decision.</p>,
        },
        {
          title: "Availability",
          body: <p>The preview is provided as available, without a guarantee of uninterrupted service. To the maximum extent allowed by law, Reloscope is not liable for decisions made solely from an automated result or visualization.</p>,
        },
        {
          title: "Changes and contact",
          body: <p>We may update these terms as the product changes. Continued use after an update means you accept the revised terms. Questions can be submitted through the <Link href="/support">support page</Link>.</p>,
        },
      ]}
    />
  );
}
