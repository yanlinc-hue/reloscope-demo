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
  title: "关系洞察 Studio｜Visual Intelligence",
  description: "将文档、表格与数据源转化为可核验、可分析、可交付的高端关系可视化。",
  openGraph: {
    title: "关系洞察 Studio",
    description: "每条关系，都能回到证据。",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "关系洞察 Studio 演示封面" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "关系洞察 Studio",
    description: "每条关系，都能回到证据。",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
