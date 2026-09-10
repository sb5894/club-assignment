import type { Phase } from '../portal-types';
export class StoreError extends Error {
  status:number;
  constructor(message:string, status=400) { super(message); this.name='StoreError'; this.status=status; }
}
export type SchoolRow = { id:number; phase:Phase; revision:number; clubs_json:string; result_json:string|null; last_operation_id:string|null; updated_at:string };
export type StudentRow = { id:string; grade:number; class_no:number; number:number; name:string; gender:string; choices_json:string|null; version:number|null; submitted_at:string|null; verified_at:string|null; verified_version:number|null };
export type AuditEntry = { id:number; action:string; actor:string; payload:unknown; createdAt:string };
