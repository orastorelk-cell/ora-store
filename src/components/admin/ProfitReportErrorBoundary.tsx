import React from 'react';

type State={error:Error|null};
type Props={children:React.ReactNode};

/**
 * Profit reporting processes imported CSVs and historical order snapshots.
 * A malformed old record or an unexpected UI exception should NOT crash
 * the entire O-RA admin dashboard or prevent navigating to other modules.
 */
export class ProfitReportErrorBoundary extends React.Component<Props,State>{
  state:State={error:null};
  static getDerivedStateFromError(error:Error):State{
    return {error};
  }
  componentDidCatch(error:Error,info:React.ErrorInfo){
    console.error('[O-RA Profit Report] Rendering failed',error,info.componentStack);
  }
  reset=()=>this.setState({error:null});
  render(){
    if(!this.state.error)return this.props.children;
    return <section role="alert" data-ora-view-allowed="true"
      className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black text-red-700">Profit Report could not open</h2>
      <p className="mt-2 text-sm text-gray-600">
        This report hit an unexpected data or rendering error. The rest of the ORA System remains available.
        No payments, invoices, stock or profit records were changed.
      </p>
      <p className="mt-3 break-words rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
        {this.state.error.message||'Unknown Profit Report error'}
      </p>
      <button type="button" onClick={this.reset}
        className="mt-4 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white">
        Retry Profit Report
      </button>
    </section>;
  }
}
