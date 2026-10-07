import type { Metadata, Viewport } from "next";
import { Anton, Archivo, Space_Mono } from "next/font/google";
import "./globals.css";

// Workwear x streetwear: heavy condensed caps, a grotesk body, data-plate mono.
const display = Anton({ variable: "--font-anton", weight: "400", subsets: ["latin"] });
const sans = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
const mono = Space_Mono({ variable: "--font-spacemono", weight: ["400", "700"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ride Along: a journeyman on call",
  description: "Make DIY fun. Turn anyone into a tradesman. Point your phone at it and Ray walks you through it.",
};

// No pinch or double-tap zoom: it's an app on a phone, held in one hand at a job.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0B0B0B",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
