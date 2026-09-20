// Copies the pre-patched react-native-video-trim files straight over the
// installed package, instead of applying a line-based diff (patch-package).
// This exists specifically because patch-package failed intermittently with
// a generic "Failed to apply patch" error that couldn't be reproduced or
// diagnosed remotely — most likely a line-ending or whitespace difference
// somewhere between where the patch was generated and where it was applied,
// which a positional diff format is inherently fragile to. A plain file
// copy has no such failure mode: it either finds the source files and
// copies them, or it doesn't, with a clear message either way.
//
// Source and dest paths differ for the Kotlin files specifically: this
// project's own .easignore has an unanchored `android/` rule (no leading
// slash), which — unlike .gitignore's anchored `/android` — matches a
// directory named "android" at ANY depth, not just at the repo root. That
// silently excluded native-overrides/react-native-video-trim/android/...
// from EAS's upload even though it has nothing to do with the generated
// native project the rule was meant for. Renaming this vendored copy's
// folder to "android-src" sidesteps that collision without needing to
// touch the ignore files, which may have other reasons behind their
// current patterns. The actual node_modules destination is unaffected —
// it needs the real "android" name Gradle expects, and node_modules itself
// is already excluded wholesale from git/EAS uploads for unrelated reasons,
// so this rename only matters on the source side.
const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.join(__dirname, '..', 'native-overrides', 'react-native-video-trim');
const DEST_ROOT = path.join(__dirname, '..', 'node_modules', 'react-native-video-trim');

const FILES = [
  { src: 'android-src/src/main/java/com/videotrim/BaseVideoTrimModule.kt', dest: 'android/src/main/java/com/videotrim/BaseVideoTrimModule.kt' },
  { src: 'android-src/src/newarch/VideoTrimModule.kt', dest: 'android/src/newarch/VideoTrimModule.kt' },
  { src: 'android-src/src/oldarch/VideoTrimModule.kt', dest: 'android/src/oldarch/VideoTrimModule.kt' },
  { src: 'android-src/src/oldarch/VideoTrimSpec.kt', dest: 'android/src/oldarch/VideoTrimSpec.kt' },
  { src: 'src/NativeVideoTrim.ts', dest: 'src/NativeVideoTrim.ts' },
  { src: 'src/index.tsx', dest: 'src/index.tsx' },
  { src: 'lib/module/index.js', dest: 'lib/module/index.js' },
  { src: 'lib/typescript/src/NativeVideoTrim.d.ts', dest: 'lib/typescript/src/NativeVideoTrim.d.ts' },
  { src: 'lib/typescript/src/index.d.ts', dest: 'lib/typescript/src/index.d.ts' },
];

if (!fs.existsSync(DEST_ROOT)) {
  console.log('[apply-native-overrides] react-native-video-trim not installed yet — skipping (this runs after npm install populates node_modules).');
  process.exit(0);
}

let copied = 0;
let missing = [];
for (const { src: srcRel, dest: destRel } of FILES) {
  const src = path.join(SRC_ROOT, srcRel);
  const dest = path.join(DEST_ROOT, destRel);
  if (!fs.existsSync(src)) {
    missing.push(srcRel);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied++;
}

if (missing.length) {
  console.error('[apply-native-overrides] ERROR — source file(s) missing from native-overrides/, could not apply:');
  missing.forEach((f) => console.error('  ' + f));
  process.exit(1);
}

console.log(`[apply-native-overrides] applied ${copied} file(s) to node_modules/react-native-video-trim ✔`);
