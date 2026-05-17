-- Seed data (spec §22) + owner placeholder profile for mit@ddc2.com.

insert into crew_roles (name, sort_order) values
  ('Incident Lead', 10),
  ('Rescue Crew', 20),
  ('Truck Driver', 30),
  ('Medical/First Aid', 40),
  ('Tow/Recovery', 50)
on conflict (name) do nothing;

insert into qualifications (name) values
  ('Fire Suppression'),
  ('Extrication'),
  ('First Aid'),
  ('Medical'),
  ('Tow/Recovery'),
  ('Driver')
on conflict (name) do nothing;

-- Owner is auto-provisioned on first magic-link sign-in via the
-- on_auth_user_created trigger (see 0001_initial_schema.sql). The bootstrap
-- email list lives in public.owner_emails — already seeded with mit@ddc2.com.
