import type {
  DatabaseAdapter,
  QueryResultRow,
} from "../types/migrations.js";
import { createBaselineUnsupportedError } from "../utils/errors.js";
import type { StructuredContext } from "../types/structured.js";

interface BaselineCompatibilityRow extends QueryResultRow {
  feature: string;
  object_name: string;
  detail: string;
}

interface BaselineCompatibilityIssue extends StructuredContext {
  feature: string;
  objectName: string;
  detail: string;
}

const BASELINE_COMPATIBILITY_QUERY = `
  WITH unsupported AS (
    SELECT
      'column_type'::text AS feature,
      format('%I.%I', c.table_name, c.column_name)::text AS object_name,
      format('data_type=%s udt=%s', c.data_type, c.udt_name)::text AS detail
    FROM information_schema.columns c
    WHERE c.table_schema = $1
      AND (
        c.data_type IN ('ARRAY', 'USER-DEFINED')
        OR c.domain_name IS NOT NULL
        OR c.is_generated <> 'NEVER'
      )

    UNION ALL

    SELECT
      'check_constraint',
      format('%I.%I', c.relname, con.conname),
      pg_get_constraintdef(con.oid)
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND con.contype = 'c'

    UNION ALL

    SELECT 'view', format('%I.%I', v.table_schema, v.table_name), 'Views are not captured'
    FROM information_schema.views v
    WHERE v.table_schema = $1

    UNION ALL

    SELECT 'materialized_view', format('%I.%I', m.schemaname, m.matviewname), 'Materialized views are not captured'
    FROM pg_matviews m
    WHERE m.schemaname = $1

    UNION ALL

    SELECT 'routine', format('%I.%I', r.routine_schema, r.routine_name), r.routine_type
    FROM information_schema.routines r
    WHERE r.specific_schema = $1

    UNION ALL

    SELECT 'trigger', format('%I.%I', t.event_object_table, t.trigger_name), t.action_timing
    FROM information_schema.triggers t
    WHERE t.trigger_schema = $1

    UNION ALL

    SELECT 'row_security_policy', format('%I.%I', p.tablename, p.policyname), coalesce(p.cmd, 'ALL')
    FROM pg_policies p
    WHERE p.schemaname = $1

    UNION ALL

    SELECT 'row_security', format('%I.%I', $1, c.relname), 'Row-level security is enabled'
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relrowsecurity

    UNION ALL

    SELECT 'partitioned_table', format('%I.%I', $1, c.relname), pg_get_partkeydef(c.oid)
    FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1

    UNION ALL

    SELECT 'exclusion_constraint', format('%I.%I', c.relname, con.conname), pg_get_constraintdef(con.oid)
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND con.contype = 'x'

    UNION ALL

    SELECT 'custom_type', format('%I.%I', n.nspname, t.typname),
      CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'd' THEN 'domain' ELSE t.typtype::text END
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = $1
      AND t.typtype IN ('e', 'd')

    UNION ALL

    SELECT 'unowned_sequence', format('%I.%I', n.nspname, c.relname), 'Sequence ownership is not represented'
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1
      AND c.relkind = 'S'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.objid = c.oid
          AND d.deptype IN ('a', 'i')
      )

    UNION ALL

    SELECT 'table_inheritance', format('%I.%I', $1, child.relname),
      format('inherits from %I.%I', parent_ns.nspname, parent.relname)
    FROM pg_inherits i
    JOIN pg_class child ON child.oid = i.inhrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = i.inhparent
    JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    WHERE child_ns.nspname = $1
      AND NOT EXISTS (
        SELECT 1 FROM pg_partitioned_table pt WHERE pt.partrelid = i.inhparent
      )
  )
  SELECT feature, object_name, detail
  FROM unsupported
  ORDER BY feature, object_name
`;

const getBaselineCompatibilityIssues = async (
  adapter: DatabaseAdapter,
  schema: string
): Promise<BaselineCompatibilityIssue[]> => {
  const result = await adapter.query<BaselineCompatibilityRow>(
    BASELINE_COMPATIBILITY_QUERY,
    [schema]
  );

  return result.rows.map((row) => ({
    feature: row.feature,
    objectName: row.object_name,
    detail: row.detail,
  }));
};

export const assertBaselineCompatible = async (
  adapter: DatabaseAdapter,
  schema: string
) => {
  const issues = await getBaselineCompatibilityIssues(adapter, schema);
  if (issues.length === 0) return;

  throw createBaselineUnsupportedError(
    `Schema ${schema} contains features that Tusk cannot reproduce safely in an adopted baseline`,
    { schema, issues }
  );
};
