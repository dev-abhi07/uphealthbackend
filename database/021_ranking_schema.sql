-- Ranking dashboard (separate from HMIS KPI / upload tables)
-- Source: RankingDashboard Excel (division / district / block)

CREATE TABLE IF NOT EXISTS ranking_indicator (
  id            BIGSERIAL PRIMARY KEY,
  code          VARCHAR(80) NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  short_name    TEXT,
  unit          VARCHAR(20) NOT NULL DEFAULT 'percent',
  sort_order    INT NOT NULL DEFAULT 100,
  is_composite  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS ranking_period (
  id            BIGSERIAL PRIMARY KEY,
  label         VARCHAR(20) NOT NULL UNIQUE,
  display       VARCHAR(40) NOT NULL,
  start_date    DATE,
  end_date      DATE
);

CREATE TABLE IF NOT EXISTS ranking_import_batch (
  id              BIGSERIAL PRIMARY KEY,
  geo_level       VARCHAR(20) NOT NULL
                    CHECK (geo_level IN ('division', 'district', 'block')),
  period_id       BIGINT REFERENCES ranking_period(id),
  source_file     TEXT,
  sheet_count     INT,
  row_count       INT,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ranking_value (
  id              BIGSERIAL PRIMARY KEY,
  period_id       BIGINT NOT NULL REFERENCES ranking_period(id),
  indicator_id    BIGINT NOT NULL REFERENCES ranking_indicator(id),
  geo_level       VARCHAR(20) NOT NULL
                    CHECK (geo_level IN ('division', 'district', 'block')),
  geo_name        VARCHAR(200) NOT NULL,
  district_name   VARCHAR(200),
  value           NUMERIC(18,4),
  rank            INT,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_id, indicator_id, geo_level, geo_name)
);

CREATE INDEX IF NOT EXISTS idx_ranking_value_lookup
  ON ranking_value (geo_level, period_id, indicator_id, rank);

INSERT INTO ranking_indicator (code, name, short_name, unit, sort_order, is_composite) VALUES
  ('RANK_COMPOSITE', 'Overall composite score', 'Overall composite score', 'index', 0, TRUE),
  ('RANK_ANC4_HB', '% of pregnant women received 4 or more ANC and tested for Hb against estimated PW', 'PW received 4 or more ANC with Hb testing', 'percent', 10, FALSE),
  ('RANK_INST_DEL', '% of pregnant women delivered in institution against estimated delivery', 'Institutional Delivery rate', 'percent', 20, FALSE),
  ('RANK_CSECTION_CHC_70', '% of C-section delivery against reported delivery (70% weightage to CHC)', 'C-section delivery rate (70% to CHC)', 'percent', 30, FALSE),
  ('RANK_CSECTION_DH_30', '% of C-section delivery against reported delivery (30% to DH)', 'C-section delivery rate (30% to DH)', 'percent', 40, FALSE),
  ('RANK_STILLBIRTH', 'Still birth ratio', 'Still Birth Ratio', 'ratio', 50, FALSE),
  ('RANK_HBNC', '% of newborns received HBNC visits (Institutional Delivery and Home Delivery)', 'Newborns received HBNC visits', 'percent', 60, FALSE),
  ('RANK_PENTA3_BCG', 'Ratio of Pentavalent 3 to BCG', 'Ratio of Pentavalent 3 to BCG', 'ratio', 70, FALSE),
  ('RANK_FULL_IMM', '% of children received full immunization (BCG, Penta 1, 2, 3, Measles)', 'Full Immunization', 'percent', 80, FALSE),
  ('RANK_PERM_FP', 'Permanent Method accepted per 1000 EC', 'Permanent Method accepted per 1000 EC', 'rate', 90, FALSE),
  ('RANK_REV_FP', 'Reversible Method accepted per 1000 EC', 'Reversible Method accepted per 1000 EC', 'rate', 100, FALSE),
  ('RANK_HIV_PW', '% of PW screened for HIV against estimated pregnancy', 'PW screened for HIV', 'percent', 110, FALSE),
  ('RANK_NONBLANK', '% of facilities reported non blank value (including zero) for the identified indicators of ranking', 'Facilities reported non-blank ranking data', 'percent', 120, FALSE),
  ('RANK_OUTLIER', '% of facilities reported outlier for the identified indicators of ranking', 'Facilities reported outlier', 'percent', 130, FALSE),
  ('RANK_ASHA_EXP', 'Per ASHA expenditure of ASHA incentive fund', 'Per ASHA expenditure of ASHA incentive fund', 'amount', 140, FALSE),
  ('RANK_TB_NOTIF', 'Total case notification rate of TB against expected TB cases', 'TB cases notification rate', 'percent', 150, FALSE),
  ('RANK_HB4', '% of pregnant women tested for Hb for 4 or more times against estimated PW', 'PW tested for Hb 4 or more times', 'percent', 160, FALSE),
  ('RANK_ASHA_AVAIL', 'Availability of ASHA to total rural population', 'Availability of ASHA to total rural population', 'ratio', 170, FALSE),
  ('RANK_DEL_LOAD_POINT', 'Est Delivery load as per available Delivery Point', 'Est Delivery load (Delivery Point)', 'ratio', 180, FALSE),
  ('RANK_DEL_LOAD_ANM', 'Est Delivery load as per available SBA trained staff Nurse / ANM', 'Est Delivery load (Nurse or ANM)', 'ratio', 190, FALSE)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  short_name = EXCLUDED.short_name,
  unit = EXCLUDED.unit,
  sort_order = EXCLUDED.sort_order;
