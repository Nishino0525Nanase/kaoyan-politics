import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {transformSync} from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root,'dist/app.js'),'utf8');
const compiled = transformSync(source,{target:'chrome74',charset:'utf8',legalComments:'none',minify:false});
const output = path.join(root,'android/app/src/main/assets/web/app.js');
fs.writeFileSync(output,compiled.code);
console.log('Android app.js compiled for WebView / Chrome 74 and newer.');
