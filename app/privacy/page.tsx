import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | Reloscope",
  description: "How Reloscope handles data in its relationship intelligence plugin.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="TRUST / DATA PRACTICES"
      title="Privacy Policy"
      summary="Reloscope is designed to inspect authorized relationship data without using it to train shared models."
      updated="August 20, 2026"
      sections={[
        {
          title: "Scope",
          body: <p>This policy covers the Reloscope website and Reloscope Plugin. The current public preview uses synthetic graph data and does not require an account.</p>,
        },
        {
          title: "Data processed",
          body: <p>When you use the plugin, Reloscope receives the tool parameters needed to search, filter, render, or explain the selected graph. We do not request your full ChatGPT conversation. The visual component may keep temporary selection, filter, camera, and layout state for the active interface.</p>,
        },
        {
          title: "Storage and training",
          body: <p>The public preview is stateless and does not retain graph edits or uploaded customer datasets. Reloscope does not use plugin inputs or interaction data to train a shared model. Service infrastructure may retain limited operational metadata needed for security, reliability, and abuse prevention.</p>,
        },
        {
          title: "Sharing",
          body: <p>We do not sell personal data. Data is shared only with infrastructure providers needed to operate the service, when required by law, or when you explicitly direct an export or external action.</p>,
        },
        {
          title: "Security and choices",
          body: <p>Reloscope limits the preview to read-only tools and synthetic data. Production customer workspaces will add authentication, access controls, retention controls, and deletion workflows before accepting private datasets.</p>,
        },
        {
          title: "Contact",
          body: <p>For privacy questions or deletion requests, use the contact options on the <Link href="/support">Reloscope support page</Link>.</p>,
        },
      ]}
    />
  );
}
