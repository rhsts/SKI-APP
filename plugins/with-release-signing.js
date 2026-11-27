// Signs release builds with our own key instead of React Native's public debug key.
// Anyone can sign an APK with the debug key, and Android would then install it over the real
// app as an "update", with its data, logins and location permission. With our own key, Android
// refuses such an update.
//
// The key comes from environment variables at build time (the GitHub workflow fills them in
// from repository secrets), so it never lives in the repository:
//   ANDROID_KEYSTORE_FILE      path to the .jks keystore file
//   ANDROID_KEYSTORE_PASSWORD  the keystore's password
//   ANDROID_KEY_ALIAS          the key's alias inside it
//   ANDROID_KEY_PASSWORD       the key's password
// Without ANDROID_KEYSTORE_FILE (local builds) release builds keep using the debug key.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// ski-tracker: own release key';

const RELEASE_SIGNING = `
        release { ${MARK}
            if (System.getenv('ANDROID_KEYSTORE_FILE')) {
                storeFile file(System.getenv('ANDROID_KEYSTORE_FILE'))
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            }
        }`;

function addReleaseSigning(gradle) {
  if (gradle.includes(MARK)) return gradle;
  const withConfig = gradle.replace(/signingConfigs \{/, (m) => m + RELEASE_SIGNING);
  const withBuildType = withConfig.replace(
    /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
    "$1signingConfig System.getenv('ANDROID_KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug",
  );
  // Fail the build rather than silently shipping a debug-signed APK if the template changed.
  if (withConfig === gradle || withBuildType === withConfig) {
    throw new Error('with-release-signing: android/app/build.gradle no longer looks as expected');
  }
  return withBuildType;
}

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== 'groovy') throw new Error('with-release-signing: expected a Groovy build.gradle');
    c.modResults.contents = addReleaseSigning(c.modResults.contents);
    return c;
  });
module.exports.addReleaseSigning = addReleaseSigning;
