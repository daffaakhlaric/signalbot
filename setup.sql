-- ============================================================
-- APEX SNIPER — Supabase Database Setup
-- Jalankan script ini di Supabase SQL Editor
-- ============================================================

-- 1. Buat tabel profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name    TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT 'user',
  is_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  rejected     BOOLEAN NOT NULL DEFAULT FALSE,
  reject_reason TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Helper function untuk cek apakah user adalah admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- 4. Trigger: auto-buat profil saat user register
--    Ini menghindari masalah RLS saat INSERT dari frontend
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, email, role, is_verified)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    NEW.email,
    'user',
    FALSE
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 5. RLS Policies
-- ============================================================

-- User bisa lihat profil sendiri
DROP POLICY IF EXISTS "user_read_own" ON public.profiles;
CREATE POLICY "user_read_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- Admin bisa lihat semua profil
DROP POLICY IF EXISTS "admin_read_all" ON public.profiles;
CREATE POLICY "admin_read_all" ON public.profiles
  FOR SELECT USING (public.is_admin());

-- Admin bisa update semua profil (verifikasi/tolak)
DROP POLICY IF EXISTS "admin_update_all" ON public.profiles;
CREATE POLICY "admin_update_all" ON public.profiles
  FOR UPDATE USING (public.is_admin());

-- User bisa update profil sendiri
DROP POLICY IF EXISTS "user_update_own" ON public.profiles;
CREATE POLICY "user_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ============================================================
-- 6. Set Admin Role untuk akun daffa.akhlaric52@gmail.com
--    Jalankan SETELAH admin mendaftar lewat halaman register
-- ============================================================
UPDATE public.profiles
SET role = 'admin', is_verified = TRUE
WHERE email = 'daffa.akhlaric52@gmail.com';

-- ============================================================
-- SELESAI — Database siap digunakan
-- ============================================================
