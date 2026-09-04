# Sakuga Enhancer

A native Android/iOS app for browsing [sakugabooru.com](https://www.sakugabooru.com) — search, animator stats, a show/episode browser, frame-accurate video trimming, commenting, voting, and pools.

Built with React Native + Expo, powered entirely by sakugabooru's own public API.

## Features

- **Search** — tag chips with live, color-coded suggestions, sort order, exclude-filter, infinite scroll, "solo cuts only" filter (hide collaborative cuts, show only clips with one credited animator)
- **Animator Stats** — score, activity-by-year chart, top co-tags
- **Shows** — live show search, episode grid, jump-to-episode, related titles
- **Viewer** — native video playback with frame-by-frame stepping, tag breakdown, comments with quote formatting and tappable timestamps/post links
- **Trim & Download** — hardware-accelerated video trimming, download or save straight to your gallery
- **Login, Comments & Voting** — log in with your sakugabooru account to post comments and vote on cuts
- **Pools** — create private, on-device pools to organize your favorite clips, and browse public pools other users have made on sakugabooru itself

## Get the app

**Download:** grab the latest `.apk` from [Releases](../../releases/latest) — install it directly on your Android phone (allow install from unknown sources when prompted). No Play Store account needed, and this link doesn't expire.

Prefer to build it yourself instead? Free, takes about 15 minutes:

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

## License

MIT — see [LICENSE](LICENSE).

## Credits

Built entirely on [sakugabooru.com](https://www.sakugabooru.com)'s public API. All content, comments, accounts, and pools belong to sakugabooru — this is an unofficial client, not affiliated with the site.
