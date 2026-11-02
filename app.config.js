// Builds on app.json with values that come from the environment at build time
// (GitHub Actions), so secrets never live in the repository.
//
//   GOOGLE_MAPS_API_KEY  Google Maps key for Android maps (GitHub secret)
//   BUILD_NUMBER         increases with every build so new APKs install over old ones
module.exports = ({ config }) => {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || '';
  const build = Number.parseInt(process.env.BUILD_NUMBER || '', 10);
  const hasBuild = Number.isFinite(build) && build > 0;

  return {
    ...config,
    version: hasBuild ? `1.0.${build}` : config.version,
    android: {
      ...config.android,
      ...(hasBuild ? { versionCode: build } : {}),
      ...(mapsKey ? { config: { ...(config.android?.config ?? {}), googleMaps: { apiKey: mapsKey } } } : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      [
        'expo-build-properties',
        {
          android: {
            // R8 shrinking removed WorkManager's Room database class (WorkDatabase_Impl), which
            // crashed the app at launch. Keep release builds unshrunk; the rules below are a
            // safety net in case shrinking is turned back on.
            enableMinifyInReleaseBuilds: false,
            enableShrinkResourcesInReleaseBuilds: false,
            extraProguardRules: [
              '-keep class * extends androidx.room.RoomDatabase { <init>(); }',
              '-keep class androidx.work.impl.** { *; }',
            ].join('\n'),
          },
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'Ski Tracker adds photos you choose to the map of your ski day.',
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
    ],
    extra: {
      ...(config.extra ?? {}),
      // The app checks this so maps show a placeholder instead of crashing when no key was built in.
      mapsKeyPresent: mapsKey.length > 0,
    },
  };
};
