# Sakuga (mobile app, phase 1)

Real React Native/Expo project — this is the first working slice, not the
whole thing. It proves the foundation works: real native networking (no CORS
workaround needed at all, unlike the bookmarklet), a working Search screen
against sakugabooru's actual API, and navigation into a (currently minimal)
viewer screen.

## What's actually working right now

- **Search** — tag chips, sort order, real results grid from `/post.json`.
- Tapping a result navigates to a Viewer screen that currently just shows
  the post's score/rating/tags and (for images) the image itself. Video
  playback, frame stepping, trim, comments — none of that is built yet.

## What's NOT built yet (next phases)

- Animator Stats screen
- Shows screen (search → episodes → back/forward)
- Real video player + frame-by-frame navigator in the Viewer
- Trim/download via `ffmpeg-kit-react-native` (real native ffmpeg — should be
  dramatically faster and more capable than the bookmarklet's ffmpeg.wasm,
  since there's no browser sandbox to work around)
- Comments
- Persistent tag-dictionary cache (currently in-memory only, refetches every
  app restart — the bookmarklet used `localStorage` with a 6-hour TTL;
  the equivalent here would be `AsyncStorage`)

## Running it

You need [Node.js](https://nodejs.org) installed on your own computer — this
can't run from a sandboxed environment, it needs to actually reach your phone.

```
cd sakuga-app
npm install
npx expo start
```

That prints a QR code in your terminal. Install the **Expo Go** app on your
phone (App Store / Play Store), then:

- **iOS**: open your phone's Camera app, point it at the QR code, tap the
  notification that appears.
- **Android**: open Expo Go itself, tap "Scan QR code".

Your phone needs to be on the same WiFi network as your computer for this to
work. The app loads live from your computer — edit any file, save, and it
hot-reloads on your phone within a second or two.

## Why this is genuinely simpler than the bookmarklet in some ways

No CORS workaround, no Prototype.js array-pollution defenses, no cross-origin
Worker/blob-URL juggling for ffmpeg — those were all specifically about
running *inside a browser tab on someone else's page*. A native app just
talks to the API directly. The one thing that DOES carry over unchanged: the
server's own `name_pattern`/`limit=0` bugs on `/tag.json`, which is why
`searchTags()` in `src/api/sakugabooru.ts` still fetches the whole tag
dictionary and filters client-side — that's a server bug, not a browser one.

## Eventually: real device builds (not just Expo Go)

Once this is further along, `eas build` (Expo's cloud build service) can
produce a real installable `.apk` (Android) or a build for TestFlight (iOS)
without needing a Mac or Android Studio locally — useful for actually testing
on your own phone as an installed app, and eventually for store submission.
Not needed yet while we're still building out core features.
