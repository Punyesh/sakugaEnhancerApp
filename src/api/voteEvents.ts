// A vote cast inside ViewerScreen only updates that screen's own local
// state — nothing propagates back to whichever list screen it was opened
// from, so backing out showed the old score until a fresh search/fetch.
// React Navigation explicitly discourages passing functions as route
// params (they aren't serializable), so this is a tiny event bus instead:
// ViewerScreen emits after a successful vote, any currently-mounted list
// screen that cares subscribes and patches its own local post list.
type ScoreListener = (postId: number, newScore: number) => void;

const listeners: ScoreListener[] = [];

export function onScoreChanged(listener: ScoreListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

export function emitScoreChanged(postId: number, newScore: number): void {
  listeners.forEach((l) => l(postId, newScore));
}
