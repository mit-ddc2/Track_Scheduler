import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Calabogie Safety — Crew Rescue Staffing",
  description:
    "Single-user staffing dashboard for Calabogie Motorsports Park's emergency rescue team.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="pit-wall"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="cs-host min-h-screen antialiased">{children}</body>
    </html>
  );
}
