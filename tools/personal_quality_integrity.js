const fs = require('fs');
const path = require('path');
function inspect(batches) {
  const groups = new Map();
  for (const batch of batches) for (const row of batch.rows) {
    const key = `${row.tabId}:${row.sessionId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([key, rows]) => {
    let gaps = 0, duplicatesOrReordered = 0, maxAudioGap = 0;
    for (let i = 1; i < rows.length; i++) {
      const delta = rows[i].sequence - rows[i-1].sequence;
      gaps += Math.max(0, delta - 1);
      if (delta <= 0) duplicatesOrReordered++;
      maxAudioGap = Math.max(maxAudioGap, rows[i].audioSeconds - rows[i-1].audioSeconds);
    }
    const reportedDropped = Math.max(...rows.map(r => r.transportDropped || 0));
    return { session: key, tabId: rows[0].tabId, records: rows.length,
      nominalMeasuredSeconds: rows.length * 0.1,
      audioSpanSeconds: rows.at(-1).audioSeconds - rows[0].audioSeconds,
      firstReceivedAt: rows[0].receivedAt, lastReceivedAt: rows.at(-1).receivedAt,
      firstSequence: rows[0].sequence, lastSequence: rows.at(-1).sequence,
      gaps, duplicatesOrReordered, reportedDropped, maximumAudioGapSeconds: maxAudioGap,
      droppedBeforeFirstReceivedRow: rows[0].transportDropped || 0,
      droppedDuringReceivedInterval: (rows.at(-1).transportDropped || 0) - (rows[0].transportDropped || 0),
      contiguous: gaps === 0 && duplicatesOrReordered === 0 && reportedDropped === 0 && maxAudioGap < 0.151,
      note: 'Transport integrity only. Does not prove playing media, eligible loudness duration, or unseen tail delivery.' };
  });
}
if (require.main === module) {
  const directory = process.argv[2] || JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tmp/personal-quality-current.json'), 'utf8')).directory;
  const file = path.join(directory, 'quality.jsonl');
  const batches = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  console.log(JSON.stringify({directory, sessions: inspect(batches)}, null, 2));
}
module.exports = { inspect };
