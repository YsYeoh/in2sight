-- Plan 16a: "Auto" mode (follow the device's light or dark setting). Widens the CHECK list of profiles.mode only;
-- existing rows and every other column are untouched. The constraint name is Postgres' default for the inline column
-- check in 20261014000001_owner_and_profiles.sql. No IF EXISTS on purpose: a different name must fail loudly, not leave
-- the old check in place.
alter table public.profiles drop constraint profiles_mode_check;
alter table public.profiles add constraint profiles_mode_check check (mode in ('light', 'dark', 'auto'));
