import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '우리 동아리 | 신청과 배정',
  icons: { icon: '/favicon.svg' },
  description: '학생은 동아리를 고르고, 선생님은 배정 결과를 확인하세요. 가상 자료로 체험하는 데모입니다.',
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
