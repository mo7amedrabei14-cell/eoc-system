// Kept as the existing call-site adapter. Navigation/state updates remain
// synchronous and unchanged; App.jsx applies the one shared arrival motion
// after the routed surface is committed. No View Transition snapshots run here.
export const ENABLE_VISUAL_TRANSITIONS = true;

export function runVisualTransition(update) {
  if (typeof update !== 'function') return undefined;
  update();
  return undefined;
}
