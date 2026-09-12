import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { patchElectronBuilder, patchInstallsAppIcon, patchRunCommand, patchSetDockIcon } from '../scripts/macos-icon.mjs';

test('the Icon Composer bundle is present for the macOS app icon', () => {
    const icon = new URL('../public/icon.icon/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('icon.json', icon), 'utf8'));

    assert.ok(Array.isArray(manifest.groups));
    assert.equal(existsSync(new URL('Assets/Vector (2).svg', icon)), true);
    assert.equal(existsSync(new URL('../public/icon.icns', import.meta.url)), true);
    assert.equal(existsSync(new URL('../resources/macos/Assets.car', import.meta.url)), true);
});

test('electron-builder is patched to use the Icon Composer asset', () => {
    const patched = patchElectronBuilder('mac: {\n        entitlementsInherit: "build/entitlements.mac.plist",\n    }');

    assert.match(patched, /icon: 'icon\.icon'/);
    assert.equal(patchElectronBuilder(patched), patched);
});

test('NativePHP copies the Icon Composer asset into the Electron build', () => {
    const source = "@copy(public_path('icon.icns'), ElectronServiceProvider::electronPath('build/icon.icns'));";
    const patched = patchInstallsAppIcon(source);

    assert.match(patched, /public_path\('icon\.icon'\)/);
    assert.match(patched, /copyDirectory/);
    assert.match(patched, /Assets\.car/);
    assert.equal(patchInstallsAppIcon(patched), patched);
});

test('NativePHP icon copy fails when the icns copy line is gone', () => {
    assert.throws(() => patchInstallsAppIcon('trait InstallsAppIcon {}'), /icon\.icns/);
});

test('development no longer overlays the Dock with icon.png', () => {
    const patched = patchSetDockIcon('if (process.platform === \'darwin\' && process.env.NODE_ENV === \'development\') {\n            app.dock.setIcon(state.icon);\n        }');

    assert.match(patched, /return;/);
    assert.doesNotMatch(patched, /app\.dock\.setIcon\(state\.icon\)/);
    assert.equal(patchSetDockIcon(patched), patched);
});

test('native:run installs the Icon Composer catalog into Electron.app', () => {
    const source = "file_put_contents(ElectronServiceProvider::electronPath('node_modules/electron/dist/Electron.app/Contents/Info.plist'), $pList);";
    const patched = patchRunCommand(source);

    assert.match(patched, /CFBundleIconName/);
    assert.match(patched, /electron\.icns/);
    assert.match(patched, /Assets\.car/);
    assert.equal(patchRunCommand(patched), patched);
});

test('native:run icon install fails when the plist write is gone', () => {
    assert.throws(() => patchRunCommand('class RunCommand {}'), /Info\.plist/);
});
