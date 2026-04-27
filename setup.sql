-- ============================================================
-- APEX SNIPER — Supabase Database Setup
-- Jalankan script ini di Supabase SQL Editor
-- ============================================================

-- 1. Buat tabel profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name    TEXT NOT NULL,
  phone        TEXT NOT NULL,
  email        TEXT NOT NULL,
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

-- 4. RLS Policies

-- User bisa lihat profil sendiri
CREATE POLICY "user_read_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- Admin bisa lihat semua profil
CREATE POLICY "admin_read_all" ON public.profiles
  FOR SELECT USING (public.is_admin());

-- User bisa insert profil sendiri saat register
CREATE POLICY "user_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Admin bisa update semua profil (verifikasi)
CREATE POLICY "admin_update_all" ON public.profiles
  FOR UPDATE USING (public.is_admin());

-- User bisa update profil sendiri (kecuali role & is_verified)
CREATE POLICY "user_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ============================================================
-- 5. Set Admin Role untuk akun daffa.akhlaric52@gmail.com
--    Jalankan setelah admin mendaftar lewat halaman register
-- ============================================================
UPDATE public.profiles
SET role = 'admin', is_verified = TRUE
WHERE email = 'daffa.akhlaric52@gmail.com';

-- ============================================================
-- SELESAI — Database siap digunakan
-- ============================================================
