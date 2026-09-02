# Sakuga Enhancer

A native Android/iOS app for browsing [sakugabooru.com](https://www.sakugabooru.com) — search, animator stats, a show/episode browser, frame-accurate video trimming, and commenting, all on your phone.

Built with React Native + Expo. Powered entirely by sakugabooru's own public API.

## Features

- **Search** — tag chips, sort order, live tag suggestions, exclude-filter, infinite scroll
- **Animator Stats** — cut count, average score, activity-by-year chart, top co-tags — synced with Search
- **Shows** — live show search, episode grid parsed from post source text, jump-to-episode, related titles, deepening sample scans
- **Viewer** — real native video playback with frame-by-frame stepping, tag breakdown, comments (with quote formatting and tappable timestamps/post links)
- **Trim & Download** — real hardware-accelerated video trimming, download or save straight to your gallery
- **Login & Comments** — log in with your sakugabooru account and post comments directly from the app

## Tech stack

React Native · Expo (SDK 57) · React Navigation · `expo-video` · `react-native-video-trim` · `expo-secure-store`

## Running it locally

This app uses native modules (video trimming, secure credential storage) that **Expo Go cannot run** — you need a development build.

```bash
npm install
eas build --platform android --profile development   # first time only
npx expo start --dev-client
```

Install the resulting build on your device, then scan the QR code from `expo start`.

## Building a shareable APK

A standalone build that doesn't need a dev server running:

```bash
eas build --platform android --profile preview
```

## Credits

Built entirely on [sakugabooru.com](https://www.sakugabooru.com)'s public API. All content, comments, and accounts belong to sakugabooru — this app is just a client.
