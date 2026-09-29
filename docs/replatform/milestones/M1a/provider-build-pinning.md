# M1a provider build selection

The keyed shipped-boot prepare step resolves the requested E2B template alias to
one ready template ID and immutable build UUID. It gives the adapter manager
`<template_id>:<build_uuid>` as its create selector. At worker boot it resolves
the alias again and refuses if either ID changed or the stored selector differs.
The existing per-sandbox provider event check still confirms the template and
build that actually ran.

E2B [documents direct build selection](https://docs.e2b.dev/template/tags#referencing-a-specific-build)
using this exact `Sandbox.create('<template>:<build_id>')` form. Its
[server-side template lookup](https://github.com/e2b-dev/runtime/blob/48772bf11820dbd46474bf5dcdd419c7119b864f/packages/db/queries/templates/get_template_with_build_by_tag.sql#L259-L275)
accepts a UUID in the tag position as a build ID. Assigning a new tag is not
required for this selector.

This prevents an alias or template ID from silently selecting a newer build
between prepare and create. The SDK receives the selector through its existing
`Sandbox.create(template, ...)` path. Keyless mode does not start the adapter
manager and continues to record no provider selector.

Selection alone does not approve the provider build's provenance, prove its
availability in the account, or satisfy M1a image admission. Those decisions
and a live keyed run remain separate prerequisites.
