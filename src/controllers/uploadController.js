const path = require('path');
const {
  listTemplates,
  getTemplate,
  getSourcesForIndicator,
  getLevelsForIndicator,
  resolveAllowedLevels,
} = require('../upload/templateRegistry');
const { buildTemplateWorkbook } = require('../upload/templateBuilder');
const uploadService = require('../services/uploadService');
const { query } = require('../db/pool');
const { asyncHandler } = require('../middleware/errorHandler');

/** Step 1: list indicators (state workflow) */
async function listIndicators(req, res) {
  const templates = listTemplates();
  res.json({
    success: true,
    audience: 'state_admin',
    count: templates.length,
    indicators: templates.map((t) => ({
      code: t.code,
      name: t.name,
      default_level: t.default_level,
      allowed_levels: t.allowed_levels,
      data_sources: t.data_sources,
      sources: t.sources,
      data_source_label: t.data_source_label,
    })),
  });
}

/** Step 2: sources for selected indicator */
async function listSources(req, res) {
  const code = req.params.code;
  const sources = getSourcesForIndicator(code);
  if (!sources) {
    return res.status(404).json({ success: false, message: `Unknown indicator: ${code}` });
  }
  res.json({ success: true, indicator_code: code, sources });
}

/** Step 3: levels for indicator (+ optional source) */
async function listLevels(req, res) {
  const code = req.params.code;
  const sourceCode = req.query.source_code;
  const result = getLevelsForIndicator(code, sourceCode);
  if (!result) {
    return res.status(404).json({ success: false, message: `Unknown indicator: ${code}` });
  }
  if (result.error) {
    return res.status(400).json({ success: false, message: result.error });
  }
  res.json({
    success: true,
    indicator_code: code,
    source_code: sourceCode || null,
    levels: result,
    note:
      'District columns always for district level. Block level hides District. Facility level hides District+Block.',
  });
}

/** Step 4: periods */
async function listPeriods(req, res) {
  const { rows } = await query(
    `
    SELECT id, label, period_type, start_date, end_date
    FROM time_period
    WHERE is_active = TRUE
    ORDER BY start_date DESC
    LIMIT 50
    `
  );
  res.json({ success: true, count: rows.length, periods: rows });
}

/** Legacy list alias */
async function list(req, res) {
  return listIndicators(req, res);
}

/**
 * Step 5: generate/download sheet after indicator + source + level + period
 * Query: indicator via :code, source_code, level,
 *        period OR (from_date + to_date)
 * Always statewide rows (district_id / division_id ignored if sent).
 */
async function download(req, res) {
  const indicatorCode = req.params.code;
  const level = req.query.level;
  const sourceCode = req.query.source_code;

  const tp = await uploadService.resolvePeriodInput({
    period: req.query.period,
    fromDate: req.query.from_date,
    toDate: req.query.to_date,
  });
  const period = tp.label;

  // level optional — falls back to indicator default_level
  const { buffer, filename, template, uploadLevel, hiddenColumns, visibleColumns, rowCount, levelFallback } =
    await buildTemplateWorkbook({
      indicatorCode,
      period,
      level,
      sourceCode,
    });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Template-Level', uploadLevel);
  res.setHeader('X-Level-Fallback', levelFallback ? 'true' : 'false');
  res.setHeader('X-Hidden-Columns', (hiddenColumns || []).join(','));
  res.setHeader('X-Visible-Geo-Columns', (visibleColumns || []).join(','));
  res.setHeader('X-Row-Count', String(rowCount));
  res.setHeader('X-Indicator-Code', template.code);
  res.setHeader('X-Period-Label', period);
  res.setHeader('X-Period-Id', String(tp.id));
  res.setHeader('X-Scope', 'state');
  res.send(buffer);
}

async function upload(req, res) {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'Excel file required (multipart field name: file)',
    });
  }

  const ext = path.extname(req.file.originalname || '').toLowerCase();
  if (!['.xlsx', '.xls'].includes(ext)) {
    return res.status(400).json({
      success: false,
      message: 'Only Excel files (.xlsx, .xls) are accepted',
    });
  }

  const result = await uploadService.processUpload({
    buffer: req.file.buffer,
    originalname: req.file.originalname,
    user: req.user,
    indicatorCode: req.body.indicator_code || req.query.indicator_code,
    period: req.body.period || req.query.period,
    fromDate: req.body.from_date || req.query.from_date,
    toDate: req.body.to_date || req.query.to_date,
    level: req.body.level || req.query.level,
    publish: String(req.body.publish ?? 'true').toLowerCase() !== 'false',
  });

  const statusCode = result.error_count > 0 ? 422 : 200;
  return res.status(statusCode).json({ success: result.error_count === 0, ...result });
}

async function batches(req, res) {
  const rows = await uploadService.listBatches({
    limit: Number(req.query.limit) || 20,
  });
  res.json({ success: true, count: rows.length, batches: rows });
}

async function batchDetail(req, res) {
  const data = await uploadService.getBatch(Number(req.params.id));
  res.json({ success: true, ...data });
}

async function previewColumns(req, res) {
  const code = req.params.code;
  const level = String(req.query.level || '').toLowerCase();
  const template = getTemplate(code);
  if (!template) {
    return res.status(404).json({ success: false, message: `Unknown indicator: ${code}` });
  }
  const allowed = resolveAllowedLevels(template);
  if (!allowed.includes(level)) {
    return res.status(400).json({
      success: false,
      message: `Invalid level. Allowed: ${allowed.join(', ')}`,
    });
  }
  const { geoHeadersForLevel, LEVEL_META } = require('../upload/templateRegistry');
  res.json({
    success: true,
    indicator_code: code,
    level,
    geo_columns: geoHeadersForLevel(level),
    value_columns: template.valueColumns.map((c) => c.header),
    hidden_columns: LEVEL_META[level].hidden_columns,
    sheet_columns: [
      ...geoHeadersForLevel(level),
      ...template.valueColumns.map((c) => c.header),
    ],
  });
}

module.exports = {
  list: asyncHandler(list),
  listIndicators: asyncHandler(listIndicators),
  listSources: asyncHandler(listSources),
  listLevels: asyncHandler(listLevels),
  listPeriods: asyncHandler(listPeriods),
  previewColumns: asyncHandler(previewColumns),
  download: asyncHandler(download),
  upload: asyncHandler(upload),
  batches: asyncHandler(batches),
  batchDetail: asyncHandler(batchDetail),
};
