import type { Metadata } from "next";
import { ReloscopeStudio } from "../page";

export const metadata: Metadata = {
  title: "Visual Workspace | Reloscope",
  description: "Explore an evidence-backed relationship graph without a second chat interface.",
};

export default function VisualWorkspacePage() {
  return <ReloscopeStudio visualOnly />;
}
