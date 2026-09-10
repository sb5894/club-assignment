'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Club, Student, Result } from '@/lib/allocation';

type ClubDetailProps = {
  club: Club | undefined;
  clubs: Club[];
  students: Student[];
  result: Result | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ClubDetail({ club, clubs, students, result, open, onOpenChange }: ClubDetailProps) {
  const defaultTab = result ? 'assigned' : club?.allocationMode === 'fixed' ? 'fixed' : 'rank1';
  const context = { clubId: club?.id, defaultTab, open, result };
  const [selection, setSelection] = useState({ ...context, value: defaultTab });
  const contextChanged = selection.clubId !== club?.id || selection.defaultTab !== defaultTab || selection.open !== open || selection.result !== result;
  const activeTab = contextChanged ? defaultTab : selection.value;
  if (contextChanged) setSelection({ ...context, value: defaultTab });

  const clubName = (id: string | null | undefined) => clubs.find(item => item.id === id)?.name ?? (id ? '알 수 없는 동아리' : '미입력');
  const fixedIds = new Set(club?.fixedStudentIds ?? []);
  const tabs = [
    ...(result ? [{ value: 'assigned', label: '배정 명단', members: students.filter(student => result.placements[student.id]?.club === club?.id) }] : []),
    ...(!result && club?.allocationMode === 'fixed' ? [{ value: 'fixed', label: '고정 명단', members: students.filter(student => fixedIds.has(student.id)) }] : []),
    ...[1, 2, 3].map(rank => ({
      value: `rank${rank}`,
      label: `${rank}지망 신청자`,
      members: students.filter(student => student.choices[rank - 1] === club?.id),
    })),
  ];

  function placementLabel(student: Student) {
    const placement = result?.placements[student.id];
    if (!placement?.club) return '미배정';
    const method = placement.assignmentType === 'fixed'
      ? '명단 고정'
      : placement.rank === 0
        ? '교사 조정'
        : `${placement.rank}지망`;
    return `${clubName(placement.club)} · ${method}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="club-detail-dialog">
        <DialogTitle>{club?.name ?? '동아리'} 명단</DialogTitle>
        <DialogDescription>
          최소 {club?.min ?? 0}명 / 최대 {club?.max ?? 0}명
          {club?.allocationMode === 'fixed' && ' · 고정 학생 선배정 후 남은 정원은 지망별 배정'}
        </DialogDescription>
        {club && (
          <Tabs value={activeTab} onValueChange={value => setSelection({ ...context, value: String(value) })} className="club-detail-tabs min-w-0 gap-4">
            <div className="club-detail-tab-scroll overflow-x-auto pb-1">
              <TabsList className="club-detail-tab-list h-auto! min-h-10 w-max min-w-full" aria-label="동아리 명단 종류">
                {tabs.map(tab => (
                  <TabsTrigger key={tab.value} value={tab.value} className="px-3 py-2">
                    {tab.label} <span className="tabular-nums">{tab.members.length}명</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {tabs.map(tab => (
              <TabsContent key={tab.value} value={tab.value} className="club-detail-panel min-w-0">
                <div className="distribution">
                  {[5, 6].map(grade => (
                    <div key={grade}><span>{grade}학년</span><b>{tab.members.filter(student => student.grade === grade).length}명</b></div>
                  ))}
                  {['남', '여', '미입력'].map(gender => (
                    <div key={gender}><span>{gender}</span><b>{tab.members.filter(student => (student.gender || '미입력') === gender).length}명</b></div>
                  ))}
                </div>
                <p className="muted mb-3 text-xs">현재 탭의 학년·성별 분포예요. 분포는 우선 선발에 반영하지 않아요.</p>
                <p className="club-detail-legend mb-3 text-sm text-muted-foreground">
                  {tab.value === 'assigned'
                    ? '굵은 글씨는 실제 당첨된 지망이에요. 명단 고정·교사 조정 배정은 당첨 지망이 없어요.'
                    : tab.value === 'fixed'
                      ? '이 학생들은 추첨에서 제외하고 이 동아리로 배정해요.'
                      : '굵은 글씨는 이 동아리에 신청한 지망이에요.'}
                </p>
                <div className="club-detail-roster max-h-[45dvh] overflow-y-auto rounded-lg border">
                  <Table className="club-detail-table min-w-[680px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">학번</TableHead>
                        <TableHead scope="col">이름</TableHead>
                        <TableHead scope="col">성별</TableHead>
                        {[1, 2, 3].map(rank => <TableHead key={rank} scope="col">{rank}지망</TableHead>)}
                        {result && <TableHead scope="col">현재 배정</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tab.members.map(student => (
                        <TableRow key={student.id}>
                          <TableCell>{student.id}</TableCell>
                          <TableCell>{student.name}</TableCell>
                          <TableCell>{student.gender || '미입력'}</TableCell>
                          {[1, 2, 3].map(rank => {
                            const selected = tab.value === 'assigned'
                              ? result?.placements[student.id]?.rank === rank
                              : tab.value !== 'fixed' && student.choices[rank - 1] === club.id;
                            const name = clubName(student.choices[rank - 1]);
                            return <TableCell key={rank}>{selected ? <strong className="club-detail-matching-choice font-bold text-foreground">{name}</strong> : name}</TableCell>;
                          })}
                          {result && <TableCell>{placementLabel(student)}</TableCell>}
                        </TableRow>
                      ))}
                      {tab.members.length === 0 && (
                        <TableRow><TableCell colSpan={result ? 7 : 6} className="py-8 text-center text-muted-foreground">{tab.label}에 해당하는 학생이 없어요.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
