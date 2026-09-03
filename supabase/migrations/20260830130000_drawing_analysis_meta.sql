-- ============================================================================
-- ArchFinish: structured detection metadata on drawings
--
-- Run once in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- Adds a JSONB `analysis_meta` column to `drawings` so the app can persist the
-- AI's structured detection results per drawing:
--   {
--     "label_count": 42,
--     "undetected_spaces": ["...", ...],   -- spaces the AI flagged as uncertain
--     "unmatched_labels": ["...", ...],    -- labels read but not matched to a room
--     "sweep_complete": true,
--     "finish_reason": "STOP"
--   }
--
-- This backs the "Not detected / needs verification" summary. The existing
-- `analysis_feedback` text column is left untouched (used as a fallback).
-- ============================================================================

ALTER TABLE public.drawings
  ADD COLUMN IF NOT EXISTS analysis_meta JSONB DEFAULT NULL;
