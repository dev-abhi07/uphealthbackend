require('dotenv').config();
const fs = require('fs');
const path = require('path');
const rankingService = require('../src/ranking/rankingService');

const file =
  process.argv[2] ||
  path.join(
    process.env.HOME || '/home/abhishek',
    'Downloads/RankingDashboard Data Jan-Jun 2026/RankingDashboard Data/By DIvision/Jan/Data_Report_Requirement-18-8-2026_division.xlsx'
  );

(async () => {
  if (!fs.existsSync(file)) {
    console.error('File not found:', file);
    process.exit(1);
  }
  const result = await rankingService.importRankingFile({
    buffer: fs.readFileSync(file),
    originalname: path.basename(file),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
