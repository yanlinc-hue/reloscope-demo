import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Support | Reloscope",
  description: "Get help with the Reloscope Plugin and visual workspace.",
};

export default function SupportPage() {
  return (
    <LegalPage
      eyebrow="HELP / PRODUCT SUPPORT"
      title="Reloscope Support"
      summary="Tell us what you were trying to explore, which tool or view failed, and whether the issue can be reproduced with synthetic data."
      updated="August 20, 2026"
      sections={[
        {
          title: "Report an issue",
          body: <p>Open a report in the <a href="https://github.com/yanlinc-hue/reloscope-demo/issues">Reloscope GitHub issue tracker</a>. Do not include confidential source documents, access tokens, personal data, or private graph exports.</p>,
        },
        {
          title: "Include",
          body: <ul><li>The prompt or action you attempted.</li><li>The visible error message.</li><li>Your browser and approximate time of the issue.</li><li>Whether the problem occurs in inline and fullscreen views.</li></ul>,
        },
        {
          title: "Safety or privacy",
          body: <p>Mark security and privacy concerns clearly. For sensitive reports, request a private contact channel without posting the underlying data publicly.</p>,
        },
        {
          title: "Current limits",
          body: <p>The deployed public preview is synthetic and read-only. The next developer build adds stateless conversation-supplied graphs, but still does not support customer authentication, durable workspaces, uploads, or relationship mutation.</p>,
        },
      ]}
    />
  );
}
