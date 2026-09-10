import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '안성초 5·6학년 동아리 신청',
  icons: { icon: '/favicon.svg' },
  description: '학생별 신청 코드로 동아리를 신청하고 내 신청을 확인하세요.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        {children}
      </body>
    </html>
  );
}
