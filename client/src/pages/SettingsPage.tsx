import { useQuery } from '@tanstack/react-query';

import { getActiveWorkspace } from '../api/client';

// Workspace switcher + sync panel + reminder/launch-at-login fields are
// milestone 16. Placeholder showing the one thing that's true today: which
// workspace is active.
export default function SettingsPage() {
  const { data } = useQuery({ queryKey: ['workspace', 'active'], queryFn: getActiveWorkspace });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>
      <div className="settings-section">
        <div className="section-title">Active workspace</div>
        {data?.workspace ? (
          <div className="ws-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--paper-card)', border: '1px solid var(--hairline)' }}>
            <div>
              <div style={{ fontWeight: 700, fontFamily: "'Newsreader', Georgia, serif" }}>{data.workspace.name}</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: 'var(--ink-muted)' }}>{data.workspace.path}</div>
            </div>
          </div>
        ) : (
          <p className="placeholder-page">No workspace is open yet.</p>
        )}
      </div>
      <p className="placeholder-page">Workspace switching, remote sync, and the daily reminder settings land in a later milestone.</p>
    </div>
  );
}
