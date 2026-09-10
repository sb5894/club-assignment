import type { Club, Result, Student, Placement } from './allocation';

export type Phase = 'setup' | 'open' | 'closed' | 'allocated' | 'final';
export type RosterStudent = Student & {
  submittedAt: string | null;
  applicationVersion: number;
  verifiedAt: string | null;
  verifiedVersion: number | null;
};
export type PortalState = {
  phase: Phase;
  revision: number;
  clubs: Club[];
  students: RosterStudent[];
  result: Result | null;
};
export type StudentState = {
  phase: Phase;
  clubs: Club[];
  student: RosterStudent;
  placement: Placement | null;
};
export type ApplicationRevision = {
  id: number;
  studentId: string;
  version: number;
  choices: string[];
  submittedAt: string;
};
export type RosterInput = Omit<Student, 'choices' | 'id'>;
export type IssuedCode = { id: string; name: string; code: string };
export type ApiError = { error: string; code?: string };
