// ViewerScreen opened in "pick a range for the grid" mode has no direct way
// to hand its marked in/out points back to the screen that opened it —
// React Navigation explicitly discourages passing functions as route params
// (they aren't serializable). Same tiny event-bus pattern as voteEvents.ts:
// ViewerScreen emits once "Use This Range" is pressed, the export screen
// subscribes while its own modal is open.
type RangeListener = (postId: number, startSec: number, endSec: number) => void;

const listeners: RangeListener[] = [];

export function onGridRangePicked(listener: RangeListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

export function emitGridRangePicked(postId: number, startSec: number, endSec: number): void {
  listeners.forEach((l) => l(postId, startSec, endSec));
}
