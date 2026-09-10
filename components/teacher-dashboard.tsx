'use client';

import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { Users, LayoutGrid, Shuffle, Download, ArrowRight, Settings2, Check, Search, LockKeyhole, AlertCircle, RefreshCw, LogOut, History, KeyRound, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ClubSettings } from '@/components/club-settings';
import { ClubDetail } from '@/components/club-detail';
import type { Club, Placement } from '@/lib/allocation';
import type { PortalState, RosterInput, RosterStudent, IssuedCode, ApplicationRevision } from '@/lib/portal-types';

type Action =
  | { action: 'import'; rows: RosterInput[] }
  | { action: 'settings'; clubs: Club[] }
  | { action: 'phase'; phase: 'open' | 'closed' }
  | { action: 'allocate'; seed: string }
  | { action: 'adjust'; studentId: string; destination: string; reason: string }
  | { action: 'finalize' }
  | { action: 'reset-code'; studentId: string };
type Confirmation = 'close' | 'allocate' | 'finalize' | { resetCode: RosterStudent } | null;

const phaseNames: Record<PortalState['phase'], string> = { setup: '접수 준비', open: '신청 접수 중', closed: '신청 마감', allocated: '배정 검토 중', final: '최종 확정' };
const placementLabel = (placement: Placement | undefined) => !placement?.club ? '미배정' : placement.assignmentType === 'fixed' ? '명단 고정' : placement.rank === 0 ? '교사 조정' : `${placement.rank}지망`;
const verified = (student: RosterStudent) => student.applicationVersion > 0 && student.verifiedVersion === student.applicationVersion;
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—';

function csv(rows: (string | number | null | undefined)[][]) {
  return rows.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^\s*[=+@-]|^[\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}

function saveFile(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([type.startsWith('text/csv') ? '\uFEFF' : '', content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseRoster(source: string): RosterInput[] {
  const text = source.replace(/^\uFEFF/, '');
  const delimiter = text.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const records: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; }
      else if (quoted || !field) quoted = !quoted;
      else throw new Error('따옴표 형식을 확인해 주세요. CSV로 저장한 명단을 사용해 주세요.');
    } else if (!quoted && character === delimiter) { row.push(field.trim()); field = ''; }
    else if (!quoted && (character === '\n' || character === '\r')) {
      row.push(field.trim());
      if (row.some(Boolean)) records.push(row);
      row = []; field = '';
      if (character === '\r' && text[index + 1] === '\n') index++;
    } else field += character;
  }
  if (quoted) throw new Error('닫히지 않은 따옴표가 있어요. CSV 파일을 확인해 주세요.');
  row.push(field.trim());
  if (row.some(Boolean)) records.push(row);
  if (records[0]?.join(',') !== '학년,반,번호,이름,성별') throw new Error('첫 줄은 학년,반,번호,이름,성별 순서여야 해요.');
  const data = records.slice(1);
  if (!data.length || data.length > 500) throw new Error('학생 명단은 1~500명까지 등록할 수 있어요.');
  const ids = new Set<string>();
  return data.map((cells, index) => {
    const [gradeText, classText, numberText, name, genderText] = cells;
    const grade = Number(gradeText), classNo = Number(classText), number = Number(numberText);
    const gender = genderText || '미입력';
    if (cells.length !== 5 || ![gradeText, classText, numberText].every(value => /^\d+$/.test(value)) || !Number.isInteger(grade) || grade < 1 || grade > 6 || !Number.isInteger(classNo) || classNo < 1 || classNo > 99 || !Number.isInteger(number) || number < 1 || number > 99 || !name || name.length > 30 || !['남', '여', '미입력'].includes(gender)) {
      throw new Error(`${index + 2}번째 줄을 확인해 주세요. 학년 1~6, 반·번호 1~99, 이름 1~30자, 성별 남/여/미입력으로 입력해 주세요.`);
    }
    const id = `${grade}-${classNo}-${number}`;
    if (ids.has(id)) throw new Error(`${index + 2}번째 줄: ${id} 학번이 중복되었어요.`);
    ids.add(id);
    return { grade, classNo, number, name, gender };
  });
}

export function TeacherDashboard({ initialState }: { initialState: PortalState }) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [seed, setSeed] = useState('CLUB-2026-01');
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [settings, setSettings] = useState(false);
  const [draft, setDraft] = useState<Club[]>([]);
  const [settingsError, setSettingsError] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [importText, setImportText] = useState('');
  const [importRows, setImportRows] = useState<RosterInput[] | null>(null);
  const [importError, setImportError] = useState('');
  const [codes, setCodes] = useState<IssuedCode[]>([]);
  const [editing, setEditing] = useState<RosterStudent | null>(null);
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const [editError, setEditError] = useState('');
  const [historyStudent, setHistoryStudent] = useState<RosterStudent | null>(null);
  const [history, setHistory] = useState<ApplicationRevision[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyRequest = useRef(0);
  const { students, clubs, result, phase } = state;
  const locked = phase === 'final';
  const canConfigure = !result && ['setup', 'open'].includes(phase);
  const clubName = (id: string | null | undefined) => clubs.find(club => club.id === id)?.name ?? (id ? '알 수 없는 동아리' : '미배정');
  const fixedIds = useMemo(() => new Set(clubs.filter(club => club.allocationMode === 'fixed').flatMap(club => club.fixedStudentIds ?? [])), [clubs]);
  const stats = useMemo(() => clubs.map(club => ({
    ...club,
    reserved: club.allocationMode === 'fixed' ? club.fixedStudentIds?.length ?? 0 : 0,
    first: students.filter(student => student.choices[0] === club.id).length,
    eligibleFirst: students.filter(student => student.choices[0] === club.id && !fixedIds.has(student.id)).length,
    count: students.filter(student => result?.placements[student.id]?.club === club.id).length,
  })), [clubs, students, result, fixedIds]);
  const submitted = students.filter(student => student.applicationVersion > 0).length;
  const verifiedCount = students.filter(verified).length;
  const placed = students.filter(student => result?.placements[student.id]?.club).length;
  const waiting = result ? students.length - placed : 0;
  const shortage = result ? stats.filter(club => club.count < club.min) : [];
  const matches = students.filter(student => {
    const placement = result?.placements[student.id];
    return (filter === 'all' || (filter === 'unsubmitted' && !student.applicationVersion) || (filter === 'unverified' && student.applicationVersion > 0 && !verified(student)) || (filter === 'waiting' && result && !placement?.club) || placement?.club === filter) && `${student.id} ${student.name}`.includes(query.trim());
  });

  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
    if (response.status === 401) { window.location.assign('/teacher'); throw new Error('로그인이 만료되었어요. 다시 로그인해 주세요.'); }
    const data = await response.json() as T & { error?: string };
    if (!response.ok) {
      if (response.status === 409) {
        const fresh = await fetch('/api/teacher/state', { credentials: 'same-origin', cache: 'no-store' });
        if (fresh.ok) setState(await fresh.json() as PortalState);
      }
      throw new Error(data.error || '처리하지 못했어요. 새로고침 후 다시 시도해 주세요.');
    }
    return data;
  }

  async function perform(action: Action, message: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await request<{ state: PortalState; codes?: IssuedCode[] }>('/api/teacher/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...action, revision: state.revision }),
      });
      setState(response.state);
      if (response.codes?.length) setCodes(response.codes);
      setNotice(message);
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '서버에 연결하지 못했어요.';
      setError(message);
      if (action.action === 'settings') setSettingsError(message);
      if (action.action === 'adjust') setEditError(message);
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function refresh() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { setState(await request<PortalState>('/api/teacher/state')); setNotice('최신 신청 현황을 불러왔어요.'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '새로고침하지 못했어요.'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function logout() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'teacher' }) });
      if (!response.ok) throw new Error('로그아웃하지 못했어요. 다시 시도해 주세요.');
      window.location.assign('/teacher');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '서버에 연결하지 못했어요.'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function readUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError(''); setImportRows(null);
    if (file.size > 1024 * 1024) { setImportError('1MB 이하의 CSV 파일을 선택해 주세요.'); return; }
    try { setImportText(await file.text()); }
    catch { setImportError('파일을 읽지 못했어요. 다시 선택하거나 내용을 붙여 넣어 주세요.'); }
  }

  function previewRoster() {
    try {
      const rows = parseRoster(importText);
      const existing = new Set(students.map(student => student.id));
      const duplicate = rows.find(student => existing.has(`${student.grade}-${student.classNo}-${student.number}`));
      if (duplicate) throw new Error(`${duplicate.grade}-${duplicate.classNo}-${duplicate.number} 학생은 이미 등록되어 있어요. 추가할 새 학생만 포함해 주세요.`);
      setImportRows(rows); setImportError('');
    }
    catch (caught) { setImportRows(null); setImportError(caught instanceof Error ? caught.message : '명단 형식을 확인해 주세요.'); }
  }

  function exportRoster(onlyWaiting = false) {
    const rows = students.filter(student => !onlyWaiting || (result && !result.placements[student.id]?.club));
    saveFile(onlyWaiting ? '동아리_미배정자.csv' : '동아리_학생명단.csv', csv([
      ['학년', '반', '번호', '이름', '성별', '1지망', '2지망', '3지망', '신청 상태', '신청 버전', '학생 확인', '제출 시각', '확인 시각', '배정 동아리', '배정 구분', '조정 사유'],
      ...rows.map(student => {
        const placement = result?.placements[student.id];
        return [student.grade, student.classNo, student.number, student.name, student.gender, ...[0, 1, 2].map(rank => student.choices[rank] ? clubName(student.choices[rank]) : '미신청'), student.applicationVersion ? '신청 완료' : '미신청', student.applicationVersion, verified(student) ? '확인 완료' : '미확인', student.submittedAt, student.verifiedAt, result ? clubName(placement?.club) : '배정 전', result ? placementLabel(placement) : '', placement?.reason ?? ''];
      }),
    ]));
  }

  async function exportAudit() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const data = await request<{ audit: unknown[] }>('/api/teacher/audit');
      saveFile('동아리_운영기록.json', JSON.stringify({ exportedAt: new Date().toISOString(), audit: data.audit }, null, 2), 'application/json');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '기록을 불러오지 못했어요.'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function showHistory(student: RosterStudent) {
    const requestId = ++historyRequest.current;
    setHistoryStudent(student); setHistory([]); setHistoryError(''); setHistoryLoading(true);
    try {
      const data = await request<{ history: ApplicationRevision[] }>(`/api/teacher/history?studentId=${encodeURIComponent(student.id)}`);
      if (historyRequest.current === requestId) setHistory(data.history);
    } catch (caught) { if (historyRequest.current === requestId) setHistoryError(caught instanceof Error ? caught.message : '신청 이력을 불러오지 못했어요.'); }
    finally { if (historyRequest.current === requestId) setHistoryLoading(false); }
  }

  async function confirmAction() {
    const target = confirmation;
    setConfirmation(null);
    if (target === 'close') await perform({ action: 'phase', phase: 'closed' }, '신청을 마감했어요. 배정 전까지 다시 열 수 있어요.');
    else if (target === 'allocate') await perform({ action: 'allocate', seed: seed.trim() }, '배정을 완료했어요. 미배정 학생과 최소 인원 미달 동아리를 검토해 주세요.');
    else if (target === 'finalize') await perform({ action: 'finalize' }, '배정을 최종 확정했어요. 학생들이 자신의 결과를 확인할 수 있어요.');
    else if (target && typeof target === 'object') await perform({ action: 'reset-code', studentId: target.resetCode.id }, '새 개인 코드를 발급했어요. 이전 코드는 사용할 수 없어요.');
  }

  const confirmationTitle = confirmation === 'close' ? '학생 신청을 마감할까요?' : confirmation === 'allocate' ? '자동 배정을 실행할까요?' : confirmation === 'finalize' ? '배정을 최종 확정할까요?' : '개인 코드를 다시 발급할까요?';
  const confirmationDescription = confirmation === 'close' ? `신청 ${submitted}명 / 미신청 ${students.length - submitted}명 / 현재 신청 확인 완료 ${verifiedCount}명입니다. 마감하면 학생이 지망을 수정할 수 없어요.` : confirmation === 'allocate' ? `전체 ${students.length}명 중 고정 명단 ${fixedIds.size}명을 먼저 배정하고, 나머지 신청자를 1→2→3지망 순서로 배정해요. 미신청 학생은 고정 명단에 있는 경우에만 자동 배정돼요. 추첨 번호: ${seed.trim()}. 배정 후에는 신청을 다시 열거나 설정을 바꿀 수 없어요.` : confirmation === 'finalize' ? `미배정 ${waiting}명, 최소 인원 미달 ${shortage.length}개입니다. 최종 확정 후에는 배정을 조정할 수 없어요.` : confirmation && typeof confirmation === 'object' ? `${confirmation.resetCode.id} ${confirmation.resetCode.name} 학생의 이전 코드가 즉시 무효화돼요. 새 코드는 발급 직후에만 표시되므로 해당 학생에게 개별 전달해 주세요.` : '';

  return <div className="app teacher-portal">
    <header className="topbar"><Link className="brand" href="/teacher"><span className="brand-mark"><LayoutGrid size={23}/></span><span>안성초 5~6 동아리 신청<small>선생님 관리</small></span></Link><div className="portal-actions"><Button variant="outline" onClick={refresh} disabled={busy}><RefreshCw size={16}/>새로고침</Button><Button variant="ghost" onClick={logout} disabled={busy}><LogOut size={16}/>로그아웃</Button></div></header>
    <main className="workspace">
      <div className="page-heading"><div><div className="eyebrow">동아리 운영 / {phaseNames[phase]}</div><h1>동아리 신청·배정<span className={`status ${result ? 'done' : ''}`}>{phaseNames[phase]}</span></h1><p>학생 명단을 등록하고 신청 접수부터 최종 배정까지 관리해요.</p></div><a className="portal-student-link" href="/" target="_blank" rel="noreferrer">학생 신청 화면 열기 ↗</a></div>
      {notice && <output className="notice"><Check size={18}/><span>{notice}</span><button aria-label="알림 닫기" onClick={() => setNotice('')}>×</button></output>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="metrics">
        <div><span><Users size={17}/>전체 학생</span><strong>{students.length}<small>명</small></strong><p>등록한 학교 학생 명단</p></div>
        <div><span><Check size={17}/>신청 완료</span><strong>{submitted}<small>명</small></strong><p>서로 다른 3개 동아리 제출</p></div>
        <div className={students.length > submitted ? 'attention' : ''}><span><AlertCircle size={17}/>미신청</span><strong>{students.length - submitted}<small>명</small></strong><p>아직 신청을 제출하지 않은 학생</p></div>
        <div><span><LockKeyhole size={17}/>현재 신청 확인 완료</span><strong>{verifiedCount}<small>명</small></strong><p>다시 제출하면 확인이 초기화돼요.</p></div>
      </div>

      {['setup', 'open'].includes(phase) && <section className="panel portal-import">
        <div className="panel-heading"><div><h2>{students.length ? '학생 추가 등록' : '1. 학생 명단 등록'}</h2><p>{students.length ? '새 학생만 추가해요. 기존 학생의 정보와 신청은 유지돼요.' : '한 번에 최대 500명을 등록해요. 등록하면 학생별 개인 코드가 발급돼요.'}</p></div><Button variant="outline" onClick={() => saveFile('학생명단_양식.csv', csv([['학년', '반', '번호', '이름', '성별']]))}><Download size={16}/>CSV 양식</Button></div>
        <div className="portal-import-body">
          <label className="field-label">CSV 파일 선택<input type="file" accept=".csv,text/csv,.tsv,text/tab-separated-values" onChange={readUpload} disabled={busy}/></label>
          <label className="field-label">또는 엑셀에서 복사해 붙여 넣기<textarea value={importText} onChange={event => { setImportText(event.target.value); setImportRows(null); }} rows={7} placeholder="학년,반,번호,이름,성별" disabled={busy}/></label>
          <p className="muted">첫 줄: 학년, 반, 번호, 이름, 성별. 성별은 남·여·미입력 또는 빈칸으로 입력해요. 엑셀은 CSV UTF-8로 저장해 주세요.</p>
          {students.length > 0 && <p className="muted">한 번에 최대 500명을 추가할 수 있어요. 이미 등록한 학번이 포함되면 등록되지 않으므로 새 학생만 넣어 주세요.</p>}
          {importError && <p className="form-error" role="alert">{importError}</p>}
          <Button variant="outline" onClick={previewRoster} disabled={busy || !importText.trim()}><Upload size={16}/>명단 확인</Button>
          {importRows && <div className="portal-import-preview"><h3>등록할 학생 {importRows.length}명</h3><div className="roster-scroll max-h-64 overflow-y-auto"><Table><TableHeader><TableRow><TableHead>학년·반·번호</TableHead><TableHead>이름</TableHead><TableHead>성별</TableHead></TableRow></TableHeader><TableBody>{importRows.map(student => <TableRow key={`${student.grade}-${student.classNo}-${student.number}`}><TableCell>{student.grade}-{student.classNo}-{student.number}</TableCell><TableCell>{student.name}</TableCell><TableCell>{student.gender}</TableCell></TableRow>)}</TableBody></Table></div><p>등록 후 발급되는 개인 코드를 저장하고 학생에게 개별 전달해 주세요.</p><Button className="primary" disabled={busy} onClick={async () => { if (await perform({ action: 'import', rows: importRows }, '학생 명단을 등록했어요. 개인 코드를 저장해 주세요.')) { setImportRows(null); setImportText(''); } }}>{busy ? '등록 중…' : `${importRows.length}명 등록하고 개인 코드 발급`}</Button></div>}
        </div>
      </section>}

      <div className="dashboard-grid">
        <section className="panel club-panel"><div className="panel-heading"><div><h2>동아리별 {result ? '배정' : '신청'} 현황</h2><p>동아리를 눌러 명단과 1·2·3지망을 확인해요.</p>{phase === 'closed' && <p>정원·고정 명단 변경이나 학생 추가는 ‘신청 다시 열기’ 후 가능해요.</p>}</div><Button variant="ghost" disabled={busy || !canConfigure} onClick={() => { setDraft(clubs.map(club => ({ ...club, fixedStudentIds: [...(club.fixedStudentIds ?? [])] }))); setSettingsError(''); setSettings(true); }}><Settings2 size={16}/>정원·배정 설정</Button></div>
          <div className="club-table"><div className="club-table-head"><span>동아리</span><span>{result ? '배정 인원' : '1지망 신청'} / 최대 정원</span><span>상태</span></div>{stats.map((club, index) => {
            const count = result ? club.count : club.first;
            const over = !result && club.eligibleFirst > club.max - club.reserved;
            const under = !!result && count < club.min;
            return <button className="club-row" key={club.id} onClick={() => setDetail(club.id)}><span className="club-label"><span className={`club-index tone-${index % 4}`}>{String(index + 1).padStart(2, '0')}</span><span>{club.name}<small>{club.category}{club.reserved ? ` · 고정 ${club.reserved}명` : ''}</small></span></span><span className="capacity"><span className="capacity-track"><span className={over ? 'over' : under ? 'under' : ''} style={{ width: `${Math.min(100, count / club.max * 100)}%` }}/></span><span className={over ? 'over-text' : ''}><b>{count}</b> / {club.max}</span></span><span className={`chip ${over ? 'orange' : under ? 'amber' : result ? 'green' : 'neutral'}`}>{over ? '추첨 필요' : under ? '최소 미달' : result ? count === club.max ? '정원 마감' : '배정 완료' : '정원 이내'}</span></button>;
          })}</div><p className="panel-foot">고정 학생을 먼저 배정하고 모든 동아리의 남은 정원을 지망별로 배정해요. 신청 인원에는 고정 학생도 포함돼요.</p>
        </section>
        <aside className="right-column">
          <section className="allocation-card"><span className="section-number">ALLOCATION</span><h2>{locked ? '최종 확정했어요' : result ? '배정을 검토해 주세요' : phase === 'open' ? '학생 신청을 받고 있어요' : phase === 'closed' ? '마감한 신청을 배정해요' : '명단과 설정을 준비해요'}</h2>
            <p>{result ? `배정 ${placed}명 · 미배정 ${waiting}명` : `신청 ${submitted}명 · 명단 고정 ${fixedIds.size}명`}</p>
            {!result && <p>고정 명단을 먼저 배정하고, 나머지 신청자는 1지망부터 정원 초과 시 동일 확률로 추첨해요.</p>}
            {phase === 'setup' && <Button className="run-button" disabled={busy || !students.length} onClick={() => perform({ action: 'phase', phase: 'open' }, '학생 신청 접수를 시작했어요. 학생들에게 신청 주소와 개인 코드를 안내해 주세요.')}>학생 신청 접수 시작<ArrowRight size={17}/></Button>}
            {phase === 'open' && <Button className="run-button" disabled={busy} onClick={() => setConfirmation('close')}><LockKeyhole size={17}/>신청 마감</Button>}
            {phase === 'closed' && <><label className="seed-label" htmlFor="teacher-seed">추첨 번호</label><input id="teacher-seed" value={seed} onChange={event => setSeed(event.target.value)} maxLength={80} disabled={busy}/><small className="seed-help">같은 입력 자료와 번호는 같은 추첨 결과를 만들어요.</small><Button className="run-button" disabled={busy || !seed.trim() || (!submitted && !fixedIds.size)} onClick={() => setConfirmation('allocate')}><Shuffle size={17}/>자동 배정 실행</Button><Button className="audit-button" variant="ghost" disabled={busy} onClick={() => perform({ action: 'phase', phase: 'open' }, '신청 접수를 다시 열었어요. 학생이 지망을 다시 제출할 수 있어요.')}>신청 다시 열기</Button></>}
            {result && <><ol className="steps">{[1, 2, 3].map(rank => <li key={rank}><span className="checked"><Check size={14}/></span><div><b>{rank}지망 배정</b><small>{Object.values(result.placements).filter(placement => placement.rank === rank).length}명 배정</small></div></li>)}</ol><Button className="run-button" disabled={busy || locked} onClick={() => setConfirmation('finalize')}><LockKeyhole size={17}/>{locked ? '최종 확정 완료' : '검토 후 최종 확정'}</Button></>}
            <Button className="audit-button" variant="ghost" disabled={busy} onClick={exportAudit}><Download size={16}/>운영·추첨 기록 저장</Button>
          </section>
          <section className="panel review-panel"><h2>선생님 확인 사항</h2><button className="review-item" onClick={() => { setFilter(result ? 'waiting' : 'unsubmitted'); document.getElementById('teacher-roster')?.scrollIntoView({ behavior: 'smooth' }); }}><span>{result ? '미배정 학생' : '미신청 학생'}</span><b>{result ? waiting : students.length - submitted}명 <ArrowRight size={14}/></b></button><button className="review-item" onClick={() => { setFilter('unverified'); document.getElementById('teacher-roster')?.scrollIntoView({ behavior: 'smooth' }); }}><span>제출 후 미확인</span><b>{submitted - verifiedCount}명 <ArrowRight size={14}/></b></button>{result && <><div className="review-item"><span>최소 인원 미달</span><b>{shortage.length}개</b></div>{shortage.length > 0 && <p className="shortage-list">{shortage.map(club => `${club.name} ${club.count}/${club.min}명`).join(' · ')}</p>}</>}<p>학생이 지망을 다시 제출하면 이전 확인은 초기화돼요. 새로고침으로 최신 현황을 확인해 주세요.</p><p>개인 코드는 각 학생에게 개별 전달하고, 분실한 경우 해당 학생 행에서 재발급해요.</p></section>
        </aside>
      </div>

      <section className="panel roster-panel" id="teacher-roster"><div className="panel-heading"><div><h2>학생별 신청·배정 <span className="count-label">{matches.length}명</span></h2><p>신청 이력에서 이전 지망과 제출 시각을 확인할 수 있어요.</p></div><div className="export-buttons">{result && <Button variant="outline" onClick={() => exportRoster(true)}><Download size={16}/>미배정자 CSV</Button>}<Button variant="outline" onClick={() => exportRoster()}><Download size={16}/>전체 CSV</Button></div></div>
        <div className="roster-tools"><div className="search-field"><Search size={17}/><input aria-label="학생 검색" placeholder="이름 또는 학년-반-번호 검색" value={query} onChange={event => setQuery(event.target.value)}/></div><select className="picker" aria-label="학생 상태 필터" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">전체 학생</option><option value="unsubmitted">미신청 학생</option><option value="unverified">제출 후 미확인</option>{result && <><option value="waiting">미배정 학생</option>{clubs.map(club => <option key={club.id} value={club.id}>{club.name}</option>)}</>}</select></div>
        <div className="roster-scroll"><Table><TableHeader><TableRow>{['학년·반·번호', '이름', '1지망', '2지망', '3지망', '신청·확인', ...(result ? ['배정 결과'] : []), '관리'].map(heading => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader><TableBody>{matches.map(student => {
          const placement = result?.placements[student.id];
          return <TableRow key={student.id}><TableCell className="student-id">{student.id}</TableCell><TableCell><b>{student.name}</b></TableCell>{[0, 1, 2].map(rank => <TableCell key={rank}>{student.choices[rank] ? placement?.rank === rank + 1 && placement.club === student.choices[rank] ? <strong className="winning-choice">{clubName(student.choices[rank])}</strong> : clubName(student.choices[rank]) : <span className="muted">미신청</span>}</TableCell>)}<TableCell><span className={`chip ${verified(student) ? 'green' : student.applicationVersion ? 'amber' : 'neutral'}`}>{!student.applicationVersion ? '미신청' : verified(student) ? '확인 완료' : '확인 필요'}</span>{student.applicationVersion > 0 && <small className="rank-label">{student.applicationVersion}차 신청 · {dateLabel(student.submittedAt)}</small>}</TableCell>{result && <TableCell><span className={`result-label ${!placement?.club ? 'unplaced' : ''}`}>{clubName(placement?.club)}</span><small className="rank-label">{placementLabel(placement)}</small></TableCell>}<TableCell><div className="portal-row-actions"><Button variant="outline" size="sm" onClick={() => showHistory(student)}><History size={14}/>이력</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmation({ resetCode: student })}><KeyRound size={14}/>코드 재발급</Button>{result && <Button variant="outline" size="sm" disabled={busy || locked || placement?.assignmentType === 'fixed'} onClick={() => { setEditing(student); setDestination(''); setReason(''); setEditError(''); }}>배정 조정</Button>}</div></TableCell></TableRow>;
        })}</TableBody></Table></div>{matches.length === 0 && <p className="empty-message">조건에 맞는 학생이 없어요.</p>}<p className="panel-foot">전체 CSV에는 개인 코드가 포함되지 않아요. 학생별 확인 여부는 가장 최근에 제출한 신청을 기준으로 표시해요.</p>
      </section>
    </main>
    <footer className="footer"><span>안성초 5~6 동아리 신청</span><span>명단 등록 → 학생 신청 → 배정·검토 → 최종 확정</span><span>선생님 관리</span></footer>

    <AlertDialog open={!!confirmation} onOpenChange={open => { if (!open) setConfirmation(null); }}><AlertDialogContent><AlertDialogTitle>{confirmationTitle}</AlertDialogTitle><AlertDialogDescription>{confirmationDescription}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={confirmAction}>{confirmation === 'close' ? '신청 마감' : confirmation === 'allocate' ? '자동 배정 실행' : confirmation === 'finalize' ? '최종 확정' : '새 코드 발급'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <ClubSettings open={settings} onOpenChange={setSettings} draft={draft} onChange={setDraft} students={students} error={settingsError} onSave={async () => { if (await perform({ action: 'settings', clubs: draft }, '동아리 정원과 고정 명단을 저장했어요.')) setSettings(false); }}/>
    <ClubDetail key={`${detail}-${!!result}`} club={clubs.find(club => club.id === detail)} clubs={clubs} students={students} result={result} open={!!detail} onOpenChange={open => { if (!open) setDetail(null); }}/>
    <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent><DialogTitle>학생 배정 조정</DialogTitle><DialogDescription>{editing?.id} · {editing?.name}<br/>현재: {clubName(result?.placements[editing?.id ?? '']?.club)}</DialogDescription><label className="field-label">이동할 동아리<select className="picker" value={destination} onChange={event => setDestination(event.target.value)} disabled={busy}><option value="">동아리를 선택해 주세요</option>{stats.map(club => <option key={club.id} value={club.id} disabled={club.count >= club.max || result?.placements[editing?.id ?? '']?.club === club.id}>{club.name} ({club.count}/{club.max}명)</option>)}</select></label><label className="field-label">조정 사유<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={300} placeholder="학생과 확인한 재선택 내용 또는 조정 사유" disabled={busy}/></label>{editError && <p className="form-error" role="alert">{editError}</p>}<Button className="primary" disabled={busy || !destination || !reason.trim()} onClick={async () => { if (editing && await perform({ action: 'adjust', studentId: editing.id, destination, reason: reason.trim() }, '학생 배정을 조정했어요.')) setEditing(null); }}>배정 변경</Button></DialogContent></Dialog>
    <Dialog open={codes.length > 0} onOpenChange={open => { if (!open) setCodes([]); }}><DialogContent className="wide-dialog portal-code-dialog" showCloseButton={false}><DialogTitle>학생 개인 코드 {codes.length}개 발급</DialogTitle><DialogDescription>개인 코드는 이 화면에서 한 번만 표시돼요. 닫기 전에 저장하고 각 학생에게 자신의 코드만 개별 전달해 주세요. 전체 코드 명단을 학생들에게 공유하지 마세요.</DialogDescription><div className="portal-code-table max-h-[45dvh] overflow-y-auto"><Table><TableHeader><TableRow><TableHead>학번</TableHead><TableHead>이름</TableHead><TableHead>개인 코드</TableHead></TableRow></TableHeader><TableBody>{codes.map(code => <TableRow key={code.id}><TableCell>{code.id}</TableCell><TableCell>{code.name}</TableCell><TableCell><code>{code.code}</code></TableCell></TableRow>)}</TableBody></Table></div><Button className="primary" onClick={() => saveFile('학생_개인코드_개별전달용.csv', csv([['학번', '이름', '개인 코드'], ...codes.map(code => [code.id, code.name, code.code])]))}><Download size={16}/>개인 코드 명단 저장</Button><Button variant="outline" onClick={() => setCodes([])}>확인했어요 · 코드 화면 닫기</Button><p className="muted">나중에는 기존 코드를 조회할 수 없어요. 분실한 학생은 새 코드를 발급해 주세요.</p></DialogContent></Dialog>
    <Dialog open={!!historyStudent} onOpenChange={open => { if (!open) { historyRequest.current++; setHistoryStudent(null); } }}><DialogContent className="wide-dialog portal-history"><DialogTitle>신청 이력</DialogTitle><DialogDescription>{historyStudent?.id} · {historyStudent?.name}<br/>제출할 때마다 새 이력이 남으며 이전 신청 내용은 유지돼요. 재제출 시 학생 확인은 초기화돼요.</DialogDescription>{historyLoading ? <output>신청 이력을 불러오는 중이에요…</output> : historyError ? <p className="form-error" role="alert">{historyError}</p> : history.length ? <div className="max-h-[55dvh] overflow-y-auto">{[...history].sort((left, right) => right.version - left.version).map(item => <article className="portal-history-entry" key={item.id}><h3>{item.version}차 신청 <small>{dateLabel(item.submittedAt)}</small></h3><ol>{[0, 1, 2].map(rank => <li key={rank}><span>{rank + 1}지망</span> <b>{clubName(item.choices[rank])}</b></li>)}</ol></article>)}</div> : <p className="empty-message">아직 제출한 신청이 없어요.</p>}</DialogContent></Dialog>
  </div>;
}
