// @spreen/ffmpeg-kit-react-native's own type file declares its types under
// the *original* package's module name ('ffmpeg-kit-react-native') rather
// than its own — almost certainly a leftover from forking the original
// package without updating this one spot. The runtime code is unaffected;
// this just re-exports the same types under the name we actually import
// from, so TypeScript can see them.
declare module '@spreen/ffmpeg-kit-react-native' {
  export * from 'ffmpeg-kit-react-native';
}
