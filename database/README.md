# Database SQL files

## Files

| File | Purpose |
|------|---------|
| `001`–`010` | Geo + facility + facility_code_master |
| `011_master_tables_schema.sql` | Master tables: source, DE, indicator, period, role |
| `012_master_tables_seed.sql` | Seed 21 sources + indicators 1–9 + DEs |

## Master tables (config only)

| Table | Rows (seeded) | Purpose |
|-------|---------------|---------|
| `source_system` | 22 | 21 sources + manual_upload |
| `data_element` | 92 | Full sheet DEs |
| `indicator` | 37 | Full KPI master |
| `indicator_level` | 95 | Where KPI can show |
| `indicator_component` | 91 | Num / den mapping |
| `time_period` | 8 | Sample periods |
| `role` | 6 | User roles |

Full sheet seed: `017_full_indicator_sheet_seed.sql`


**Not created yet (transactional):** `fact_component_value`, `kpi_value`, `upload_*`

## Geo counts

| Table | Rows |
|-------|------|
| division | 18 |
| district | 75 |
| block | 897 |
| facility | 33,588 |
| facility_code_master | 33,593 |

## Apply masters

```bash
psql -h 127.0.0.1 -U postgres -d uphealthdashboard -f database/011_master_tables_schema.sql
psql -h 127.0.0.1 -U postgres -d uphealthdashboard -f database/012_master_tables_seed.sql
```
