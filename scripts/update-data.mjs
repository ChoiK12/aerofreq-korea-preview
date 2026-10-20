import ExcelJS from 'exceljs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'data-source', 'AeroFreq_Korea.xlsx');
const output = path.join(root, 'src', 'data', 'kr');
const workbook = new ExcelJS.Workbook();

try {
  await workbook.xlsx.readFile(input);
} catch (error) {
  console.error(`엑셀 파일을 열지 못했습니다: ${input}`);
  console.error(error.message);
  process.exit(1);
}

function valueOf(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('result' in v) return v.result == null ? '' : String(v.result).trim();
    if ('text' in v) return String(v.text).trim();
    if ('richText' in v) return v.richText.map(x => x.text).join('').trim();
  }
  return String(v).trim();
}

function sheetRows(name, requiredHeaders) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`'${name}' 시트가 없습니다.`);
  const header = sheet.getRow(1).values.slice(1).map(v => String(v ?? '').trim());
  for (const key of requiredHeaders) {
    if (!header.includes(key)) throw new Error(`'${name}' 시트에 '${key}' 열이 없습니다.`);
  }
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const record = Object.fromEntries(header.map((key, i) => [key, valueOf(row.getCell(i + 1))]));
    if (Object.values(record).some(v => v !== '')) rows.push({ row: index, record });
  });
  return rows;
}

function coordinate(value, min, max, field, code) {
  if (value === '') throw new Error(`${code}: ${field} 좌표가 비어 있습니다.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${code}: ${field} 좌표가 잘못되었습니다: ${value}`);
  }
  return n;
}

try {
  const airportRows = sheetRows('airports', [
    'icao', 'iata', 'name_ko', 'name_en', 'latitude', 'longitude', 'airport_type', 'traffic_types',
  ]);
  const airportCodes = new Set();
  const airports = airportRows.map(({ row, record: a }) => {
    const icao = a.icao.toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(icao)) throw new Error(`airports ${row}행: ICAO 코드 오류`);
    if (airportCodes.has(icao)) throw new Error(`airports ${row}행: 중복 ICAO ${icao}`);
    airportCodes.add(icao);
    return {
      icao,
      iata: a.iata.toUpperCase(),
      name_ko: a.name_ko,
      name_en: a.name_en,
      latitude: coordinate(a.latitude, -90, 90, '위도', icao),
      longitude: coordinate(a.longitude, -180, 180, '경도', icao),
      airport_type: a.airport_type,
      traffic_types: a.traffic_types,
    };
  });

  const freqRows = sheetRows('frequencies', [
    'frequency_id', 'icao', 'service_code', 'call_sign', 'frequency_mhz',
    'frequency_unit', 'channel_type', 'hours_of_operation', 'remarks', 'default_display',
  ]);
  const freqIds = new Set();
  const frequencies = freqRows.map(({ row, record: f }) => {
    const icao = f.icao.toUpperCase();
    if (!airportCodes.has(icao)) throw new Error(`frequencies ${row}행: 없는 공항 ${icao}`);
    if (!f.frequency_id) throw new Error(`frequencies ${row}행: frequency_id 누락`);
    if (freqIds.has(f.frequency_id)) throw new Error(`frequencies ${row}행: 중복 ID ${f.frequency_id}`);
    freqIds.add(f.frequency_id);
    const defaultDisplay = f.default_display.trim().toUpperCase();
    if (!['', 'Y', 'N'].includes(defaultDisplay)) throw new Error(`frequencies ${row}행: default_display는 Y 또는 N이어야 합니다.`);
    const mhz = Number(f.frequency_mhz);
    if (!Number.isFinite(mhz) || mhz <= 0) throw new Error(`frequencies ${row}행: 주파수 값 오류`);
    return {
      ...f,
      icao,
      frequency_mhz: mhz,
      default_display: defaultDisplay === 'Y',
    };
  });

  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'airports.json'), JSON.stringify(airports, null, 2) + '\n', 'utf8');
  await writeFile(path.join(output, 'frequencies.json'), JSON.stringify(frequencies, null, 2) + '\n', 'utf8');
  console.log(`완료: 공항 ${airports.length}곳, 주파수 ${frequencies.length}개`);
  console.log(`저장 위치: ${output}`);
} catch (error) {
  console.error(`데이터 변환 중단: ${error.message}`);
  process.exit(1);
}
