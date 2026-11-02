# Hospital Overload — Phase 5 Speaker Script

## Slide 1 — Hospital Overload Phase 5

Phase 5 takes the research question from the earlier phases and puts it into a practical local tool. It helps a person find nearby hospitals and urgent care, compare travel, and see only the public information that can be verified at the time of a search.

## Slide 2 — The real problem is access under uncertainty

People need to decide where to seek care when they have limited information. A nearby facility is not automatically the best option, and public data does not tell us live ER intake or bed availability. The product must make that uncertainty visible instead of hiding it.

## Slide 3 — What Phase 1 modeled

Phase 1 described hospital strain with predicted load divided by staffed capacity. Predicted load adds current occupied beds, expected admissions, and referrals, then subtracts expected discharges. It is a useful systems model, but it needs facility-level operational inputs.

## Slide 4 — Why Phase 5 does not pretend that model is live

The open sources available to the public do not provide a reliable, current hospital-by-hospital feed for ER intake, occupancy, or admissions. That means Phase 5 does not label an ER less crowded, faster, or able to admit a patient without direct evidence.

## Slide 5 — A fresh lookup happens on every action

When someone submits or changes a ZIP code, the application resolves the ZIP, discovers nearby hospitals and urgent-care locations, and retrieves fresh road routing. A facility detail click performs a new official-record lookup. Search results are not cached as a facility database.

## Slide 6 — Urgent care is included, with its own limits

Urgent care expands the choices for non-life-threatening concerns. The tool makes clear that a listing cannot confirm walk-in hours, insurance, treatment scope, or a current queue. The only safe claim without a direct source is location and route information.

## Slide 7 — The recommender uses a limited access score

For hospitals that return a verified CMS record and a historical ED throughput measure, the app calculates an access score. It weights current travel at sixty-five percent and the CMS historical ED measure at thirty-five percent. Lower scores compare more favorably. The score is not a predicted wait or admission time.

## Slide 8 — “Referral only” is a feature, not a failure

If CMS does not return a clear record or throughput measure, the facility remains visible as a referral option. It is not ranked. This prevents missing data from becoming an invented number and gives the user a useful nearby option without false precision.

## Slide 9 — Every facility can expose its evidence

The facility page can show CMS Care Compare information, the CMS NPPES public registry record, NPI, taxonomy, address, phone, update date, and any dated historical ED measure returned. When a source does not match, the page explicitly says no information was returned.

## Slide 10 — The recommendation is transparent, not clinical

The key rule is simple: for life-threatening symptoms, call 911. For all other use cases, the app gives a conservative care prompt, a fresh route comparison, and evidence links. It does not diagnose, confirm care capability, or delay emergency care.

## Slide 11 — The next research step

The Phase 1 model becomes clinically useful only with authorized, real-time operational data from health systems or a public agency. Until then, Phase 5 is a transparent navigation and evidence layer that respects the boundary between public data and real-time clinical operations.
