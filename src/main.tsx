import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import './styles.css';

// An iPhone shows a button's pressed look only on a page that listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true });
render(<App />, document.getElementById('app')!);
// The app itself works offline once opened (the figures need internet); a new version installs itself in the background.
registerSW({ immediate: true });
void navigator.storage?.persist?.().catch(() => undefined);
