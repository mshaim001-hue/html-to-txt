import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HTML to TXT — конвертер экспортов Telegram",
  description: "Конвертация HTML-экспортов чатов Telegram в удобный текст",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-stone-950 text-stone-100 antialiased">
        {children}
      </body>
    </html>
  );
}
