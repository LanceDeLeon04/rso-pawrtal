-- ============================================================
-- 056: Letter to Parent + auto-generated Reply Slip on Event Applications
-- ============================================================
-- Two new checkboxes on the Event Application form:
--   1. "Does this event require a Letter to Parent?" — if yes, the org
--      must attach that letter (handled as an ordinary conditionally-
--      required attachment, document_type = 'Letter to Parent', same
--      upload/validation path as 'Attachments Template').
--   2. Only shown once (1) is Yes: "Is a Reply Slip required?" — if
--      yes, a filled Reply Slip PDF is auto-generated from the event's
--      title/date/time and attached on submit (document_type =
--      'Reply Slip'), the same way the ACP Form is auto-generated —
--      see generateReplySlipPdf() in src/lib/replySlipPdf.js and its
--      call site in SubmissionBin.jsx's handleSubmitApp.
-- Both flags are stored so the reviewer-facing submission detail view
-- can show what was required without having to infer it from which
-- attachments happen to be present.
-- ============================================================

alter table submissions add column if not exists requires_parent_letter boolean not null default false;
alter table submissions add column if not exists requires_reply_slip boolean not null default false;

comment on column submissions.requires_parent_letter is
  'Event Application checkbox — does this activity require a Letter to Parent? If true, a "Letter to Parent" attachment is required on submit.';
comment on column submissions.requires_reply_slip is
  'Event Application checkbox (only meaningful when requires_parent_letter is true) — auto-generates and attaches a filled Reply Slip PDF on submit (document_type = ''Reply Slip'').';
