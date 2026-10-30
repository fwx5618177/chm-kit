import { app } from 'electron';

// Do not hold Electron's entry-module evaluation open while the application
// waits for ready: Playwright releases ready only after attaching browser CDP.
void import('./observe.mjs')
  .then(({ install }) => {
    install(process.env.CHMKIT_ELECTRON_JOURNAL);
    return import('./app/main.mjs');
  })
  .catch(error => {
    console.error('Native acceptance bootstrap failed:', error);
    app.exit(1);
  });
