import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Police Quiz Bot — แดชบอร์ดระบบข้อสอบตำรวจ",
  description:
    "ระบบ Telegram Bot สำหรับส่งข้อสอบอัตโนมัติเตรียมสอบนายสิบตำรวจ สายอำนวยการ ผ่าน OpenAI",
  keywords: [
    "ข้อสอบตำรวจ",
    "นายสิบตำรวจ",
    "สายอำนวยการ",
    "Telegram Quiz Bot",
    "เตรียมสอบตำรวจ",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body>
        {/* Ambient background effects */}
        <div className="bg-grid" />
        <div className="bg-gradient-orb bg-gradient-orb--top" />
        <div className="bg-gradient-orb bg-gradient-orb--bottom" />

        <div className="page-wrapper">{children}</div>
      </body>
    </html>
  );
}
