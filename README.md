# Sakuga Enhancer

A native Android/iOS app for browsing [sakugabooru.com](https://www.sakugabooru.com) — search, animator stats, a show/episode browser, frame-accurate video trimming, and commenting.

Built with React Native + Expo, powered entirely by sakugabooru's own public API.

## Features

- Tag search with live suggestions, sort order, exclude-filter, infinite scroll
- Animator stats — score, activity chart, top co-tags
- Show/episode browser with jump-to-episode and related titles
- Native video playback with frame-by-frame stepping
- Comments with quote formatting, tappable timestamps and post links
- Hardware-accelerated trim, download, and save to gallery
- Log in and post comments with your own sakugabooru account

## Get the app

**Quick download:** [Download APK](https://expo.dev/accounts/punyesh/projects/sakuga-app/builds/613f1f29-a0c6-42ab-9dc6-3abfe82b5243) — note this link may expire around 30 days after the build was created (Expo's own retention limit for this build type). If it's dead, use the steps below instead.

No pre-built APK is guaranteed to stay current — build your own, free, in about 15 minutes:

1. Install [Node.js](https://nodejs.org) and create a free account at [expo.dev](https://expo.dev)
2. Clone this repo, then from inside it:
   ```bash
   npm install -g eas-cli
   npm install
   eas login
   eas build --platform android --profile preview
   ```
3. Wait for the build to finish, then open the link it prints on your Android phone and install the `.apk` directly. No dev server or computer needed afterward — it's a standalone app.

iOS is possible with the same command (`--platform ios`), but needs a paid Apple Developer account ($99/year) to install on a physical device.

## Contributing / local development

Video trimming and secure credential storage use native modules Expo Go can't run, so local development needs a dev-client build instead:

```bash
eas build --platform android --profile development   # first time only
npx expo start --dev-client
```

## Tech stack

React Native · Expo (SDK 57) · React Navigation · `expo-video` · `react-native-video-trim` · `expo-secure-store`

## Credits

Built entirely on [sakugabooru.com](https://www.sakugabooru.com)'s public API. All content, comments, and accounts belong to sakugabooru — this app is just a client.
