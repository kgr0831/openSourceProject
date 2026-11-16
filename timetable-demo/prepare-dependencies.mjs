import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const demo = fileURLToPath(new URL('./', import.meta.url));
const parser = fileURLToPath(new URL('../lms-parser/', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(demo, 'package.json'), 'utf8'));

function run(args, cwd, stdio) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, {cwd, stdio, windowsHide: true});
    child.once('error', () => resolve(1));
    child.once('exit', code => resolve(code ?? 1));
  });
}

async function calendarReady() {
  const installed = path.join(demo, 'node_modules', 'fullcalendar');
  try {
    const actual = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'));
    return actual.version === manifest.dependencies.fullcalendar &&
      ['all/global.js', 'locales/ko/global.js', 'skeleton.css', 'themes/monarch/global.js',
        'themes/monarch/theme.css', 'themes/monarch/palettes/blue.css'].every(file => existsSync(path.join(installed, file)));
  } catch {
    return false;
  }
}

async function parserReady() {
  return await run(['--input-type=module', '-e', "await import('./index.mjs'); await import('playwright');"], parser, 'ignore') === 0;
}

const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  path.join(process.env.ProgramFiles || 'C:/Program Files', 'nodejs/node_modules/npm/bin/npm-cli.js')];
const npm = candidates.find(candidate => candidate?.endsWith('.js') && existsSync(candidate));
for (const {name, directory, ready} of [
  {name: '학기 캘린더', directory: demo, ready: calendarReady},
  {name: 'LMS 연결', directory: parser, ready: parserReady}
]) {
  if (await ready()) continue;
  console.log(name + '에 필요한 구성 요소를 준비합니다.');
  if (!npm || await run([npm, 'ci', '--no-audit', '--no-fund'], directory, 'inherit') !== 0 || !await ready()) {
    console.error(name + ' 구성 요소를 준비하지 못했어요. Node.js와 인터넷 연결을 확인하거나 ' + directory + '에서 npm ci를 실행해 주세요.');
    process.exitCode = 1;
    break;
  }
}
