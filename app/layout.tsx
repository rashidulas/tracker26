import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";
import { ToastProvider } from "@/components/ToastProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Tracker26 - Personal Finance Manager",
  description: "Manage your finances, budgets, investments, and goals",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased bg-zinc-950 text-zinc-100" suppressHydrationWarning>
        <ToastProvider>
          <div className="flex min-h-screen">
            <Navigation />
            <main className="flex-1 lg:ml-64 pt-20 lg:pt-0 w-full max-w-full overflow-x-hidden">
              {children}
            </main>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
