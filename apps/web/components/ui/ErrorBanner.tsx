import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";

export function ErrorBanner({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        <div>
          <p className="text-sm font-semibold text-text">{title}</p>
          {detail ? (
            <p className="mt-1 text-xs text-muted/90">{detail}</p>
          ) : null}
        </div>
      </div>
      {onRetry ? (
        <Button variant="secondary" className="shrink-0" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
