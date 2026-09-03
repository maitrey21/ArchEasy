-- ============================================================================
-- ArchFinish upgrade: multi-floor support + AI material recommendations
--
-- Run once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- This script is idempotent: safe to re-run.
--
-- What it does:
--   1. Adds a `floors` table so a project can hold Ground/First/Second/... floors
--   2. Adds floor_id to `drawings` and `rooms` (each floor owns its own
--      drawing, rooms, finishes and therefore its own SOF)
--   3. Adds `bbox` to `rooms` so the drawing viewer can highlight/annotate
--      detected rooms on top of the image
--   4. Adds a `room_recommendations` table for AI material recommendations
--      with Budget/Standard/Premium alternatives and accept/reject/edit state
--   5. Backfills a "Ground Floor" for every existing project and attaches
--      existing drawings/rooms to it, so current data keeps working
--
-- NOTE: the existing SOF columns on `rooms` (including the text `floor_level`
-- column used by the schedule/export logic) are left untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Shared trigger function (also created by setup.sql; repeated here so this
--    migration can run standalone).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ---------------------------------------------------------------------------
-- 1. floors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.floors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'Ground Floor',
  level_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS floors_project_id_idx ON public.floors (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS floors_project_name_key ON public.floors (project_id, name);

ALTER TABLE public.floors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own floors" ON public.floors;
CREATE POLICY "Users can view own floors" ON public.floors
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own floors" ON public.floors;
CREATE POLICY "Users can create own floors" ON public.floors
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own floors" ON public.floors;
CREATE POLICY "Users can update own floors" ON public.floors
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own floors" ON public.floors;
CREATE POLICY "Users can delete own floors" ON public.floors
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_floors_updated_at ON public.floors;
CREATE TRIGGER update_floors_updated_at
  BEFORE UPDATE ON public.floors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 2. floor_id on drawings + rooms
-- ---------------------------------------------------------------------------
ALTER TABLE public.drawings
  ADD COLUMN IF NOT EXISTS floor_id UUID REFERENCES public.floors(id) ON DELETE CASCADE;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS floor_id UUID REFERENCES public.floors(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS drawings_floor_id_idx ON public.drawings (floor_id);
CREATE INDEX IF NOT EXISTS rooms_floor_id_idx ON public.rooms (floor_id);

-- ---------------------------------------------------------------------------
-- 3. bbox on rooms (normalised 0-1000 [ymin, xmin, ymax, xmax], Gemini convention)
--    Used by the drawing viewer to draw highlight/annotation overlays.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS bbox JSONB DEFAULT NULL;

-- ---------------------------------------------------------------------------
-- 4. room_recommendations
--    One row per (room, element). `alternatives` holds the Budget/Standard/
--    Premium options as a JSON array.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.room_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.rooms(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  floor_id UUID REFERENCES public.floors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,

  -- which building element this recommendation is for
  element TEXT NOT NULL DEFAULT 'floor',           -- floor | wall | ceiling

  detected_finish TEXT DEFAULT '',                  -- what detection produced
  recommended_finish TEXT DEFAULT '',               -- what the AI suggests instead
  rationale TEXT DEFAULT '',                        -- why (durability, moisture, cost...)

  -- scoring the AI reasoned about, kept for transparency in the UI
  durability TEXT DEFAULT '',
  maintenance TEXT DEFAULT '',
  moisture_resistance TEXT DEFAULT '',
  slip_resistance TEXT DEFAULT '',
  cost_band TEXT DEFAULT '',

  -- [{ tier, material, make, finish, approx_rate, rationale }, ...]
  alternatives JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- architect decision workflow
  status TEXT NOT NULL DEFAULT 'pending',           -- pending | accepted | rejected | edited
  selected_tier TEXT DEFAULT '',                    -- Budget | Standard | Premium
  final_finish TEXT DEFAULT '',                     -- value applied after accept/edit
  ai_generated BOOLEAN NOT NULL DEFAULT true,
  model TEXT DEFAULT '',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS room_recommendations_room_id_idx ON public.room_recommendations (room_id);
CREATE INDEX IF NOT EXISTS room_recommendations_project_id_idx ON public.room_recommendations (project_id);
CREATE INDEX IF NOT EXISTS room_recommendations_floor_id_idx ON public.room_recommendations (floor_id);
CREATE UNIQUE INDEX IF NOT EXISTS room_recommendations_room_element_key
  ON public.room_recommendations (room_id, element);

ALTER TABLE public.room_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own recommendations" ON public.room_recommendations;
CREATE POLICY "Users can view own recommendations" ON public.room_recommendations
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own recommendations" ON public.room_recommendations;
CREATE POLICY "Users can create own recommendations" ON public.room_recommendations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own recommendations" ON public.room_recommendations;
CREATE POLICY "Users can update own recommendations" ON public.room_recommendations
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own recommendations" ON public.room_recommendations;
CREATE POLICY "Users can delete own recommendations" ON public.room_recommendations
  FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_room_recommendations_updated_at ON public.room_recommendations;
CREATE TRIGGER update_room_recommendations_updated_at
  BEFORE UPDATE ON public.room_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 5. Backfill: give every existing project a Ground Floor and attach
--    orphaned drawings/rooms to it so nothing breaks after the upgrade.
-- ---------------------------------------------------------------------------
INSERT INTO public.floors (project_id, user_id, name, level_index)
SELECT p.id, p.user_id, 'Ground Floor', 0
FROM public.projects p
WHERE NOT EXISTS (
  SELECT 1 FROM public.floors f WHERE f.project_id = p.id
);

UPDATE public.drawings d
SET floor_id = f.id
FROM public.floors f
WHERE d.floor_id IS NULL
  AND f.project_id = d.project_id
  AND f.level_index = 0;

UPDATE public.rooms r
SET floor_id = f.id
FROM public.floors f
WHERE r.floor_id IS NULL
  AND f.project_id = r.project_id
  AND f.level_index = 0;
