'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { clubRoundDone, completedRank } from '@/lib/allocation';
import type { PortalState } from '@/lib/portal-types';

type Selection = { clubId: string; rank: number; seats: number; revision: number; candidates: number };

export function ClubRoundAllocation({ state, busy, onExecute }: {
  state: PortalState;
  busy: boolean;
  onExecute: (selection: Selection) => Promise<boolean>;
}) {
  const [counts, setCounts] = useState<Record<string,string>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const { result, clubs, students, revision, phase } = state;
  if(!result) return null;
  const finished = completedRank(result);
  const locked = phase === 'final';
  const fixedIds = new Set(clubs.filter(c=>c.allocationMode==='fixed').flatMap(c=>c.fixedStudentIds??[]));
  const current = finished + 1;
  const processed = clubs.filter(c=>clubRoundDone(result,current,c.id)).length;
  const selectedClub = clubs.find(c=>c.id===selection?.clubId);
  return <section className="panel club-round-panel" id="club-round-allocation">
    <div className="panel-heading"><div>
      <h2>동아리별 2·3지망 배정</h2>
      <p>{finished<3 ? `${current}지망 처리 ${processed} / ${clubs.length}개 동아리` : '모든 동아리의 3지망까지 처리했어요.'}</p>
      <p>동아리마다 이번 지망에서 뽑을 최대 인원을 입력하고 실행해요. 전체 2지망 처리가 끝나면 3지망을 실행할 수 있어요.</p>
    </div></div>
    <p className="club-round-help">기존 배정은 유지하고 현재 미배정 신청자만 추첨해요. 대상자가 적으면 입력한 인원보다 적게 배정될 수 있어요. 배정하지 않을 동아리도 ‘0명·건너뛰기’를 눌러 단계를 마쳐 주세요. 입력만 한 인원은 저장되지 않고, 실행한 인원과 결과는 저장돼요.</p>
    <div className="club-round-grid">{clubs.map(club=>{
      const occupied = Object.values(result.placements).filter(p=>p.club===club.id).length;
      const remaining = Math.max(0,club.max-occupied);
      return <article className="club-round-card" key={club.id} aria-label={`${club.name} 지망별 배정`}>
        <h3>{club.name}</h3><p>현재 {occupied} / {club.max}명 · 남은 정원 {remaining}명</p>
        {[2,3].map(rank=>{
          const done = clubRoundDone(result,rank,club.id);
          const round = result.rounds.find(r=>r.rank===rank&&r.club===club.id);
          const candidates = students.filter(s=>s.applicationVersion>0&&!fixedIds.has(s.id)&&!result.placements[s.id]?.club&&s.choices[rank-1]===club.id).length;
          const key = `${club.id}:${rank}`, value = counts[key] ?? '';
          const seats = Number(value);
          const valid = /^\d+$/.test(value)&&Number.isSafeInteger(seats)&&seats<=remaining;
          const available = !locked&&!busy&&!done&&rank===current;
          return <div className="club-round-step" key={rank}>
            <div className="club-round-step-heading"><b>{rank}지망</b><span>{done ? '처리 완료' : rank===current ? '진행 가능' : '전체 2지망 완료 후 실행'}</span></div>
            {done ? <p>{round ? `지정 ${round.seats}명 · 추첨 ${round.winners.length}명${round.seats===0 ? ' (건너뜀)' : ''}` : '기존 배정 완료'}<small>추첨 당시 인원이며 이후 교사 조정과 다를 수 있어요.</small></p> : <>
              <p>현재 추첨 대상 {candidates}명{rank!==current ? ' (이전 단계 진행에 따라 달라져요)' : ''}</p>
              <label className="club-round-input">배정 인원<input aria-label={`${club.name} ${rank}지망 배정 인원`} type="number" min={0} max={remaining} step={1} placeholder={`0~${remaining}`} value={value} disabled={locked||busy} onChange={event=>setCounts({...counts,[key]:event.target.value})} aria-invalid={value!==''&&!valid}/><span>명</span></label>
              {value!==''&&!valid&&<p className="form-error">0~{remaining}명 사이의 정수로 입력해 주세요.</p>}
              <div className="club-round-actions">
                <Button variant="outline" disabled={!available||!valid} onClick={()=>setSelection({clubId:club.id,rank,seats,revision,candidates})}>{rank}지망 배정</Button>
                <Button variant="ghost" disabled={!available} onClick={()=>setSelection({clubId:club.id,rank,seats:0,revision,candidates})}>0명·건너뛰기</Button>
              </div>
            </>}
          </div>;
        })}
      </article>;
    })}</div>
    <AlertDialog open={!!selection} onOpenChange={open=>{if(!open&&!busy)setSelection(null);}}><AlertDialogContent>
      <AlertDialogTitle>{selectedClub?.name} {selection?.rank}지망 {selection?.seats===0 ? '건너뛰기' : '배정 확인'}</AlertDialogTitle>
      <AlertDialogDescription>{selection?.seats===0 ? '이번 지망에서는 이 동아리에 학생을 배정하지 않고 처리 완료로 기록해요.' : `현재 대상 ${selection?.candidates}명 중 최대 ${selection?.seats}명을 추첨해요. 실제 배정 예정 인원은 ${Math.min(selection?.seats??0,selection?.candidates??0)}명이에요.`} 기존 배정은 유지되며, 처리한 동아리의 같은 지망은 다시 실행할 수 없어요.</AlertDialogDescription>
      {selection&&selection.revision!==revision&&<p className="form-error">현황이 변경됐어요. 취소한 뒤 최신 인원으로 다시 확인해 주세요.</p>}
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>취소</AlertDialogCancel><AlertDialogAction disabled={busy||selection?.revision!==revision} onClick={async()=>{if(selection){const target=selection;setSelection(null);await onExecute(target);}}}>{selection?.seats===0 ? '0명으로 처리' : '확인 후 배정'}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
  </section>;
}
