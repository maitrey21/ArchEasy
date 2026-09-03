-- ============================================================
-- ArchFinish base schema setup for a NEW Supabase project
-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor)
--
-- IMPORTANT: after running this, also run
--   supabase/migrations/20260830120000_multi_floor_and_recommendations.sql
-- which adds multi-floor support (floors table, floor_id columns),
-- room bounding boxes, and the AI material recommendations table.
-- Combines migrations:
--   20260210144346_b4c0035c-643a-49b8-bb38-f5489373a27c.sql
--   20260403065942_23bd8e64-eb71-40dc-a755-513b3599b8de.sql
--   20260403075022_dc6c9869-2ab2-4fb1-80a1-26221ca9c583.sql
-- ============================================================

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Projects table
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects" ON public.projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own projects" ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own projects" ON public.projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own projects" ON public.projects FOR DELETE USING (auth.uid() = user_id);

-- Drawings table
CREATE TABLE IF NOT EXISTS public.drawings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size BIGINT DEFAULT 0,
  analysis_status TEXT NOT NULL DEFAULT 'pending',
  analysis_feedback TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.drawings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own drawings" ON public.drawings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own drawings" ON public.drawings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own drawings" ON public.drawings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own drawings" ON public.drawings FOR DELETE USING (auth.uid() = user_id);

-- Rooms table
CREATE TABLE IF NOT EXISTS public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drawing_id UUID REFERENCES public.drawings(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'Unnamed Room',
  room_type TEXT DEFAULT 'general',
  area NUMERIC,
  area_unit TEXT DEFAULT 'sq ft',
  dimensions JSONB DEFAULT '{}',
  wall_finish TEXT DEFAULT '',
  floor_finish TEXT DEFAULT '',
  ceiling_finish TEXT DEFAULT '',
  ceiling_height NUMERIC,
  skirting TEXT DEFAULT '',
  dado TEXT DEFAULT '',
  paint_color TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  floor_level TEXT DEFAULT '',
  space_tag TEXT DEFAULT '',
  flooring_size TEXT DEFAULT '',
  flooring_finish TEXT DEFAULT '',
  flooring_code TEXT DEFAULT '',
  flooring_make TEXT DEFAULT '',
  flooring_rate TEXT DEFAULT '',
  skirting_code TEXT DEFAULT '',
  skirting_make TEXT DEFAULT '',
  skirting_rate TEXT DEFAULT '',
  ceiling_material_2 TEXT DEFAULT '',
  ceiling_size TEXT DEFAULT '',
  ceiling_code TEXT DEFAULT '',
  ceiling_make TEXT DEFAULT '',
  ceiling_rate TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own rooms" ON public.rooms FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own rooms" ON public.rooms FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own rooms" ON public.rooms FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own rooms" ON public.rooms FOR DELETE USING (auth.uid() = user_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_projects_updated_at ON public.projects;
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_rooms_updated_at ON public.rooms;
CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for drawings
INSERT INTO storage.buckets (id, name, public)
VALUES ('drawings', 'drawings', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can upload drawings" ON storage.objects;
CREATE POLICY "Users can upload drawings" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'drawings' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can view own drawings" ON storage.objects;
CREATE POLICY "Users can view own drawings" ON storage.objects FOR SELECT USING (bucket_id = 'drawings' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can delete own drawings" ON storage.objects;
CREATE POLICY "Users can delete own drawings" ON storage.objects FOR DELETE USING (bucket_id = 'drawings' AND auth.uid()::text = (storage.foldername(name))[1]);
