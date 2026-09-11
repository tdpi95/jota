import { useEffect, useState } from 'react';

// Deliberately unstyled placeholder — just enough to prove the Electron
// window is talking to the embedded server over HTTP (milestone 3's own
// verify step). The real AppShell/WorkspaceSwitcher/etc. land in
// milestones 11-16.

interface Workspace {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: string;
}

export default function App() {
  const [health, setHealth] = useState<'checking' | 'ok' | 'error'>('checking');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setHealth(res.ok ? 'ok' : 'error'))
      .catch(() => setHealth('error'));

    fetch('/api/workspaces/active')
      .then((res) => res.json())
      .then((data) => setWorkspace(data.workspace))
      .catch(() => setWorkspace(null));
  }, []);

  return (
    <div>
      <h1>pivot</h1>
      <p>Embedded server: {health}</p>
      <p>Active workspace: {workspace ? `${workspace.name} (${workspace.path})` : 'none'}</p>
    </div>
  );
}
