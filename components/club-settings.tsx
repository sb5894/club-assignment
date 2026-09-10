'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import type { Club, Student } from '@/lib/allocation';

const modes = [{ value: 'lottery', label: '지망별 추첨' }, { value: 'fixed', label: '임의배정 · 명단 고정' }];

export function ClubSettings({ open, onOpenChange, draft, onChange, students, error, onSave }: {
  open: boolean; onOpenChange: (open: boolean) => void; draft: Club[];
  onChange: (clubs: Club[]) => void; students: Student[]; error: string; onSave: () => void;
}) {
  const [queries, setQueries] = useState<Record<string, string>>({});
  const update = (id: string, patch: Partial<Club>) => onChange(draft.map(c => c.id === id ? { ...c, ...patch } : c));
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="club-settings-dialog">
      <DialogTitle>동아리 정원·배정 설정</DialogTitle>
      <DialogDescription>명단 고정 동아리는 지정한 학생만 배정해요. 해당 학생과 동아리는 1·2·3지망 추첨에서 제외되며, 빈자리도 자동으로 채우지 않아요.</DialogDescription>
      <div className="club-settings-list">
        {draft.map(c => {
          const fixed = c.allocationMode === 'fixed';
          const ids = c.fixedStudentIds ?? [];
          const matches = students.filter(s => (s.id + ' ' + s.name).includes((queries[c.id] ?? '').trim()));
          return <section key={c.id} className="club-setting">
            <div className="club-setting-fields">
              <h3>{c.name}</h3>
              <label>최소<input aria-label={`${c.name} 최소 인원`} type="number" min="0" max="999" value={c.min} onChange={e => update(c.id, { min: Number(e.target.value) })}/></label>
              <label>최대<input aria-label={`${c.name} 최대 인원`} type="number" min="1" max="999" value={c.max} onChange={e => update(c.id, { max: Number(e.target.value) })}/></label>
              <Select value={c.allocationMode ?? 'lottery'} items={modes} onValueChange={value => {
                if (value === 'lottery' || value === 'fixed') update(c.id, { allocationMode: value, fixedStudentIds: [] });
              }}>
                <SelectTrigger className="picker" aria-label={`${c.name} 배정 방식`}><SelectValue/></SelectTrigger>
                <SelectContent>{modes.map(mode => <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {fixed && <details className="fixed-roster-editor" open>
              <summary>고정 명단 <strong>{ids.length} / {c.max}명</strong></summary>
              <p>선택한 학생은 지망과 관계없이 이 동아리로 배정해요. 선택을 해제하면 추첨 대상에 다시 포함돼요.</p>
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
              {!ids.length && <p>고정 학생이 없으면 이 동아리는 0명으로 유지돼요.</p>}
            </details>}
          </section>;
        })}
      </div>
      <p>최소 인원은 배정 후 검토 기준이며, 최대 인원을 넘는 고정 명단은 저장할 수 없어요.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button className="primary" onClick={onSave}>설정 저장</Button>
    </DialogContent>
  </Dialog>;
}
