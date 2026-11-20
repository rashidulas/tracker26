import type { Metadata, Viewport } from "next";
import { DM_Sans, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";
import { ToastProvider } from "@/components/ToastProvider";
import { QuickAddProvider } from "@/components/quickadd/QuickAddProvider";
import { MerchantRuleProvider } from "@/components/merchants/MerchantRulePrompt";
import DueCheck from "@/components/recurring/DueCheck";
import ReminderCheck from "@/components/reminders/ReminderCheck";
import InsightsCheck from "@/components/insights/InsightsCheck";
import { AskAssistantProvider } from "@/components/assistant/AskAssistant";
import { getSessionState } from "@/lib/auth/session";

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
  appleWebApp: { capable: true, title: "Tracker26", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0b0d",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSessionState();
  const fontClasses = `${dmSans.variable} ${instrumentSans.variable} ${jetbrainsMono.variable}`;

  // Signed out (the login page) or login not configured: the page alone,
  // without the navigation and the providers that load data.
  if (session.status !== "ok" && session.status !== "open") {
    return (
      <html lang="en" className={fontClasses}>
        <body className="font-sans antialiased text-ink bg-graphite" suppressHydrationWarning>
          {children}
        </body>
      </html>
    );
  }

  return (
    <html lang="en" className={fontClasses}>
      <body className="font-sans antialiased text-ink bg-graphite" suppressHydrationWarning>
        <ToastProvider>
          <MerchantRuleProvider>
            <QuickAddProvider>
              <AskAssistantProvider>
              <DueCheck />
              <InsightsCheck />
              <ReminderCheck />
              <div className="flex min-h-screen">
                <Navigation />
                <main id="main-content" tabIndex={-1} className="focus:outline-none flex-1 lg:ml-64 pt-[calc(3rem+env(safe-area-inset-top))] lg:pt-0 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-24 w-full max-w-full overflow-x-clip min-h-screen">
                  {session.status === "open" && (
                    <div
                      role="alert"
                      className="mx-4 mt-4 lg:mx-8 rounded-xl border border-warning/30 bg-warning-dim px-4 py-3 text-sm text-warning"
                    >
                      <strong className="font-semibold">Login is off.</strong> Anyone who can reach this
                      address can open the app. Missing: {session.missing.join(", ")}. Run{" "}
                      <code className="font-mono">npm run auth:hash</code> and add the values to{" "}
                      <code className="font-mono">.env.local</code>. A production build refuses to
                      serve until they are set.
                    </div>
                  )}
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
