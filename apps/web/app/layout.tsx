import type { Metadata } from "next";
import { SessionSidebar } from "@/components/SessionSidebar";
import { NoticeBanner } from "@/components/NoticeBanner";
import { WaggleProvider } from "@/lib/WaggleProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "honeybee-waggle",
};

// 사이드바를 레이아웃에 둬서 세션 사이를 오가도 목록과 WS 연결이 다시 만들어지지 않게 한다.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="h-dvh overflow-hidden">
        <WaggleProvider>
          <div className="flex h-full">
            <SessionSidebar />
            <main className="relative flex min-w-0 flex-1 flex-col">
              <NoticeBanner />
              {children}
            </main>
          </div>
        </WaggleProvider>
      </body>
    </html>
  );
}
