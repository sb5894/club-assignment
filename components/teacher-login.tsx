'use client';

import { useState, type SyntheticEvent } from 'react';
import Link from 'next/link';
import { LayoutGrid, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function TeacherLogin() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/teacher', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        let serverError: unknown;
        try { serverError = (await response.json() as { error?: unknown }).error; }
        catch { /* A non-JSON response still gets a readable login message. */ }
        setError(response.status === 429
          ? typeof serverError === 'string' && serverError.trim() ? serverError : '로그인 시도가 너무 많아요. 잠시 기다린 뒤 다시 시도해 주세요.'
          : '로그인하지 못했어요. 비밀번호를 확인하고 다시 시도해 주세요.');
        setPassword('');
        return;
      }
      setPassword('');
      window.location.assign('/teacher');
    } catch {
      setError('서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="portal-login">
    <Link className="brand" href="/"><span className="brand-mark"><LayoutGrid size={23}/></span><span>안성초 5·6학년 동아리 신청<small>신청과 배정</small></span></Link>
    <form className="panel application-form" onSubmit={submit}>
      <span className="eyebrow">선생님 전용</span>
      <h1>선생님 로그인</h1>
      <p>학생 신청 현황과 배정 업무를 관리해요.</p>
      <label className="field-label">관리 비밀번호<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy}/></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button className="primary submit-button" type="submit" disabled={busy || !password}><LockKeyhole size={17}/>{busy ? '로그인 중…' : '로그인'}</Button>
      <p className="form-foot"><Link href="/">학생 신청 화면으로 돌아가기</Link></p>
    </form>
  </main>;
}
