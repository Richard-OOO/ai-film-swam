import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Film Swarm",
  description: "Observable, human-guided agent film crew",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
