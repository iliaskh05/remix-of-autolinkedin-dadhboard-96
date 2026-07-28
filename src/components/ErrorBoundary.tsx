import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode };
type State = { hasError: boolean };

/**
 * Top-level safety net: without this, any uncaught render error anywhere in
 * the tree crashes to a blank white screen with no recovery path.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
          <AlertTriangle className="h-7 w-7 text-destructive" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Une erreur est survenue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            L'application a rencontré un problème inattendu. Réessaie, ou reviens à l'accueil.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
            Retour au tableau de bord
          </Button>
          <Button onClick={() => window.location.reload()} className="gap-2">
            <RotateCcw className="h-4 w-4" /> Recharger
          </Button>
        </div>
      </div>
    );
  }
}
