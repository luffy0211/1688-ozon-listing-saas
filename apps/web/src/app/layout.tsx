import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "1688 到 Ozon 上架后台",
  description: "1688 商品采集、Ozon 草稿生成和发布确认后台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
