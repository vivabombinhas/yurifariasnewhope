ALTER TABLE public.publishing_jobs
  DROP CONSTRAINT IF EXISTS publishing_jobs_action_check;

ALTER TABLE public.publishing_jobs
  ADD CONSTRAINT publishing_jobs_action_check
  CHECK (
    action IN (
      'publish',
      'update',
      'close',
      'create_draft',
      'sync_sale',
      'sync_sale_unmatched',
      'sync_sale_error'
    )
  );

COMMENT ON CONSTRAINT publishing_jobs_action_check ON public.publishing_jobs IS
  'Allows publishing lifecycle jobs and eBay sales synchronization audit entries.';
