import { Component } from "react";
import { Button } from "@/components/ui/button";

/**
 * Catches unexpected render errors so the app does not white-screen.
 * Place near the root (inside router/auth is fine).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface in console for local debugging; production would send to a reporter.
    console.error("UI render error:", error, info?.componentStack);
  }

  handleReset = () => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
    if (this.props.onReset) this.props.onReset();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <div className="space-y-2 max-w-md">
            <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred while rendering this page. You can try again,
              or go back to bookings.
            </p>
            {import.meta.env.DEV && (
              <p className="text-xs text-destructive break-words font-mono">
                {String(this.state.error?.message || this.state.error)}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={this.handleReset}>
              Try again
            </Button>
            <Button onClick={() => { window.location.href = "/bookings"; }}>
              Go to bookings
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div key={this.state.resetKey} className="contents">
        {this.props.children}
      </div>
    );
  }
}
