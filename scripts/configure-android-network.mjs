import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tauriDir = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const androidSrc = join(tauriDir, 'gen', 'android', 'app', 'src');
const manifestPath = join(androidSrc, 'main', 'AndroidManifest.xml');
const configName = 'library_network_security_config.xml';
const androidRequired =
  process.argv.includes('--android') ||
  ['android', 'androideabi'].includes(process.env.TAURI_ENV_PLATFORM) ||
  /-android/.test(process.env.TAURI_ENV_TARGET_TRIPLE ?? '');

function configureAndroidNetwork() {
  let manifest;
  try {
    manifest = readFileSync(manifestPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (androidRequired) {
      throw new Error(
        'Android project is missing. Run npm run tauri -- android init before configuring local media access.',
        { cause: error },
      );
    }
    console.log('No Android project found; skipping Android network configuration.');
    return;
  }

  // Attach the existing policies without changing Tauri's other manifest settings.
  const applicationTag = /<application\b[^>]*>/;
  if (!applicationTag.test(manifest)) {
    throw new Error(`No <application> element found in ${manifestPath}.`);
  }
  const updatedManifest = manifest.replace(applicationTag, (tag) => {
    const attribute = 'android:networkSecurityConfig="@xml/library_network_security_config"';
    const existingAttribute = /\bandroid:networkSecurityConfig\s*=\s*(?:"[^"]*"|'[^']*')/;
    if (existingAttribute.test(tag)) {
      return tag.replace(existingAttribute, attribute);
    }
    return tag.replace(/\s*\/?>$/, (ending) => ` ${attribute}${ending}`);
  });

  // Android overlays debug resources on main resources using the same filename.
  for (const variant of ['main', 'debug']) {
    const destination = join(androidSrc, variant, 'res', 'xml', configName);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(tauriDir, 'android-res', variant, configName), destination);
  }
  if (updatedManifest !== manifest) {
    writeFileSync(manifestPath, updatedManifest);
  }
  console.log('Configured Android network access for local media and debug development servers.');
}

try {
  configureAndroidNetwork();
} catch (error) {
  console.error(`Android network configuration failed: ${error.message}`);
  process.exitCode = 1;
}
