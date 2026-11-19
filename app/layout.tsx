import type { Metadata, Viewport } from "next";
import { DM_Sans, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";
import { ToastProvider } from "@/components/ToastProvider";
import { QuickAddProvider } from "@/components/quickadd/QuickAddProvider";
import { MerchantRuleProvider } from "@/components/merchants/MerchantRulePrompt";
import DueCheck from "@/components/recurring/DueCheck";
import InsightsCheck from "@/components/insights/InsightsCheck";
import { AskAssistantProvider } from "@/components/assistant/AskAssistant";

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
  description: "Manage your personal finances",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
          <MerchantRuleProvider>
            <QuickAddProvider>
              <AskAssistantProvider>
              <DueCheck />
              <InsightsCheck />
              <div className="flex min-h-screen">
                <Navigation />
                <main id="main-content" tabIndex={-1} className="focus:outline-none flex-1 lg:ml-64 pt-[calc(3rem+env(safe-area-inset-top))] lg:pt-0 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-24 w-full max-w-full overflow-x-clip min-h-screen">
                  {children}
                </main>
              </div>
              </AskAssistantProvider>
            </QuickAddProvider>
          </MerchantRuleProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
