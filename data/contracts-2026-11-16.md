# Contract register update — November 16, 2026

The CSV contains all 68 contracts supplied by Emily: 57 active, 10 ended, and one upcoming as of November 16, 2026. Date ranges include both endpoints. 3774W starts November 23; 3773V, 3773G, 378A5, 378L7, and 378M8 ended November 13.

Run `supabase/contract_register_2026_11_16.sql` as postgres in Supabase SQL Editor to update the existing shared `contract_supervisors` metadata. The transaction upserts only the supplied contract numbers. It does not delete anything, change contracts absent from the list, or touch payroll, fuel, loads, rates, upload history, or dated supervisor assignments. Re-running it is safe. West Virginia spelling and extra name spacing have been cleaned up.

## Outstanding integration work

After the register update, run `supabase/payroll_contract_discovery.sql`. Its database trigger registers new five-character USPS contract numbers whenever a payroll is inserted or its summary is updated, and backfills identities from saved payrolls. It reuses existing identities despite leading zeros, keeps special system departments out of the contract register, leaves missing supervisor/region/term details for review, and never reactivates an existing ended contract. Contract options include the register plus uploaded loads, with leading-zero aliases combined. Payroll parsing, grouping, comparison and saved-row matching already normalize these aliases. Existing screens may still list ended contracts; historical reports must continue to include their actual activity. `active` is a snapshot at execution, not a scheduled lifecycle transition.

Keep contract-term dates separate from supervisor assignment dates. The supplied current supervisor names must not overwrite dated history, including the Tony Smith to Austin Carl change on August 1, 2026. Any supervisor changes need their own effective dates before historical assignments are altered.

Validation: 68 unique contract numbers; all 68 date ranges valid; status counts checked against November 16, 2026. Live database execution and cross-module verification are pending. SQL parsing is checked separately; no live database result is claimed.
