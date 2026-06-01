---
id: ftj-5umd
status: closed
deps: []
links: []
created: 2026-06-01T02:39:10Z
type: task
priority: 2
assignee: memgrafter
tags: [schemas, flatmachine]
---
# Update root flatmachine schema source

Schema updates should be made in the project-root flatmachine.d.ts source file; generated schema files under sdk/js/packages/flatmachines/schemas should not be edited directly. Move/reapply max_depth/depth schema changes to the root source and regenerate derived files.
