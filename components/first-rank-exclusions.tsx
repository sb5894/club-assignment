'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { PortalState } from '@/lib/portal-types';

export function FirstRankExclusions({state,busy,onSave}:{state:PortalState;busy:boolean;onSave:(clubId:string,studentIds:string[],revision:number)=>Promise<boolean>}) {
  const [open,setOpen]=useState(false),[clubId,setClubId]=useState(''),[ids,setIds]=useState<string[]>([]);
  const [query,setQuery]=useState(''),[revision,setRevision]=useState(0),[review,setReview]=useState(false),[error,setError]=useState('');
  const locked=!!state.result||!['setup','open','closed'].includes(state.phase);
  const club=state.clubs.find(c=>c.id===clubId);
  const original=club?.firstRankExcludedStudentIds??[];
  const changes=state.students.filter(s=>ids.includes(s.id)!==original.includes(s.id));
  const selectClub=(id:string)=>{setClubId(id);setIds([...(state.clubs.find(c=>c.id===id)?.firstRankExcludedStudentIds??[])]);setQuery('');setReview(false);setError('');};
  return <>
    <Button variant="outline" disabled={busy} onClick={()=>{selectClub(state.clubs[0]?.id??'');setRevision(state.revision);setOpen(true);}}>1지망 제외 설정</Button>
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="club-settings-dialog">
      <DialogTitle>동아리별 1지망 제외 설정</DialogTitle>
      <DialogDescription>지정한 학생은 선택한 동아리의 1지망 추첨에서만 제외해요. 신청 내용은 그대로 보존하고 2·3지망은 정상 참여해요. 같은 동아리의 고정 배정과 중복 지정할 수 없어요.</DialogDescription>
      {locked&&<p>1지망 배정이 이미 끝났어요. 제외 명단은 조회만 가능하며, 기존 배정 결과는 바꾸지 않아요.</p>}
      <label className="field-label">대상 동아리<select aria-label="대상 동아리" className="picker" value={clubId} disabled={busy} onChange={e=>selectClub(e.target.value)}>{state.clubs.map(c=><option key={c.id} value={c.id}>{c.name} · 제외 {c.firstRankExcludedStudentIds?.length??0}명</option>)}</select></label>
      <label className="field-label">학생 검색<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="이름 또는 학년-반-번호"/></label>
      <p>선택 {ids.length}명 · 현재 이 동아리를 1지망으로 신청한 제외 대상 {state.students.filter(s=>ids.includes(s.id)&&s.choices[0]===clubId).length}명</p>
      <div className="fixed-candidates max-h-[35dvh] overflow-y-auto">{state.students.filter(s=>(s.id+' '+s.name).includes(query.trim())).map(student=>{
        const fixed=club?.allocationMode==='fixed'&&club.fixedStudentIds?.includes(student.id);
        return <label className="fixed-candidate" key={student.id}><Checkbox checked={ids.includes(student.id)} disabled={busy||locked||!!fixed} onCheckedChange={checked=>{setIds(checked?[...ids,student.id]:ids.filter(id=>id!==student.id));setReview(false);}}/><span>{student.id} · {student.name}</span><small>{fixed?'이 동아리 고정 배정':student.choices[0]===clubId?'현재 1지망 신청자':'현재 1지망 신청 아님'}</small></label>;
      })}</div>
      {review&&<section aria-label="1지망 제외 변경 확인" className="max-h-40 overflow-y-auto"><h3>변경 대상 {changes.length}명</h3>{changes.map(s=><p key={s.id}>{s.id} · {s.name}: {ids.includes(s.id)?'1지망 제외 추가':'1지망 제외 해제'}</p>)}<p>{club?.name}의 1지망에만 적용해요. 2·3지망은 제외하지 않아요.</p></section>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      {!locked&&<Button className="primary" disabled={busy||!changes.length} onClick={async()=>{if(!review){setReview(true);return;}if(await onSave(clubId,ids,revision))setOpen(false);else setError('저장하지 못했어요. 화면의 오류를 확인하고 설정을 닫은 뒤 다시 열어 주세요.');}}>{busy?'저장 중…':review?'변경 확인 · 제외 명단 저장':'제외 변경 대상 확인'}</Button>}
    </DialogContent></Dialog>
  </>;
}
