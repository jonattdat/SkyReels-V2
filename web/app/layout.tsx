import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "SkyReels Studio · Generative Film",
  description:
    "A cinematic web studio for the SkyReels V2 & V3 video generation models — text/image/reference-to-video, video extension, and talking avatars.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  // Result videos are hosted on a bucket that blocks unknown referers; send none
  // so the browser can load them cross-origin.
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
