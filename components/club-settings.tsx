'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { applyFixedRoster, completedRank, type Club, type Student, type Result } from '@/lib/allocation';

const modes = [{ value: 'lottery', label: '지망별 추첨' }, { value: 'fixed', label: '일부 고정 후 지망별 추첨' }];

export function ClubSettings({ open, onOpenChange, draft, onChange, students, error, onSave, fixedOnly = false, originalClubs, result = null, busy = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; draft: Club[];
  onChange: (clubs: Club[]) => void; students: Student[]; error: string; onSave: () => void;
  fixedOnly?: boolean; originalClubs: Club[]; result?: Result | null; busy?: boolean;
}) {
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const update = (id: string, patch: Partial<Club>) => { setReview(false); onChange(draft.map(c => c.id === id ? { ...c, ...patch } : c)); };
  const fixedClub = (clubs: Club[], id: string) => clubs.find(c=>c.allocationMode==='fixed' && c.fixedStudentIds?.includes(id));
  const changes = students.filter(s=>fixedClub(originalClubs,s.id)?.id !== fixedClub(draft,s.id)?.id);
  let previewError = '';
  if(result) try { applyFixedRoster(result, originalClubs, draft); } catch(caught) { previewError = (caught as Error).message; }
  const clubName = (id: string | null | undefined) => originalClubs.find(c=>c.id===id)?.name ?? '미배정';
  return <Dialog open={open} onOpenChange={value=>{ if(!busy) { setReview(false); onOpenChange(value); } }}>
    <DialogContent className="club-settings-dialog">
      <DialogTitle>{fixedOnly ? '고정 명단 수정' : '동아리 정원·배정 설정'}</DialogTitle>
      <DialogDescription>지정한 학생만 먼저 배정하고 추첨에서 제외해요. 해당 동아리의 남은 정원은 다른 학생들을 1→2→3지망 순서로 배정하며, 정원을 넘으면 추첨해요.</DialogDescription>
      {fixedOnly && <p>신청은 닫힌 상태로 유지돼요. 정원은 변경할 수 없고 고정 명단만 수정할 수 있어요.</p>}
      <fieldset disabled={busy} className="club-settings-list border-0 p-0 m-0 min-w-0">
        {draft.map(c => {
          const fixed = c.allocationMode === 'fixed';
          const ids = c.fixedStudentIds ?? [];
          const matches = students.filter(s => (s.id + ' ' + s.name).includes((queries[c.id] ?? '').trim()));
          return <section key={c.id} className="club-setting">
            <div className="club-setting-fields">
              <h3>{c.name}</h3>
              <label>최소<input disabled={fixedOnly} aria-label={`${c.name} 최소 인원`} type="number" min="0" max="999" value={c.min} onChange={e => update(c.id, { min: Number(e.target.value) })}/></label>
              <label>최대<input disabled={fixedOnly} aria-label={`${c.name} 최대 인원`} type="number" min="1" max="999" value={c.max} onChange={e => update(c.id, { max: Number(e.target.value) })}/></label>
              <Select value={c.allocationMode ?? 'lottery'} items={modes} onValueChange={value => {
                if ((value === 'lottery' || value === 'fixed') && value !== (c.allocationMode ?? 'lottery')) update(c.id, { allocationMode: value, fixedStudentIds: [] });
              }}>
                <SelectTrigger className="picker" aria-label={`${c.name} 배정 방식`}><SelectValue/></SelectTrigger>
                <SelectContent>{modes.map(mode => <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {fixed && <details className="fixed-roster-editor" open>
              <summary>고정 명단 <strong>{ids.length} / {c.max}명</strong></summary>
              <p>선택한 학생은 지망과 관계없이 이 동아리로 배정해요. {result ? completedRank(result)<3 ? '고정 해제 시 미배정으로 돌아가며, 신청한 학생은 다음 지망부터 추첨에 참여해요. 지난 지망은 다시 추첨하지 않아요.' : '고정 해제 시 미배정으로 돌아가요. 3지망까지 완료했으므로 학생별 배정 조정으로 직접 배정해 주세요.' : '선택을 해제하면 신청한 학생은 추첨 대상에 다시 포함돼요.'}</p>
              <input className="fixed-search" aria-label={`${c.name} 고정 학생 검색`} placeholder="이름 또는 학년-반-번호 검색" value={queries[c.id] ?? ''} onChange={e => setQueries({ ...queries, [c.id]: e.target.value })}/>
              {ids.length > 0 && <div className="fixed-selected">{ids.map(id => <Button key={id} variant="outline" aria-label={`${c.name} ${students.find(s => s.id === id)?.name ?? id} 고정 해제`} onClick={() => update(c.id, { fixedStudentIds: ids.filter(item => item !== id) })}>{id} {students.find(s => s.id === id)?.name} ×</Button>)}</div>}
              <div className="fixed-candidates">
                {matches.map(s => {
                  const selected = ids.includes(s.id);
                  const other = draft.find(d => d.id !== c.id && d.allocationMode === 'fixed' && d.fixedStudentIds?.includes(s.id));
                  return <label key={s.id} className="fixed-candidate">
                    <Checkbox checked={selected} disabled={!!other || (!selected && ids.length >= c.max)} onCheckedChange={checked => update(c.id, { fixedStudentIds: checked ? [...ids, s.id] : ids.filter(id => id !== s.id) })}/>
                    <span>{s.id} · {s.name}</span><small>{other ? `${other.name}에 고정됨` : selected ? '선택됨' : ''}</small>
                  </label>;
                })}
                {!matches.length && <p className="empty-message">검색한 학생이 없어요.</p>}
              </div>
              {!ids.length && <p>고정 학생이 없으면 전체 정원을 지망별로 배정해요.</p>}
            </details>}
          </section>;
        })}
      </fieldset>
      <p>최소 인원은 배정 후 검토 기준이며, 최대 인원을 넘는 고정 명단은 저장할 수 없어요.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {previewError && <p className="form-error" role="alert">{previewError}</p>}
      {review && <section aria-label="고정 명단 변경 확인" className="max-h-56 overflow-y-auto">
        <h3>변경 대상 {changes.length}명</h3>
        {changes.map(student=><p key={student.id}>{student.id} · {student.name}: {result ? clubName(result.placements[student.id]?.club) : fixedClub(originalClubs,student.id)?.name ?? '고정 없음'} → {fixedClub(draft,student.id)?.name ?? (result ? '미배정 (고정 해제)' : '고정 없음')} {fixedClub(draft,student.id) ? '(고정)' : ''}</p>)}
        {result && <p>위 학생의 배정에만 반영해요. 다른 학생과 지난 추첨 기록은 유지돼요. 고정 해제로 생긴 빈자리는 지난 지망으로 자동 충원하지 않아요.</p>}
      </section>}
      <Button className="primary" disabled={busy || !!previewError} onClick={()=>{ if(changes.length && !review) setReview(true); else onSave(); }}>{busy ? '저장 중…' : changes.length && !review ? '변경 대상 확인' : review ? '변경 확인 · 저장' : '설정 저장'}</Button>
    </DialogContent>
  </Dialog>;
}
