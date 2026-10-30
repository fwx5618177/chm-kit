import { renameSync, writeFileSync } from 'node:fs';
import { CHMReader } from 'chmkit';

// Test-only, main-process observation. Every operation still uses the real reader;
// neither these counters nor a test control channel are exposed to the renderer.
export function install(journal) {
  const active = new Set();
  const counts = { attempts: 0, opened: 0, closed: 0, closeErrors: 0 };
  const record = () => {
    // The test process must never read a partially truncated counter document.
    writeFileSync(
      `${journal}.tmp`,
      JSON.stringify({ ...counts, active: active.size }),
    );
    renameSync(`${journal}.tmp`, journal);
  };
  const originalOpen = CHMReader.open;
  CHMReader.open = async function (...args) {
    counts.attempts++;
    record();
    const reader = await originalOpen.apply(this, args);
    active.add(reader);
    counts.opened++;
    const close = reader.close.bind(reader);
    reader.close = () => {
      try {
        close();
        if (active.delete(reader)) counts.closed++;
      } catch (error) {
        counts.closeErrors++;
        throw error;
      } finally {
        record();
      }
    };
    record();
    return reader;
  };
  record();
}
