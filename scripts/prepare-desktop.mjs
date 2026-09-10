import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const cwd=new URL('../vendor/nativephp/desktop/resources/electron/',import.meta.url);
const path=new URL('package.json',cwd);
const pkg=JSON.parse(readFileSync(path));
// NativePHP 2.3 ships stale Electron dependencies and omits a compiled plugin file.
pkg.devDependencies.electron='44.2.0';
Object.assign(pkg.dependencies,{'axios':'1.20.0','body-parser':'2.3.0','electron-updater':'6.8.9'});
pkg.overrides={...pkg.overrides,'builder-util-runtime':'9.7.0','fast-uri':'3.1.7','form-data':'4.0.6','qs':'6.16.0','shell-quote':'1.10.0','js-yaml':'4.3.2'};
writeFileSync(path,JSON.stringify(pkg,null,2)+'\n');
execFileSync('npm',['install'],{cwd,stdio:'inherit'});
execFileSync('node',['node_modules/electron/install.js'],{cwd,stdio:'inherit'});
execFileSync('npm',['run','plugin:build'],{cwd,stdio:'inherit'});

const composerPath=new URL('../composer.json',import.meta.url);
const composer=JSON.parse(readFileSync(composerPath));
composer.scripts['post-update-cmd']=composer.scripts['post-update-cmd'].filter(s=>!s.includes('native:install'));
writeFileSync(composerPath,JSON.stringify(composer,null,4)+'\n');

const notarizePath=new URL('build/notarize.js',cwd);
let notarize=readFileSync(notarizePath,'utf8');
if(!notarize.includes("process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false'"))notarize=notarize.replace('export default async (context) => {', "export default async (context) => {\n    if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false') return;");
writeFileSync(notarizePath,notarize);

const builderPath=new URL('electron-builder.mjs',cwd);
let builder=readFileSync(builderPath,'utf8');
if(!builder.includes('hardenedRuntime:'))builder=builder.replace('mac: {',"mac: {\n        hardenedRuntime: process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false',");
writeFileSync(builderPath,builder);
