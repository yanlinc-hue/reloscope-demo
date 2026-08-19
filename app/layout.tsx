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
  title: "关系洞察 Agent｜对话驱动的关系分析",
  description: "左侧对话，右侧建图：调查关系、回到证据、预览修改，并生成可复用的分析镜头。",
  openGraph: {
    title: "关系洞察 Agent",
    description: "对话驱动的可验证关系分析。",
    type: "website",
    images: [{ url: "/og-agent.png", width: 1731, height: 909, alt: "关系洞察 Agent 双栏工作台演示封面" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "关系洞察 Agent",
    description: "对话驱动的可验证关系分析。",
    images: ["/og-agent.png"],
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
