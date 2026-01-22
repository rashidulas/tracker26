import type { Metadata } from "next";
import "./globals.css";
import Navigation from "@/components/Navigation";
import { ToastProvider } from "@/components/ToastProvider";

export const metadata: Metadata = {
  title: "Tracker26 - Personal Finance Manager",
  description: "Manage your finances, budgets, investments, and goals",
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50" suppressHydrationWarning>
        <ToastProvider>
          <div className="flex min-h-screen">
            <Navigation />
            <main className="flex-1 lg:ml-64 pt-20 lg:pt-8 px-3 py-4 sm:px-6 lg:px-8 pb-8 w-full max-w-full overflow-x-hidden bg-gray-50">
              {children}
            </main>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
