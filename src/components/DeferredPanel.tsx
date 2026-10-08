import React from 'react';

class LoadBoundary extends React.Component<{ children: React.ReactNode; active: boolean; onClose?: () => void }, { failed: boolean }> {
  declare props: { children: React.ReactNode; active: boolean; onClose?: () => void };
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    if (!this.props.active) return null;
    return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-6">
      <div className="rounded-2xl bg-white p-6 text-center text-gray-900 shadow-lg" role="alert">
        <p>This panel could not load. Reload to try again.</p>
        <button type="button" className="mt-4 rounded-xl bg-orange-600 px-5 py-2 text-white" onClick={() => window.location.reload()}>Reload</button>
        {this.props.onClose && <button type="button" className="ml-3 px-4 py-2" onClick={this.props.onClose}>Close</button>}
      </div>
    </div>;
  }
}

export const DeferredPanel = ({ children, active = true, onClose, fallback }: { children: React.ReactNode; active?: boolean; onClose?: () => void; fallback?: React.ReactNode }) =>
  <LoadBoundary active={active} onClose={onClose}><React.Suspense fallback={fallback ?? <div role="status" className="fixed bottom-24 left-1/2 z-[100] -translate-x-1/2 rounded-xl bg-white px-5 py-3 text-sm text-gray-700 shadow-lg">Loading…</div>}>{children}</React.Suspense></LoadBoundary>;
