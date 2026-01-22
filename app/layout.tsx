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
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </head>
      <body className="antialiased">
        <ToastProvider>
          <div className="flex min-h-screen bg-gray-50">
            <Navigation />
            <main className="flex-1 lg:ml-64 pt-16 lg:pt-0 px-3 py-4 sm:p-6 lg:p-8 w-full max-w-full overflow-x-hidden">
              {children}
            </main>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
