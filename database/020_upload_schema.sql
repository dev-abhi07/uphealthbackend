-- =============================================================================
-- Common Excel upload staging tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS upload_batch (
  id                 BIGSERIAL PRIMARY KEY,
  batch_no           VARCHAR(40) NOT NULL UNIQUE,
  indicator_id       BIGINT REFERENCES indicator(id),
  uploaded_by        BIGINT REFERENCES app_user(id),
  upload_geo_level   VARCHAR(20) NOT NULL
                       CHECK (upload_geo_level IN ('district', 'block', 'facility')),
  division_id        BIGINT REFERENCES division(id),
  district_id        BIGINT REFERENCES district(id),
  block_id           BIGINT REFERENCES block(id),
  facility_id        BIGINT REFERENCES facility(id),
  time_period_id     BIGINT REFERENCES time_period(id),
  source_file_name   VARCHAR(255),
  status             VARCHAR(30) NOT NULL DEFAULT 'draft'
                       CHECK (status IN (
                         'draft', 'submitted', 'validation_failed',
                         'pending_approval', 'approved', 'rejected',
                         'published', 'superseded'
                       )),
  row_count          INT NOT NULL DEFAULT 0,
  error_count        INT NOT NULL DEFAULT 0,
  fact_count         INT NOT NULL DEFAULT 0,
  remarks            TEXT,
  meta_json          JSONB,
  submitted_at       TIMESTAMPTZ,
  published_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_batch_status ON upload_batch (status, upload_geo_level);
CREATE INDEX IF NOT EXISTS idx_upload_batch_district ON upload_batch (district_id, time_period_id);
CREATE INDEX IF NOT EXISTS idx_upload_batch_user ON upload_batch (uploaded_by);

CREATE TABLE IF NOT EXISTS upload_row (
  id                  BIGSERIAL PRIMARY KEY,
  batch_id            BIGINT NOT NULL REFERENCES upload_batch(id) ON DELETE CASCADE,
  row_no              INT NOT NULL,
  indicator_id        BIGINT REFERENCES indicator(id),
  data_element_id     BIGINT REFERENCES data_element(id),
  geo_level           VARCHAR(20) NOT NULL
                        CHECK (geo_level IN ('facility', 'block', 'district')),
  division_id         BIGINT REFERENCES division(id),
  district_id         BIGINT REFERENCES district(id),
  block_id            BIGINT REFERENCES block(id),
  facility_id         BIGINT REFERENCES facility(id),
  external_geo_code   VARCHAR(100),
  column_key          VARCHAR(200),
  value_num           NUMERIC(18,4),
  validation_status   VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (validation_status IN ('pending', 'ok', 'error', 'skipped')),
  validation_errors   JSONB,
  published_fact_id   BIGINT REFERENCES fact_component_value(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_row_batch ON upload_row (batch_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_upload_row_geo ON upload_row (district_id, block_id, facility_id);

COMMENT ON TABLE upload_batch IS 'One Excel upload submission';
COMMENT ON TABLE upload_row IS 'Expanded staging rows (one DE value per row)';
