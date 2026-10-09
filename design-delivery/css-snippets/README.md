# CSS integration snippets

The application implementation remains in its existing CSS owners:

- Theme and base tokens: `frontend/src/index.css`
- Shared surfaces, navigation, and dashboard components: `frontend/src/supercharged.css`
- Login presentation: `frontend/src/login/loginScene.css`
- Responsive rules: `frontend/src/mobile.css`

The examples below are representative patterns already used by those files.
They are intentionally not imported as a second cascade layer.

```css
.control:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent) 72%, white);
  outline-offset: 3px;
}

.motion-surface {
  transition:
    transform var(--sc-dur-2) var(--sc-ease),
    opacity var(--sc-dur-2) var(--sc-ease);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```
