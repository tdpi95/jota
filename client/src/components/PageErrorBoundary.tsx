import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

/**
 * Catches a render crash inside the routed page (AppShell's `<Outlet />`) so
 * one bad file — frontmatter a hand edit or a leftover git conflict left in
 * a shape a page didn't expect — can't unmount the whole app into a blank
 * window. The sidebar, calendar and workspace switcher stay usable, and the
 * boundary resets on navigation (keyed by pathname), so moving to another
 * page just works.
 */
export default function PageErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { t } = useTranslation();
  return (
    <Boundary key={pathname} title={t('pageError.title')} hint={t('pageError.hint')} retry={t('pageError.retry')}>
      {children}
    </Boundary>
  );
}

interface BoundaryProps {
  children: ReactNode;
  title: string;
  hint: string;
  retry: string;
}

class Boundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[page] render crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page-error">
        <h2>{this.props.title}</h2>
        <p className="page-sub">{this.props.hint}</p>
        <pre className="page-error-detail">{this.state.error.message}</pre>
        <button type="button" className="btn-secondary" onClick={() => this.setState({ error: null })}>
          {this.props.retry}
        </button>
      </div>
    );
  }
}
