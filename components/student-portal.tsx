'use client';

import { useState, type SyntheticEvent } from 'react';
import { Check, GraduationCap, LayoutGrid, LogOut, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { StudentState } from '@/lib/portal-types';

const date = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '';
const phaseNames = { setup: '접수 준비 중', open: '신청 접수 중', closed: '접수 마감 · 신청 확인', allocated: '배정 검토 중', final: '배정 확정' };

export function StudentPortal({ initialState }: { initialState: StudentState | null }) {
  const [state, setState] = useState(initialState);
  const [identity, setIdentity] = useState({ grade: '5', classNo: '', number: '', code: '' });
  const [choices, setChoices] = useState<string[]>(initialState?.student.choices.length ? [...initialState.student.choices] : ['', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const student = state?.student;
  const editable = state?.phase === 'open';
  const saved = !!student?.applicationVersion;
  const verified = saved && !!student?.verifiedAt && student?.verifiedVersion === student?.applicationVersion;
  const dirty = JSON.stringify(choices) !== JSON.stringify(student?.choices.length ? student.choices : ['', '', '']);
  const clubName = (id: string) => state?.clubs.find(club => club.id === id)?.name ?? '미선택';

  function accept(next: StudentState) {
    setState(next);
    setChoices(next.student.choices.length ? [...next.student.choices] : ['', '', '']);
  }

  async function request(path: string, body?: Record<string, unknown>): Promise<StudentState> {
    const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json() as StudentState & { error?: string };
    if (!response.ok) {
      if (response.status === 401) { setState(null); setIdentity(previous => ({ ...previous, code: '' })); }
      if (response.status === 409) {
        const fresh = await fetch('/api/student/me', { cache: 'no-store', credentials: 'same-origin' });
        if (fresh.ok) accept(await fresh.json());
      }
      throw new Error(data.error ?? '잠시 후 다시 시도해 주세요.');
    }
    return data as StudentState;
  }

  async function login(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await request('/api/auth/student', { studentId: `${Number(identity.grade)}-${Number(identity.classNo)}-${Number(identity.number)}`, code: identity.code });
      accept(await request('/api/student/me'));
      setIdentity(previous => ({ ...previous, code: '' }));
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setError(''); setNotice('');
    try { accept(await request('/api/student/me')); setNotice('저장된 최신 신청을 불러왔어요.'); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  async function submit() {
    setConfirm(false); setBusy(true); setError(''); setNotice('');
    try {
      accept(await request('/api/student/application', { choices, version: student?.applicationVersion ?? 0 }));
      setNotice('신청을 저장했어요. 아래의 저장된 신청을 확인하고 “이 신청이 맞아요”를 눌러 주세요.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true); setError(''); setNotice('');
    try { accept(await request('/api/student/verify', { version: student!.applicationVersion })); setNotice('선생님에게 신청 확인 완료로 표시했어요.'); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true); setError('');
    try {
      await request('/api/auth/logout', { role: 'student' });
      setState(null); setChoices(['', '', '']); setNotice('로그아웃했어요.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="app student-portal">
    <header className="topbar"><div className="brand"><span className="brand-mark"><LayoutGrid size={23}/></span><span>안성초 5·6학년 동아리 신청<small>학생 신청 · 내 신청 확인</small></span></div>{state && <Button variant="outline" disabled={busy} onClick={signOut}><LogOut size={16}/>로그아웃</Button>}</header>
    <main className={state ? 'student-workspace' : 'portal-login'}>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <output className="notice">{notice}</output>}
      {!state ? <section className="panel portal-login-card">
        <GraduationCap size={32} className="portal-symbol"/>
        <h1>내 동아리 신청</h1>
        <p>선생님에게 받은 신청 코드로 로그인하세요.<br/>내 신청만 확인하고 수정할 수 있어요.</p>
        <form onSubmit={login}>
          <div className="identity-fields">
            <label htmlFor="login-grade">학년<input id="login-grade" required type="number" min="1" max="6" value={identity.grade} onChange={event => setIdentity({ ...identity, grade: event.target.value })}/></label>
            <label htmlFor="login-class">반<input id="login-class" required type="number" min="1" max="99" value={identity.classNo} onChange={event => setIdentity({ ...identity, classNo: event.target.value })}/></label>
            <label htmlFor="login-number">번호<input id="login-number" required type="number" min="1" max="99" value={identity.number} onChange={event => setIdentity({ ...identity, number: event.target.value })}/></label>
          </div>
          <label className="field-label" htmlFor="student-code">나의 신청 코드<input id="student-code" type="password" autoComplete="current-password" required maxLength={80} spellCheck={false} placeholder="선생님이 배부한 코드" value={identity.code} onChange={event => setIdentity({ ...identity, code: event.target.value })}/></label>
          <Button className="primary submit-button" type="submit" disabled={busy}>{busy ? '확인 중…' : '내 신청 열기'}</Button>
        </form>
        <p className="portal-login-help">신청 코드는 다른 사람에게 알려주지 마세요.<br/>코드를 잃어버렸다면 선생님에게 재발급을 요청하세요.</p>
      </section> : <>
        <div className="page-heading"><div><div className="eyebrow">{student!.grade}학년 {student!.classNo}반 {student!.number}번 · {student!.name}</div><h1>나의 동아리 신청</h1><p><span className="status">{phaseNames[state.phase]}</span></p></div><Button variant="outline" disabled={busy} onClick={refresh}><RefreshCw size={16}/>저장된 신청 다시 확인</Button></div>
        <section className="panel saved-application" aria-label="저장된 나의 신청">
          <div className="panel-heading"><div><h2>{saved ? '현재 저장된 신청' : '아직 제출한 신청이 없어요'}</h2><p>{saved ? `${student!.applicationVersion}번째 신청 · ${date(student!.submittedAt)} 저장` : editable ? '아래에서 서로 다른 동아리 3개를 선택하고 제출하세요.' : '신청 접수가 열리면 아래에서 신청할 수 있어요.'}</p></div>{verified && <span className="verification-badge"><ShieldCheck size={18}/>신청 확인 완료</span>}</div>
          {saved && <><div className="saved-choices">{student!.choices.map((choice, rank) => <div key={rank}><span>{rank + 1}지망</span><strong>{clubName(choice)}</strong></div>)}</div><div className="saved-confirmation"><p>{verified ? `${date(student!.verifiedAt)}에 이 신청이 맞다고 확인했어요.` : '위의 저장된 신청이 내가 선택한 내용인지 확인해 주세요.'}</p>{['open', 'closed'].includes(state.phase) && <Button className="primary" disabled={busy || verified || dirty} onClick={verify}><Check size={17}/>{verified ? '확인 완료' : '이 신청이 맞아요'}</Button>}{dirty && <p>선택을 변경했어요. 먼저 새 신청을 저장하거나, 저장된 신청을 다시 불러온 뒤 확인해 주세요.</p>}</div></>}
          {state.phase === 'closed' && <p className="panel-foot">접수는 마감되었지만 내 신청 조회와 확인은 가능해요. 내용이 다르면 선생님에게 알려 주세요.</p>}
          {state.phase === 'allocated' && <p className="panel-foot">선생님이 배정을 검토하고 있어요. 최종 확정 후 내 배정 결과를 볼 수 있어요.</p>}
          {state.phase === 'final' && <div className="my-placement"><h2>나의 최종 배정</h2><strong>{state.placement?.club ? clubName(state.placement.club) : '미배정 · 선생님에게 문의하세요'}</strong></div>}
        </section>
        {editable && <div className="student-grid">
          <section><div className="student-section-label"><LayoutGrid size={18}/>동아리 선택 <b>{state.clubs.length}</b></div><div className="choice-cards">{state.clubs.map((club, index) => {
            const rank = choices.indexOf(club.id);
            return <button type="button" key={club.id} className={`choice-card ${rank >= 0 ? 'selected' : ''}`} disabled={busy} onClick={() => {
              if (rank >= 0) { setChoices(choices.map(choice => choice === club.id ? '' : choice)); return; }
              const empty = choices.indexOf('');
              if (empty < 0) { setError('이미 세 동아리를 골랐어요. 선택한 동아리를 다시 누르면 취소할 수 있어요.'); return; }
              setChoices(choices.map((choice, current) => current === empty ? club.id : choice)); setError('');
            }}><span className="choice-top"><span className={`club-index tone-${index % 4}`}>{String(index + 1).padStart(2, '0')}</span>{rank >= 0 && <span className="choice-rank">{rank + 1}지망 <Check size={13}/></span>}</span><h2>{club.name}</h2><span className="choice-meta">{club.category}<span>최대 {club.max}명</span></span></button>;
          })}</div><p className="muted student-tip">동아리를 누르면 빈 지망 칸부터 채워져요. 고정 학생이 있는 동아리도 남은 정원에 따라 지망별로 배정해요.</p></section>
          <form className="panel application-form" onSubmit={event => { event.preventDefault(); if (choices.some(choice => !choice) || new Set(choices).size !== 3) { setError('서로 다른 동아리 3개를 선택해 주세요.'); return; } if (saved) setConfirm(true); else void submit(); }}>
            <h2>{saved ? '신청 수정하기' : '동아리 신청하기'}</h2><p>1지망부터 원하는 순서로 선택하세요.</p>
            <div className="preference-fields">{choices.map((choice, rank) => <div className="student-preference" key={rank}><label htmlFor={`preference-${rank}`}>{rank + 1}지망</label><Select value={choice || null} items={state.clubs.map(club => ({ value: club.id, label: club.name }))} onValueChange={value => setChoices(choices.map((current, i) => rank === i ? value ?? '' : current))} disabled={busy}><SelectTrigger className="picker" id={`preference-${rank}`}><SelectValue placeholder="선택해 주세요"/></SelectTrigger><SelectContent>{state.clubs.map(club => <SelectItem key={club.id} value={club.id} disabled={choices.includes(club.id) && choice !== club.id}>{club.name}</SelectItem>)}</SelectContent></Select></div>)}</div>
            <p className="resubmit-note">다시 신청하면 기존 신청은 새 신청으로 대체됩니다. 변경 이력은 선생님 확인용으로 보관됩니다.</p>
            <Button type="submit" className="primary submit-button" disabled={busy || (saved && !dirty)}><Send size={17}/>{busy ? '저장 중…' : saved ? '새 신청으로 저장' : '신청 제출하기'}</Button>
            <p className="form-foot">제출 후 ‘현재 저장된 신청’에서 내용을 확인하세요.<br/>신청은 선착순이 아니에요.</p>
          </form>
        </div>}
      </>}
    </main>
    <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogTitle>신청을 새 내용으로 바꿀까요?</AlertDialogTitle><AlertDialogDescription>기존 신청은 새 신청으로 대체됩니다. 변경 이력은 선생님 확인용으로 보관됩니다. 신청을 바꾸면 확인 완료 표시가 초기화되므로 다시 확인해 주세요.</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={() => void submit()}>새 신청 저장</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
