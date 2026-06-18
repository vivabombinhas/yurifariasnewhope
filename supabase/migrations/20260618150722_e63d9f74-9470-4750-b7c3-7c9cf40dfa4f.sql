ALTER TABLE public.publishing_jobs
  DROP CONSTRAINT publishing_jobs_action_check;

ALTER TABLE public.publishing_jobs
  ADD CONSTRAINT publishing_jobs_action_check
  CHECK (action IN ('publish', 'update', 'close', 'create_draft'));