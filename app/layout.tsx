import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reloscope | Relationship Intelligence for ChatGPT",
  description: "Explore complex relationship graphs in ChatGPT and trace every claim back to evidence.",
  openGraph: {
    title: "Reloscope",
    description: "Explore relationships. Verify the evidence.",
    type: "website",
    images: [{ url: "/og-reloscope.png", width: 1731, height: 909, alt: "Reloscope evidence-backed relationship graph" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Reloscope",
    description: "Explore relationships. Verify the evidence.",
    images: ["/og-reloscope.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
