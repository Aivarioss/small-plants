import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gurķu stādu plānotājs",
  description: "Privātas gurķu stādu ražošanas plānošanas MVP",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="lv">
      <body>{children}</body>
    </html>
  );
}
