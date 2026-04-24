import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CastWeave", template: "%s · CastWeave" },
  description:
    "Import video, confirm cast, attach voices, and replace lines -- in one guided workflow.",
  icons: { icon: "/castweave-icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
