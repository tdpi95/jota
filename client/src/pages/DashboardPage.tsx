import { Link } from 'react-router-dom';

// Full Dashboard (open tasks bucketed by due date, project color badges,
// "+ log to today" wired in) is milestone 14 — TaskRow already supports the
// "log to today" action (built in milestone 12), Dashboard just needs to
// assemble the open-tasks view around it. Placeholder for now so `/` has
// somewhere useful to send people in the meantime.
export default function DashboardPage() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
      </div>
      <p className="placeholder-page">
        The full dashboard (open tasks across projects, due-date buckets) lands in a later milestone. In the meantime, head to{' '}
        <Link to="/projects">Projects</Link> or today's <Link to={`/journal`}>journal entry</Link>.
      </p>
    </div>
  );
}
