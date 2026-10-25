# Stream B — Admin & Enrollment

Read `PHASE7_GLOBAL_RULES.md` first. This document only adds what's
specific to your assignment.

## The one thing that makes this stream easier than the other three

Checked directly against the real dependency graph: **zero circular
dependencies among these 29 files.** A clean order is genuinely possible
— where one of your files depends on another one of your files, convert
the dependency first and use a real `import`. You'll still need the
`window` fallback constantly for dependencies *outside* this list
(`state-manager.js`, `db-service.js`, etc. — Stream A's territory) —
that part is unavoidable and expected, per the global rules. Just don't
expect to need it much *within* your own 29.

`modules/admin/index.js` is already converted (`src/admin-index.js`) —
not in your list, don't touch it.

## File list — 29 files, in a computed order (should be a workable real sequence, not just a rough guess, given the zero-cycle finding above)

1. `modules/admin/sections-service.js`
2. `modules/admin/teacher-directory-service.js`
3. `modules/admin/dsm-manager.js`
4. `modules/admin/registrations-service.js`
5. `modules/admin/audit-log-service.js`
6. `modules/admin/system-health-service.js`
7. `modules/enrollment/enrollment-service.js`
8. `modules/admin/mascot-lines.js`
9. `modules/admin/starter-pack-service.js`
10. `modules/admin/teacher-invite-service.js`
11. `modules/admin/ownership-service.js`
12. `modules/admin/school-settings-service.js`
13. `modules/admin/sections_index.js`
14. `modules/enrollment/enrollment-hub.js`
15. `modules/admin/command-center.js`
16. `modules/admin/system-health.js`
17. `modules/section/my-section.js`
18. `modules/admin/quiz-builder.js`
19. `modules/admin/content-oversight-service.js`
20. `modules/admin/starter-pack-editor.js`
21. `modules/admin/school-settings.js`
22. `modules/admin/student-manager.js`
23. `modules/admin/registrations.js`
24. `modules/admin/sections.js`
25. `modules/admin/analytics.js`
26. `modules/admin/teacher-directory.js`
27. `modules/admin/audit-log.js`
28. `modules/admin/teacher-invite.js`
29. `modules/admin/content-oversight.js`
