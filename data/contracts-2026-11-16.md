# Contract register update — November 16, 2026

The CSV contains all 68 contracts supplied by Emily: 57 active, 10 ended, and one upcoming as of November 16, 2026. Date ranges include both endpoints. 3774W starts November 23; 3773V, 3773G, 378A5, 378L7, and 378M8 ended November 13.

Run `supabase/contract_register_2026_11_16.sql` as postgres in Supabase SQL Editor to update the existing shared `contract_supervisors` metadata. The transaction upserts only the supplied contract numbers. It preserves prior contract metadata in the private `dt_contract_internal.register_revisions` audit log and does not delete anything, change contracts absent from the list, or touch payroll, fuel, loads, rates, upload history, or dated supervisor assignments. Re-running it is safe. West Virginia spelling and extra name spacing have been cleaned up.

## Installed behavior

After the register update, run `supabase/payroll_contract_discovery.sql`. Its database trigger registers new five-character USPS contract numbers whenever a payroll is inserted or its summary is updated, and backfills identities from saved payrolls. It reuses existing identities despite leading zeros, keeps special system departments out of the contract register, leaves missing supervisor/region/term details for review, and never reactivates an existing ended contract. Contract options include the register plus uploaded loads, with leading-zero aliases combined. Payroll parsing, grouping, comparison and saved-row matching already normalize these aliases. Existing screens may still list ended contracts; historical reports must continue to include their actual activity. `active` is refreshed from the America/New_York business date for the supplied register whenever payroll is saved, so upcoming contracts can activate after their start and ended contracts remain inactive. It is not a scheduled midnight job.

Keep contract-term dates separate from supervisor assignment dates. The supplied current supervisor names must not overwrite dated history, including the Tony Smith to Austin Carl change on August 1, 2026. Any supervisor changes need their own effective dates before historical assignments are altered.

## Live verification — November 16, 2026

Both migrations were applied to the DT Operations Hub Supabase project. All 68 supplied contracts match their dates: 57 active, 10 ended, one upcoming. Preserved 58 prior contract metadata records. Backfilled one payroll-only identity, 30512, with missing details marked for review. No canonical duplicates remain in the register.

Verified an authenticated payroll INSERT and repeated UPDATE in a rolled-back transaction: padded/new identity registered once, existing padded contract reused, ended 3773V stayed inactive, upcoming 3774W stayed inactive before November 23, and all verification fixtures rolled back. SQL parsing and the actual TypeScript normalizer also passed, including combined hours and special system departments.

Preservation checks before/after: all 11 saved payroll rows have an identical aggregate content hash and total 46,688,790 hundredths; 213,173 fuel records and total cost 23,279,986.05 unchanged; 389,737 loads, 1,358,064 stops and 104,351 missed stops unchanged; all 32 dated supervisor assignment rows have an identical aggregate content hash. No screens or calculations were edited.

Security checks: private audit/trigger schema is inaccessible to anon/authenticated, private registration helper is not directly callable, trigger checks payroll authorization, and function search paths are fixed. Advisor review found no new security warning/error from this change; the private audit table intentionally has RLS enabled without client policies. Pre-existing unrelated advisor findings were left unchanged, as requested.
