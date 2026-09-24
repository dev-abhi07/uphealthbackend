-- =============================================================================
-- Dashboard PostgreSQL functions
-- Node API calls these; computation stays in DB
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Composite score for a geo + period
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_composite_score(
  p_geo_level     text,
  p_division_id   bigint DEFAULT NULL,
  p_district_id   bigint DEFAULT NULL,
  p_block_id      bigint DEFAULT NULL,
  p_period_label  text DEFAULT '2026-05'
) RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT ROUND((
    SUM(
      CASE
        WHEN i.unit = 'percent' AND COALESCE(i.is_negative, FALSE)
          THEN (1 - (k.value / 100.0)) * COALESCE(i.weight, 1)
        WHEN i.unit = 'percent'
          THEN (k.value / 100.0) * COALESCE(i.weight, 1)
        ELSE k.value * COALESCE(i.weight, 1)
      END
    ) / NULLIF(SUM(COALESCE(i.weight, 1)), 0)
  )::numeric, 2)
  FROM kpi_value k
  JOIN indicator i ON i.id = k.indicator_id AND i.is_active = TRUE
  JOIN time_period tp ON tp.id = k.time_period_id
  WHERE k.geo_level = p_geo_level
    AND tp.label = p_period_label
    AND (p_division_id IS NULL OR k.division_id = p_division_id)
    AND (p_district_id IS NULL OR k.district_id = p_district_id)
    AND (p_block_id IS NULL OR k.block_id = p_block_id)
    AND k.value IS NOT NULL;
$$;

COMMENT ON FUNCTION fn_composite_score IS 'Weighted composite score (0-1 style) for dashboard header';

-- -----------------------------------------------------------------------------
-- 2) BY INDICATORS — flat list
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_dashboard_by_indicators(
  p_geo_level     text DEFAULT 'district',
  p_division_id   bigint DEFAULT NULL,
  p_district_id   bigint DEFAULT NULL,
  p_block_id      bigint DEFAULT NULL,
  p_period_label  text DEFAULT '2026-05'
)
RETURNS TABLE (
  indicator_id    bigint,
  sno             int,
  code            varchar,
  name            text,
  domain          varchar,
  indicator_type  varchar,
  unit            varchar,
  is_negative     boolean,
  weight          numeric,
  formula_text    text,
  geo_level       varchar,
  division_id     bigint,
  district_id     bigint,
  block_id        bigint,
  numerator       numeric,
  denominator     numeric,
  value           numeric,
  computed_at     timestamptz,
  period_label    varchar,
  overall_composite_score numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    i.id,
    i.sno,
    i.code,
    i.name,
    i.domain,
    i.indicator_type,
    i.unit,
    i.is_negative,
    COALESCE(i.weight, 1)::numeric,
    i.formula_text,
    k.geo_level,
    k.division_id,
    k.district_id,
    k.block_id,
    k.numerator,
    k.denominator,
    k.value,
    k.computed_at,
    tp.label,
    fn_composite_score(p_geo_level, p_division_id, p_district_id, p_block_id, p_period_label)
  FROM kpi_value k
  JOIN indicator i ON i.id = k.indicator_id AND i.is_active = TRUE
  JOIN time_period tp ON tp.id = k.time_period_id
  WHERE k.geo_level = p_geo_level
    AND tp.label = p_period_label
    AND (p_division_id IS NULL OR k.division_id = p_division_id)
    AND (p_district_id IS NULL OR k.district_id = p_district_id)
    AND (p_block_id IS NULL OR k.block_id = p_block_id)
  ORDER BY i.sno NULLS LAST, i.name;
$$;

COMMENT ON FUNCTION fn_dashboard_by_indicators IS 'Dashboard BY INDICATORS list + composite score column';

-- -----------------------------------------------------------------------------
-- 3) BY TYPE — grouped rows (Coverage / Quality / Data Quality)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_dashboard_by_type(
  p_geo_level     text DEFAULT 'district',
  p_division_id   bigint DEFAULT NULL,
  p_district_id   bigint DEFAULT NULL,
  p_block_id      bigint DEFAULT NULL,
  p_period_label  text DEFAULT '2026-05'
)
RETURNS TABLE (
  indicator_type  varchar,
  type_label      text,
  group_score     numeric,
  indicator_id    bigint,
  sno             int,
  code            varchar,
  name            text,
  domain          varchar,
  unit            varchar,
  is_negative     boolean,
  weight          numeric,
  formula_text    text,
  value           numeric,
  numerator       numeric,
  denominator     numeric,
  period_label    varchar,
  overall_composite_score numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT * FROM fn_dashboard_by_indicators(
      p_geo_level, p_division_id, p_district_id, p_block_id, p_period_label
    )
  ),
  type_scores AS (
    SELECT
      b.indicator_type,
      ROUND((
        SUM(
          CASE
            WHEN b.unit = 'percent' AND COALESCE(b.is_negative, FALSE)
              THEN (1 - (b.value / 100.0)) * COALESCE(b.weight, 1)
            WHEN b.unit = 'percent'
              THEN (b.value / 100.0) * COALESCE(b.weight, 1)
            ELSE b.value * COALESCE(b.weight, 1)
          END
        ) / NULLIF(SUM(COALESCE(b.weight, 1)), 0)
      )::numeric, 2) AS group_score
    FROM base b
    GROUP BY b.indicator_type
  )
  SELECT
    b.indicator_type,
    CASE b.indicator_type
      WHEN 'coverage' THEN 'COVERAGE'
      WHEN 'quality' THEN 'QUALITY'
      WHEN 'data_quality' THEN 'DATA QUALITY'
      ELSE UPPER(REPLACE(COALESCE(b.indicator_type, 'OTHER'), '_', ' '))
    END AS type_label,
    ts.group_score,
    b.indicator_id,
    b.sno,
    b.code,
    b.name,
    b.domain,
    b.unit,
    b.is_negative,
    b.weight,
    b.formula_text,
    b.value,
    b.numerator,
    b.denominator,
    b.period_label,
    b.overall_composite_score
  FROM base b
  LEFT JOIN type_scores ts ON ts.indicator_type = b.indicator_type
  ORDER BY
    CASE b.indicator_type
      WHEN 'coverage' THEN 1
      WHEN 'quality' THEN 2
      WHEN 'data_quality' THEN 3
      ELSE 9
    END,
    b.sno NULLS LAST;
$$;

-- -----------------------------------------------------------------------------
-- 4) BY DOMAIN — Ante Natal, Delivery Care, etc.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_dashboard_by_domain(
  p_geo_level     text DEFAULT 'district',
  p_division_id   bigint DEFAULT NULL,
  p_district_id   bigint DEFAULT NULL,
  p_block_id      bigint DEFAULT NULL,
  p_period_label  text DEFAULT '2026-05'
)
RETURNS TABLE (
  domain          varchar,
  domain_label    text,
  group_score     numeric,
  indicator_id    bigint,
  sno             int,
  code            varchar,
  name            text,
  indicator_type  varchar,
  unit            varchar,
  is_negative     boolean,
  weight          numeric,
  formula_text    text,
  value           numeric,
  numerator       numeric,
  denominator     numeric,
  period_label    varchar,
  overall_composite_score numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT * FROM fn_dashboard_by_indicators(
      p_geo_level, p_division_id, p_district_id, p_block_id, p_period_label
    )
  ),
  domain_scores AS (
    SELECT
      b.domain,
      ROUND((
        SUM(
          CASE
            WHEN b.unit = 'percent' AND COALESCE(b.is_negative, FALSE)
              THEN (1 - (b.value / 100.0)) * COALESCE(b.weight, 1)
            WHEN b.unit = 'percent'
              THEN (b.value / 100.0) * COALESCE(b.weight, 1)
            ELSE b.value * COALESCE(b.weight, 1)
          END
        ) / NULLIF(SUM(COALESCE(b.weight, 1)), 0)
      )::numeric, 2) AS group_score
    FROM base b
    GROUP BY b.domain
  )
  SELECT
    b.domain,
    CASE b.domain
      WHEN 'ante_natal' THEN 'ANTE NATAL'
      WHEN 'delivery_care' THEN 'DELIVERY CARE'
      WHEN 'post_natal' THEN 'POST NATAL CARE'
      WHEN 'immunization' THEN 'IMMUNIZATION'
      WHEN 'family_planning' THEN 'FAMILY PLANNING'
      WHEN 'communicable_diseases' THEN 'COMMUNICABLE DISEASES'
      WHEN 'finance' THEN 'FINANCE'
      WHEN 'data_quality' THEN 'DATA QUALITY'
      ELSE UPPER(REPLACE(COALESCE(b.domain, 'OTHER'), '_', ' '))
    END AS domain_label,
    ds.group_score,
    b.indicator_id,
    b.sno,
    b.code,
    b.name,
    b.indicator_type,
    b.unit,
    b.is_negative,
    b.weight,
    b.formula_text,
    b.value,
    b.numerator,
    b.denominator,
    b.period_label,
    b.overall_composite_score
  FROM base b
  LEFT JOIN domain_scores ds ON ds.domain IS NOT DISTINCT FROM b.domain
  ORDER BY
    CASE b.domain
      WHEN 'ante_natal' THEN 1
      WHEN 'delivery_care' THEN 2
      WHEN 'post_natal' THEN 3
      WHEN 'immunization' THEN 4
      WHEN 'family_planning' THEN 5
      WHEN 'communicable_diseases' THEN 6
      WHEN 'finance' THEN 7
      WHEN 'data_quality' THEN 8
      ELSE 9
    END,
    b.sno NULLS LAST;
$$;

-- -----------------------------------------------------------------------------
-- 5) District composites (helper for performance)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_district_composites(
  p_period_label text DEFAULT '2026-05'
)
RETURNS TABLE (
  district_id      bigint,
  district_name    varchar,
  lgd_code         varchar,
  division_id      bigint,
  division_name    varchar,
  indicator_count  bigint,
  composite_score  numeric,
  rank             bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH scored AS (
    SELECT
      d.id AS district_id,
      d.name AS district_name,
      d.lgd_code,
      d.division_id,
      dv.name AS division_name,
      COUNT(k.id) AS indicator_count,
      fn_composite_score('district', d.division_id, d.id, NULL, p_period_label) AS composite_score
    FROM district d
    JOIN division dv ON dv.id = d.division_id
    JOIN kpi_value k ON k.district_id = d.id AND k.geo_level = 'district'
    JOIN time_period tp ON tp.id = k.time_period_id AND tp.label = p_period_label
    WHERE d.is_active = TRUE
    GROUP BY d.id, d.name, d.lgd_code, d.division_id, dv.name
  )
  SELECT
    s.district_id,
    s.district_name,
    s.lgd_code,
    s.division_id,
    s.division_name,
    s.indicator_count,
    s.composite_score,
    RANK() OVER (ORDER BY s.composite_score DESC NULLS LAST)::bigint AS rank
  FROM scored s
  ORDER BY s.composite_score DESC NULLS LAST, s.district_name;
$$;

-- -----------------------------------------------------------------------------
-- 6) Performance bands — Top / Moderate / Bottom
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_district_performance(
  p_period_label text DEFAULT '2026-05',
  p_band_size    int DEFAULT 25
)
RETURNS TABLE (
  band             text,
  band_label       text,
  band_color       text,
  rank             bigint,
  district_id      bigint,
  district_name    varchar,
  lgd_code         varchar,
  division_id      bigint,
  division_name    varchar,
  indicator_count  bigint,
  composite_score  numeric,
  total_ranked     bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  n int;
  top_n int;
  bottom_n int;
  mid_n int;
BEGIN
  SELECT COUNT(*) INTO n FROM fn_district_composites(p_period_label);

  IF n = 0 THEN
    RETURN;
  END IF;

  IF n < p_band_size * 3 THEN
    top_n := CEIL(n / 3.0)::int;
    bottom_n := FLOOR(n / 3.0)::int;
    mid_n := n - top_n - bottom_n;
  ELSE
    top_n := p_band_size;
    bottom_n := p_band_size;
    mid_n := p_band_size;
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT * FROM fn_district_composites(p_period_label)
  ),
  numbered AS (
    SELECT r.*, ROW_NUMBER() OVER (ORDER BY r.rank, r.district_name) AS rn
    FROM ranked r
  )
  SELECT
    x.band,
    x.band_label,
    x.band_color,
    x.rank,
    x.district_id,
    x.district_name,
    x.lgd_code,
    x.division_id,
    x.division_name,
    x.indicator_count,
    x.composite_score,
    n::bigint AS total_ranked
  FROM (
    SELECT
      'top'::text AS band,
      ('Top ' || top_n || ' Districts')::text AS band_label,
      'green'::text AS band_color,
      m.rank, m.district_id, m.district_name, m.lgd_code,
      m.division_id, m.division_name, m.indicator_count, m.composite_score
    FROM numbered m
    WHERE m.rn <= top_n

    UNION ALL

    SELECT
      'moderate',
      ('Moderate ' || mid_n || ' Districts'),
      'orange',
      m.rank, m.district_id, m.district_name, m.lgd_code,
      m.division_id, m.division_name, m.indicator_count, m.composite_score
    FROM numbered m
    WHERE m.rn > top_n AND m.rn <= top_n + mid_n

    UNION ALL

    SELECT
      'bottom',
      ('Bottom ' || bottom_n || ' Districts'),
      'red',
      m.rank, m.district_id, m.district_name, m.lgd_code,
      m.division_id, m.division_name, m.indicator_count, m.composite_score
    FROM numbered m
    WHERE m.rn > n - bottom_n
  ) x
  ORDER BY
    CASE x.band WHEN 'top' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
    x.rank,
    x.district_name;
END;
$$;

COMMENT ON FUNCTION fn_district_performance IS 'Dashboard Top/Moderate/Bottom district performance bands';
