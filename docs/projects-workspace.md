# Projects workspace

The Projects landing screen is a private production directory. New projects are created in a modal through the existing project endpoint. The grid shows three columns on standard desktop screens, four on wide screens and fewer at smaller widths; a list view is available alongside immediate name search, workflow/archive filters and activity/name/volume/creation sorting. Navigation inset and view-toggle styling match the Image Library.

`GET /api/projects/directory` adds an authenticated, read-only projection. It reads at most 100 projects (the existing account quota) through the session's RLS client, with an explicit owner filter on every query. Per project it retrieves an exact ready, non-trashed image count using `library_project_id`, the newest such image, and the most recently updated saved processing operation. Four projects are inspected concurrently, with at most eight metadata queries in flight. The endpoint uses the existing account rate limiter (30 refreshes/minute), returns no storage keys or full operation settings, and is not cached.

Asset totals include active and archived projects but exclude unassigned files and the recovery bin. A failed metadata read is displayed as unavailable, never as zero. A failed directory read offers retry without presenting a misleading empty account. Refresh updates snapshots; no fabricated live stream or user/actor log is shown.

“Last production activity” is the latest project creation, stored photograph creation or saved operation update timestamp. Renames, archive actions and library moves have no persisted event timestamp in the existing schema and are not claimed as an audit log. The brand indicator reflects the latest operation's immutable brand snapshot, not a default project binding. Brand direction is configured per product edit. No project-default brand setting is added.

The per-project menu supports rename and archive/restore through the existing library governance endpoint, asset browsing with project filters, and bulk preparation for product projects. Bulk links carry a project query parameter; the existing bulk UI selects it only if present among authorized active projects. Preparing a batch never uploads or starts generation automatically. Archive requires explicit confirmation and does not delete images.

The exports dialog links to existing project pack results, batch history and private individual downloads. A full-project ZIP export is not available and is not simulated. Approved pack/batch ZIP authorization and limits remain unchanged.

This release adds no migrations or changes to authentication, OAuth, billing, processing contracts, quotas, image uploads, Brand Studio settings or provider funding.
