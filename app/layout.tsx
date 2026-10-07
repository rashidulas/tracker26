import type { Metadata, Viewport } from "next";
import { DM_Sans, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";
import { ToastProvider } from "@/components/ToastProvider";
import GlobalAssistant from "@/components/assistant/GlobalAssistant";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-display",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Tracker26 — Personal Finance",
  description: "Manage your finances, budgets, and goals",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${instrumentSans.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-sans antialiased text-ink bg-graphite" suppressHydrationWarning>
        <ToastProvider>
          <div className="flex min-h-screen">
            <Navigation />
            <main className="flex-1 lg:ml-64 pt-[calc(3rem+env(safe-area-inset-top))] lg:pt-0 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-0 w-full max-w-full overflow-x-hidden min-h-screen">
              {children}
            </main>
            <GlobalAssistant />
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
