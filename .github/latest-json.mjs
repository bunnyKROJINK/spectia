// Создаёт latest.json — файл, по которому лаунчер узнаёт, что вышла новая версия.
// Запускается в GitHub Actions при выпуске релиза.
import fs from 'node:fs';

const version = process.argv[2];
const dir = 'src-tauri/target/release/bundle/nsis/';
const exe = fs.readdirSync(dir).find((f) => f.endsWith('-setup.exe'));
const sigFile = dir + exe + '.sig';

if (!fs.existsSync(sigFile)) {
  console.log('Нет подписи обновления (ключ не задан) — latest.json не создаём.');
  fs.writeFileSync('latest.json', '{}');
  process.exit(0);
}

const latest = {
  version,
  notes: fs.readFileSync('RELEASE_NOTES.md', 'utf8').trim(),
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: fs.readFileSync(sigFile, 'utf8').trim(),
      url: `https://github.com/bunnyKROJINK/spectia/releases/download/v${version}/${exe}`,
    },
  },
};
fs.writeFileSync('latest.json', JSON.stringify(latest, null, 2));
console.log('latest.json готов для версии', version);
