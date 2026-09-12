import {cpSync, existsSync, mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

export function patchElectronBuilder(source) {
    if (!source.includes("icon: 'icon.icon'")) {
        source = source.replace('mac: {', "mac: {\n        icon: 'icon.icon',");
    }

    return source;
}

export function patchInstallsAppIcon(source) {
    const copiedIcns = "@copy(public_path('icon.icns'), ElectronServiceProvider::electronPath('build/icon.icns'));";
    if (!source.includes(copiedIcns)) {
        throw new Error('NativePHP InstallsAppIcon.php no longer copies public/icon.icns');
    }

    if (!source.includes("public_path('icon.icon')")) {
        source = source.replace(
            copiedIcns,
            copiedIcns + "\n\n        $iconComposer = public_path('icon.icon');\n        if (is_dir($iconComposer)) {\n            (new \\Illuminate\\Filesystem\\Filesystem)->copyDirectory($iconComposer, ElectronServiceProvider::electronPath('build/icon.icon'));\n            (new \\Illuminate\\Filesystem\\Filesystem)->copyDirectory($iconComposer, ElectronServiceProvider::buildPath('icon.icon'));\n        }",
        );
    }

    if (!source.includes("resource_path('macos/Assets.car')")) {
        const composerCopy = "(new \\Illuminate\\Filesystem\\Filesystem)->copyDirectory($iconComposer, ElectronServiceProvider::buildPath('icon.icon'));\n        }";
        if (source.includes(composerCopy)) {
            source = source.replace(
                composerCopy,
                composerCopy + "\n        $catalog = resource_path('macos/Assets.car');\n        if (is_file($catalog)) {\n            @copy($catalog, ElectronServiceProvider::electronPath('build/Assets.car'));\n            @copy($catalog, ElectronServiceProvider::buildPath('Assets.car'));\n        }",
            );
        }
    }

    return source;
}

export function patchSetDockIcon(source) {
    if (!source.includes('app.dock.setIcon(state.icon);')) {
        return source;
    }

    return source.replace('app.dock.setIcon(state.icon);', 'return;');
}

export function patchRunCommand(source) {
    if (source.includes('CFBundleIconName')) {
        return source;
    }

    const needle = "file_put_contents(ElectronServiceProvider::electronPath('node_modules/electron/dist/Electron.app/Contents/Info.plist'), $pList);";
    if (!source.includes(needle)) {
        throw new Error('NativePHP RunCommand.php no longer writes Electron Info.plist');
    }

    return source.replace(
        needle,
        needle + "\n        $electronApp = ElectronServiceProvider::electronPath('node_modules/electron/dist/Electron.app');\n        $resources = $electronApp.'/Contents/Resources';\n        $plistPath = $electronApp.'/Contents/Info.plist';\n        $icns = public_path('icon.icns');\n        if (is_file($icns)) {\n            @copy($icns, $resources.'/electron.icns');\n            @copy($icns, $resources.'/icon.icns');\n            exec('plutil -replace CFBundleIconFile -string electron.icns '.escapeshellarg($plistPath));\n        }\n        $catalog = resource_path('macos/Assets.car');\n        if (is_file($catalog)) {\n            @copy($catalog, $resources.'/Assets.car');\n            exec('plutil -replace CFBundleIconName -string Icon '.escapeshellarg($plistPath));\n        }\n        @touch($electronApp);",
    );
}

export function compileIconComposer(iconPath, destinations) {
    const tmp = join(tmpdir(), 'sendae-icon-compile');
    const iconCopy = join(tmp, 'Icon.icon');
    const out = join(tmp, 'out');
    mkdirSync(out, {recursive: true});
    cpSync(iconPath, iconCopy, {recursive: true});
    execFileSync('actool', [
        iconCopy,
        '--compile',
        out,
        '--output-format',
        'human-readable-text',
        '--notices',
        '--warnings',
        '--output-partial-info-plist',
        join(out, 'assetcatalog_generated_info.plist'),
        '--app-icon',
        'Icon',
        '--include-all-app-icons',
        '--accent-color',
        'AccentColor',
        '--enable-on-demand-resources',
        'NO',
        '--development-region',
        'en',
        '--target-device',
        'mac',
        '--minimum-deployment-target',
        '26.0',
        '--platform',
        'macosx',
    ], {stdio: 'inherit'});
    if (destinations.icns) {
        mkdirSync(dirname(destinations.icns), {recursive: true});
        cpSync(join(out, 'Icon.icns'), destinations.icns);
    }
    if (destinations.car) {
        mkdirSync(dirname(destinations.car), {recursive: true});
        cpSync(join(out, 'Assets.car'), destinations.car);
    }
}

export function installIntoAppBundle(appPath, {icns, car}) {
    const resources = join(appPath, 'Contents/Resources');
    const plist = join(appPath, 'Contents/Info.plist');
    const iconFile = existsSync(join(resources, 'electron.icns')) ? 'electron.icns' : 'icon.icns';
    if (icns && existsSync(icns)) {
        cpSync(icns, join(resources, iconFile));
        if (iconFile !== 'icon.icns') {
            cpSync(icns, join(resources, 'icon.icns'));
        }
        execFileSync('plutil', ['-replace', 'CFBundleIconFile', '-string', iconFile, plist]);
    }
    if (car && existsSync(car)) {
        cpSync(car, join(resources, 'Assets.car'));
        execFileSync('plutil', ['-replace', 'CFBundleIconName', '-string', 'Icon', plist]);
    }
    execFileSync('touch', [appPath]);
}
