import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, check } from 'drizzle-orm/sqlite-core';

export const schoolState = sqliteTable('school_state', {
  id: integer('id').primaryKey(), phase: text('phase').notNull().default('setup'),
  revision: integer('revision').notNull().default(0), clubsJson: text('clubs_json').notNull(),
  resultJson: text('result_json'), lastOperationId: text('last_operation_id'), updatedAt: text('updated_at').notNull(),
}, t => [check('school_singleton', sql`${t.id} = 1`), check('school_phase', sql`${t.phase} IN ('setup','open','closed','allocated','final')`)]);
export const students = sqliteTable('students', {
  id: text('id').primaryKey(), grade: integer('grade').notNull(), classNo: integer('class_no').notNull(),
  number: integer('number').notNull(), name: text('name').notNull(), gender: text('gender').notNull(),
  codeHash: text('code_hash').notNull().unique(), codeVersion: integer('code_version').notNull().default(1), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('student_identity').on(t.grade,t.classNo,t.number)]);
export const applications = sqliteTable('applications', {
  studentId: text('student_id').primaryKey().references(()=>students.id), choicesJson: text('choices_json').notNull(),
  version: integer('version').notNull(), submittedAt: text('submitted_at').notNull(), verifiedAt: text('verified_at'), verifiedVersion: integer('verified_version'),
});
export const applicationRevisions = sqliteTable('application_revisions', {
  id: integer('id').primaryKey({autoIncrement:true}), studentId: text('student_id').notNull().references(()=>students.id),
  version: integer('version').notNull(), choicesJson: text('choices_json').notNull(), submittedAt: text('submitted_at').notNull(),
}, t=>[uniqueIndex('application_revision_version').on(t.studentId,t.version)]);
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(), role: text('role').notNull(), studentId: text('student_id').references(()=>students.id),
  credentialVersion: text('credential_version').notNull(), expiresAt: integer('expires_at').notNull(),
});
export const rateLimits = sqliteTable('rate_limits', { key:text('key').primaryKey(),attempts:integer('attempts').notNull(),expiresAt:integer('expires_at').notNull() });
export const operationLog = sqliteTable('operation_log', {
  id:integer('id').primaryKey({autoIncrement:true}),action:text('action').notNull(),actor:text('actor').notNull(),payloadJson:text('payload_json').notNull(),createdAt:text('created_at').notNull(),
});
