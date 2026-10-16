import type { Sql } from "postgres";

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** All mutations are visible to the real startup pools; each is restored before another begins. */
export async function sweepAclGrantOptions(input: {
  admin: Sql;
  relations: readonly string[];
  signal: AbortSignal;
  captureFailure(): Promise<unknown>;
}): Promise<string[]> {
  const { admin, signal } = input;
  const accepted: string[] = [];
  signal.throwIfAborted();
  // Restoration below relies on a healthy baseline, where serving roles never have grant
  // options. Refuse a dirty fixture before its first mutation instead of erasing prior ACLs.
  const grantable = await admin`
    SELECT 1 FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
    CROSS JOIN LATERAL (
      SELECT * FROM aclexplode(relation.relacl)
      UNION ALL SELECT * FROM aclexplode(attribute.attacl)
    ) acl
    JOIN pg_roles grantee ON grantee.oid = acl.grantee
    WHERE namespace.nspname = 'public' AND relation.relname = ANY(${input.relations}::text[])
      AND grantee.rolname IN ('aoa_app', 'aoa_operator') AND acl.is_grantable
    LIMIT 1`;
  signal.throwIfAborted();
  if (grantable.length > 0) throw new Error("ACL sweep requires a healthy fixture without serving-role grant options");
  for (const relation of input.relations) {
    signal.throwIfAborted();
    const [access] = await admin<{ app: boolean; operator: boolean }[]>`
      SELECT has_table_privilege('aoa_app', ${`public.${relation}`}, 'SELECT') AS app,
        has_table_privilege('aoa_operator', ${`public.${relation}`}, 'SELECT') AS operator`;
    signal.throwIfAborted();
    const tableRoles = [
      ...(access?.app ? ["aoa_app"] : []),
      ...(access?.operator ? ["aoa_operator"] : []),
    ];
    for (const role of tableRoles) {
      signal.throwIfAborted();
      try {
        await admin.unsafe(`GRANT SELECT ON TABLE ${quote(relation)} TO ${role} WITH GRANT OPTION`);
        signal.throwIfAborted();
        if (await input.captureFailure() === undefined) accepted.push(`${relation}:${role}:relacl`);
      } finally {
        // Cleanup deliberately ignores cancellation: teardown must wait for the original ACL.
        await admin.unsafe(`REVOKE GRANT OPTION FOR SELECT ON TABLE ${quote(relation)} FROM ${role}`);
      }
    }
    signal.throwIfAborted();
    const columns = await admin<{ column_name: string; app: boolean; operator: boolean }[]>`
      SELECT attribute.attname AS column_name,
        has_column_privilege('aoa_app', relation.oid, attribute.attnum, 'SELECT') AS app,
        has_column_privilege('aoa_operator', relation.oid, attribute.attnum, 'SELECT') AS operator
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
      WHERE namespace.nspname = 'public' AND relation.relname = ${relation}
        AND relation.relkind = 'r' AND attribute.attnum > 0 AND NOT attribute.attisdropped
      ORDER BY attribute.attnum`;
    for (const column of columns) {
      signal.throwIfAborted();
      const columnRoles = [
        ...(column.app ? ["aoa_app"] : []),
        ...(column.operator ? ["aoa_operator"] : []),
      ];
      // A column with no SELECT grant still gets the historical app-role probe,
      // so the startup API must reject a newly granted select+grant-option tuple.
      if (columnRoles.length === 0) columnRoles.push("aoa_app");

      for (const columnRole of columnRoles) {
        signal.throwIfAborted();
        const [prior] = await admin<{ explicit_select: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_class relation
            JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
            JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
            CROSS JOIN LATERAL aclexplode(attribute.attacl) acl
            LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
            WHERE namespace.nspname = 'public' AND relation.relname = ${relation}
              AND attribute.attname = ${column.column_name}
              AND grantee.rolname = ${columnRole} AND acl.privilege_type = 'SELECT'
          ) AS explicit_select`;
        signal.throwIfAborted();
        try {
          await admin.unsafe(`GRANT SELECT (${quote(column.column_name)}) ON ${quote(relation)} TO ${columnRole} WITH GRANT OPTION`);
          signal.throwIfAborted();
          if (await input.captureFailure() === undefined) {
            accepted.push(`${relation}.${column.column_name}:${columnRole}:attacl`);
          }
        } finally {
          await admin.unsafe(`REVOKE SELECT (${quote(column.column_name)}) ON ${quote(relation)} FROM ${columnRole}`);
          if (prior?.explicit_select) {
            await admin.unsafe(`GRANT SELECT (${quote(column.column_name)}) ON ${quote(relation)} TO ${columnRole}`);
          }
        }
      }
    }
  }
  signal.throwIfAborted();
  return accepted;
}

/** Compare privileges, role posture, schema ownership and relation/column ownership after abort. */
export async function aclFixtureSnapshot(admin: Sql): Promise<unknown> {
  const relations = await admin`
    SELECT namespace.nspname, relation.relname, relation.relowner,
      CASE WHEN relation.relacl IS NULL THEN NULL ELSE
        ARRAY(SELECT entry::text FROM unnest(relation.relacl) entry ORDER BY entry::text) END AS relacl,
      attribute.attname,
      CASE WHEN attribute.attacl IS NULL THEN NULL ELSE
        ARRAY(SELECT entry::text FROM unnest(attribute.attacl) entry ORDER BY entry::text) END AS attacl
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
    WHERE namespace.nspname IN ('public', 'drizzle')
    ORDER BY namespace.nspname, relation.relname, attribute.attnum`;
  const schemas = await admin`
    SELECT nspname, nspowner, CASE WHEN nspacl IS NULL THEN NULL ELSE
      ARRAY(SELECT entry::text FROM unnest(nspacl) entry ORDER BY entry::text) END AS nspacl
    FROM pg_namespace
    WHERE nspname IN ('public', 'drizzle') ORDER BY nspname`;
  const roles = await admin`
    SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
      rolreplication, rolbypassrls FROM pg_roles
    WHERE rolname IN ('aoa_app', 'aoa_operator') ORDER BY rolname`;
  // Strip postgres-js result metadata; only catalog state belongs in the equality assertion.
  return { relations: [...relations], schemas: [...schemas], roles: [...roles] };
}
